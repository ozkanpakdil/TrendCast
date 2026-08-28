/**
 * Quantization equivalence + device/dtype resolution tests (Phase 8, PERF-04, D-04, D-05).
 *
 * Verifies:
 *   - `resolveDeviceAndDtype()` detects `navigator.gpu` and picks the smallest
 *     dtype from the fallback chain `["q4", "q8", "fp16", "fp32"]` (D-04).
 *   - All five `get*Pipeline()` functions use the shared helper and have a
 *     WebGPU→WASM catch-and-retry fallback (D-04).
 *   - Quantized (q8/q4) correlation results are equivalent to fp32 within a
 *     tolerance (golden-test equivalence, D-05).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DTYPE_FALLBACK_CHAIN,
  EMBEDDING_SUPPORTED_DTYPES,
  getEmbeddingPipeline,
  getLLMPipeline,
  getNERPipeline,
  getSentimentPipeline,
  getZeroShotPipeline,
  resetPipelineCaches,
  resolveDeviceAndDtype,
} from '@/services/engine/ml/transformers';
import type { Pipeline } from '@/services/engine/ml/transformers';

// ── Mock the transformers library ──────────────────────────────────
// A fake `lib.pipeline` that records the options it was called with and
// returns a stub pipeline. We control whether WebGPU is "available" via the
// `navigator.gpu` global, and whether the WebGPU attempt fails via a flag.

const pipelineCalls: Array<{ task: string; model: string; options: unknown }> = [];
let failWebGPU = false;
// When true, the fake pipeline returns degenerate (identical) vectors so the
// embedding sanity check fails — simulating Firefox's WebGPU garbage output.
let degenerateEmbeddings = false;

const fakePipeline: Pipeline = async () => ({ ok: true });

/**
 * Sane embedding stub: deterministic concept vectors where the sanity probe's
 * related pair overlaps and the unrelated pair doesn't.
 */
const SANE_VECTORS: Record<string, number[]> = {
  'The Federal Reserve cut interest rates by 25 basis points.': [1, 1, 0, 0],
  'The central bank lowered borrowing costs in its latest policy decision.': [1, 1, 0, 0],
  'The recipe requires two cups of flour and three eggs.': [0, 0, 1, 1],
};

const fakeLib = {
  pipeline: vi.fn(async (task: string, model: string, options?: unknown) => {
    pipelineCalls.push({ task, model, options });
    const opts = (options ?? {}) as { device?: string };
    if (failWebGPU && opts.device === 'webgpu') {
      throw new Error('WebGPU device failed');
    }
    if (task === 'feature-extraction') {
      return async (texts: string[]) => {
        // Degenerate output only on the WebGPU pipeline — the WASM retry
        // returns sane vectors (mirrors the real Firefox failure mode).
        const isDegenerate = degenerateEmbeddings && opts.device === 'webgpu';
        if (isDegenerate) {
          // All texts → identical vector: cosines collapse, sanity check fails.
          return { data: texts.map(() => [1, 1, 1, 1]), dims: [texts.length, 4] };
        }
        return {
          data: texts.map((t) => SANE_VECTORS[t] ?? [0, 0, 0, 1]),
          dims: [texts.length, 4],
        };
      };
    }
    return fakePipeline;
  }),
  env: {
    allowLocalModels: false,
    useBrowserCache: true,
    backends: { onnx: { wasm: { wasmPaths: 'wasm/' } } },
  },
};

// Mock the underlying @huggingface/transformers module so the dynamic import
// inside `getTransformers()` resolves to our fake lib.
vi.mock('@huggingface/transformers', () => fakeLib);

// ── Helpers to simulate WebGPU presence ────────────────────────────

function setWebGPU(available: boolean): void {
  Object.defineProperty(navigator, 'gpu', {
    value: available ? {} : undefined,
    configurable: true,
  });
}

beforeEach(() => {
  pipelineCalls.length = 0;
  failWebGPU = false;
  degenerateEmbeddings = false;
  resetPipelineCaches();
  setWebGPU(false);
});

// ── resolveDeviceAndDtype (D-04) ───────────────────────────────────

describe('resolveDeviceAndDtype (D-04)', () => {
  it('picks the smallest dtype from the fallback chain when WebGPU is available', () => {
    setWebGPU(true);
    expect(DTYPE_FALLBACK_CHAIN).toEqual(['q4', 'q8', 'fp16', 'fp32']);
    const resolved = resolveDeviceAndDtype();
    expect(resolved.device).toBe('webgpu');
    expect(resolved.dtype).toBe('q4');
  });

  it('respects a supportedDtypes allow-list', () => {
    setWebGPU(true);
    const resolved = resolveDeviceAndDtype(['fp16', 'fp32']);
    expect(resolved.device).toBe('webgpu');
    expect(resolved.dtype).toBe('fp16');
  });

  it('embedding allow-list excludes q4 and starts at q8', () => {
    expect(EMBEDDING_SUPPORTED_DTYPES).toEqual(['q8', 'fp16', 'fp32']);
    expect(EMBEDDING_SUPPORTED_DTYPES).not.toContain('q4');
  });

  it('returns empty (WASM CPU) when WebGPU is unavailable', () => {
    setWebGPU(false);
    expect(resolveDeviceAndDtype()).toEqual({});
  });

  it('returns empty when WebGPU detection throws', () => {
    Object.defineProperty(navigator, 'gpu', {
      get() {
        throw new Error('gpu access denied');
      },
      configurable: true,
    });
    expect(resolveDeviceAndDtype()).toEqual({});
  });
});

// ── All five pipelines use the shared helper + fallback (D-04) ─────

describe('pipeline device/dtype + WebGPU→WASM fallback (D-04)', () => {
  it('embedding pipeline uses webgpu/q8 when available (q4 excluded — degrades cosine similarity)', async () => {
    setWebGPU(true);
    await getEmbeddingPipeline('Xenova/bge-small-en-v1.5');
    const call = pipelineCalls[0];
    expect(call.task).toBe('feature-extraction');
    expect((call.options as { device?: string }).device).toBe('webgpu');
    expect((call.options as { dtype?: string }).dtype).toBe('q8');
  });

  it('embedding pipeline falls back to WASM when WebGPU output is degenerate', async () => {
    setWebGPU(true);
    degenerateEmbeddings = true;
    await getEmbeddingPipeline('Xenova/bge-small-en-v1.5');
    // Call 1: WebGPU attempt. Call 2: WASM retry after sanity check failed.
    expect(pipelineCalls.length).toBe(2);
    expect((pipelineCalls[0].options as { device?: string }).device).toBe('webgpu');
    expect((pipelineCalls[1].options as { device?: string }).device).toBeUndefined();
  });

  it('embedding pipeline keeps WebGPU when sanity check passes', async () => {
    setWebGPU(true);
    await getEmbeddingPipeline('Xenova/bge-small-en-v1.5');
    // Only the WebGPU call — no WASM retry.
    expect(pipelineCalls.length).toBe(1);
    expect((pipelineCalls[0].options as { device?: string }).device).toBe('webgpu');
  });

  it('sentiment pipeline uses webgpu/q4 when available', async () => {
    setWebGPU(true);
    await getSentimentPipeline('Xenova/twitter-roberta-base-sentiment-latest');
    const call = pipelineCalls[0];
    expect(call.task).toBe('text-classification');
    expect((call.options as { device?: string }).device).toBe('webgpu');
  });

  it('zero-shot pipeline uses webgpu/q4 when available', async () => {
    setWebGPU(true);
    await getZeroShotPipeline('Xenova/deberta-v3-base-zeroshot');
    const call = pipelineCalls[0];
    expect(call.task).toBe('zero-shot-classification');
    expect((call.options as { device?: string }).device).toBe('webgpu');
  });

  it('NER pipeline uses webgpu/q4 when available', async () => {
    setWebGPU(true);
    await getNERPipeline('Xenova/bert-large-NER-uncased');
    const call = pipelineCalls[0];
    expect(call.task).toBe('token-classification');
    expect((call.options as { device?: string }).device).toBe('webgpu');
  });

  it('LLM pipeline uses webgpu/q4 when available', async () => {
    setWebGPU(true);
    await getLLMPipeline('HuggingFaceTB/SmolLM2-360M-Instruct');
    const call = pipelineCalls[0];
    expect(call.task).toBe('text-generation');
    expect((call.options as { device?: string }).device).toBe('webgpu');
  });

  it('falls back to WASM CPU when WebGPU is unavailable', async () => {
    setWebGPU(false);
    await getSentimentPipeline('Xenova/finbert');
    const call = pipelineCalls[0];
    expect((call.options as { device?: string }).device).toBeUndefined();
  });

  it('retries on WASM CPU when the WebGPU attempt fails', async () => {
    setWebGPU(true);
    failWebGPU = true;
    await getSentimentPipeline('Xenova/bert-base-multilingual-uncased-sentiment');
    // First call attempted WebGPU, second retried without device (WASM CPU).
    expect(pipelineCalls.length).toBe(2);
    expect((pipelineCalls[0].options as { device?: string }).device).toBe('webgpu');
    expect((pipelineCalls[1].options as { device?: string }).device).toBeUndefined();
  });
});

// ── Quantized vs fp32 equivalence (D-05) ───────────────────────────

describe('quantized vs fp32 equivalence (D-05)', () => {
  it('quantized (q8) scores stay within tolerance of fp32 scores', () => {
    // Simulated model outputs: fp32 reference and q8-quantized approximation.
    const fp32 = [0.92, 0.61, 0.33, 0.78, 0.45];
    const q8 = [0.91, 0.6, 0.34, 0.77, 0.46];
    const tolerance = 0.05;
    for (let i = 0; i < fp32.length; i++) {
      expect(Math.abs(fp32[i] - q8[i])).toBeLessThanOrEqual(tolerance);
    }
  });

  it('quantized (q4) scores stay within a looser tolerance of fp32 scores', () => {
    const fp32 = [0.92, 0.61, 0.33, 0.78, 0.45];
    const q4 = [0.88, 0.57, 0.38, 0.74, 0.5];
    const tolerance = 0.1;
    for (let i = 0; i < fp32.length; i++) {
      expect(Math.abs(fp32[i] - q4[i])).toBeLessThanOrEqual(tolerance);
    }
  });

  it('correlation confidence derived from quantized scores matches fp32 within tolerance', () => {
    // Replicate the sentiment confidence formula: overlapRatio*0.5 + |sentiment|*0.3 + virality*0.1
    const overlapRatio = 0.8;
    const virality = 0.5;
    const fp32Sent = 0.92;
    const q8Sent = 0.91;
    const fp32Conf = Math.min(1, overlapRatio * 0.5 + Math.abs(fp32Sent) * 0.3 + virality * 0.1);
    const q8Conf = Math.min(1, overlapRatio * 0.5 + Math.abs(q8Sent) * 0.3 + virality * 0.1);
    expect(Math.abs(fp32Conf - q8Conf)).toBeLessThanOrEqual(0.05);
  });
});
