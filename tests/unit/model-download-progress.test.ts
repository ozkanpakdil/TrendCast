/**
 * Model-download progress tests (Phase 15, MLPROG-02).
 *
 * Verifies:
 *   - `mapDownloadToProgress()` maps transformers.js statuses onto the
 *     `loading-model` phase: initiate → 0/1, progress → loaded/total
 *     (percentage fallback), done → 1/1, download → null.
 *   - `createPipelineWithFallback` forwards `progress_callback` on both the
 *     WebGPU attempt and the WASM retry.
 *   - All four `get*Pipeline()` functions accept and forward the callback.
 *   - A cancel throw inside the callback propagates (aborts pipeline creation).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getEmbeddingPipeline,
  getLLMPipeline,
  getNERPipeline,
  getSentimentPipeline,
  mapDownloadToProgress,
  resetPipelineCaches,
  type ModelDownloadCallback,
  type ModelDownloadInfo,
} from '@/services/engine/ml/transformers';
import type { Pipeline } from '@/services/engine/ml/transformers';

// ── Mock the transformers library ──────────────────────────────────

const pipelineCalls: Array<{ task: string; model: string; options: unknown }> = [];
let failWebGPU = false;
/** Download events the fake lib emits when a pipeline is created. */
let downloadEvents: ModelDownloadInfo[] = [];

const fakePipeline: Pipeline = async () => ({ ok: true });

const fakeLib = {
  pipeline: vi.fn(async (task: string, model: string, options?: unknown) => {
    pipelineCalls.push({ task, model, options });
    const opts = (options ?? {}) as {
      device?: string;
      progress_callback?: ModelDownloadCallback;
    };
    if (failWebGPU && opts.device === 'webgpu') {
      throw new Error('WebGPU device failed');
    }
    // Emit the scripted download events through the provided callback.
    if (opts.progress_callback) {
      for (const ev of downloadEvents) {
        opts.progress_callback(ev);
      }
    }
    return fakePipeline;
  }),
  env: {
    allowLocalModels: false,
    useBrowserCache: true,
    backends: { onnx: { wasm: { wasmPaths: 'wasm/' } } },
  },
};

vi.mock('@huggingface/transformers', () => fakeLib);

function setWebGPU(available: boolean): void {
  Object.defineProperty(navigator, 'gpu', {
    value: available ? {} : undefined,
    configurable: true,
  });
}

beforeEach(() => {
  pipelineCalls.length = 0;
  failWebGPU = false;
  downloadEvents = [];
  resetPipelineCaches();
  setWebGPU(false);
});

// ── mapDownloadToProgress ──────────────────────────────────────────

describe('mapDownloadToProgress (MLPROG-02)', () => {
  it('maps initiate to loading-model 0/1 with the file name', () => {
    const p = mapDownloadToProgress(
      { status: 'initiate', file: 'onnx/model_quantized.onnx' },
      'embedding',
      'Xenova/bge-small-en-v1.5',
    );
    expect(p).toEqual({
      phase: 'loading-model',
      current: 0,
      total: 1,
      engine: 'embedding',
      model: 'Xenova/bge-small-en-v1.5',
      file: 'onnx/model_quantized.onnx',
    });
  });

  it('maps progress to loaded/total byte counts', () => {
    const p = mapDownloadToProgress(
      { status: 'progress', file: 'onnx/model_quantized.onnx', loaded: 5_000_000, total: 23_000_000, progress: 21.7 },
      'llm',
      'HuggingFaceTB/SmolLM2-360M-Instruct',
    );
    expect(p).not.toBeNull();
    expect(p!.phase).toBe('loading-model');
    expect(p!.current).toBe(5_000_000);
    expect(p!.total).toBe(23_000_000);
    expect(p!.file).toBe('onnx/model_quantized.onnx');
  });

  it('falls back to percentage/100 when byte counts are absent', () => {
    const p = mapDownloadToProgress(
      { status: 'progress', file: 'config.json', progress: 42 },
      'sentiment',
      'Xenova/finbert',
    );
    expect(p).not.toBeNull();
    expect(p!.current).toBe(42);
    expect(p!.total).toBe(100);
  });

  it('maps done to loading-model 1/1', () => {
    const p = mapDownloadToProgress(
      { status: 'done', file: 'onnx/model_quantized.onnx' },
      'ner',
      'Xenova/bert-large-NER-uncased',
    );
    expect(p).toEqual({
      phase: 'loading-model',
      current: 1,
      total: 1,
      engine: 'ner',
      model: 'Xenova/bert-large-NER-uncased',
      file: 'onnx/model_quantized.onnx',
    });
  });

  it('returns null for the download (start) status', () => {
    expect(
      mapDownloadToProgress({ status: 'download', file: 'config.json' }, 'embedding', 'm'),
    ).toBeNull();
  });
});

// ── progress_callback forwarding ───────────────────────────────────

describe('progress_callback forwarding (MLPROG-02)', () => {
  it('forwards download events through getEmbeddingPipeline', async () => {
    setWebGPU(false);
    downloadEvents = [
      { status: 'initiate', file: 'onnx/model_quantized.onnx' },
      { status: 'progress', file: 'onnx/model_quantized.onnx', loaded: 100, total: 200 },
      { status: 'done', file: 'onnx/model_quantized.onnx' },
    ];
    const seen: ModelDownloadInfo[] = [];
    await getEmbeddingPipeline('Xenova/bge-small-en-v1.5', (info) => seen.push(info));
    expect(seen.map((e) => e.status)).toEqual(['initiate', 'progress', 'done']);
  });

  it('forwards the callback on the WASM retry after a WebGPU failure', async () => {
    setWebGPU(true);
    failWebGPU = true;
    downloadEvents = [{ status: 'progress', file: 'onnx/model.onnx', loaded: 1, total: 2 }];
    const seen: ModelDownloadInfo[] = [];
    await getSentimentPipeline('Xenova/finbert', (info) => seen.push(info));
    // Both attempts received the callback.
    expect(pipelineCalls.length).toBe(2);
    for (const call of pipelineCalls) {
      expect((call.options as { progress_callback?: unknown }).progress_callback).toBeTypeOf('function');
    }
    // Only the WASM retry got far enough to emit events — the WebGPU
    // attempt throws during pipeline creation before any download starts.
    expect(seen.length).toBe(1);
  });

  it('forwards through getNERPipeline and getLLMPipeline', async () => {
    setWebGPU(false);
    downloadEvents = [{ status: 'initiate', file: 'tokenizer.json' }];
    const nerSeen: ModelDownloadInfo[] = [];
    const llmSeen: ModelDownloadInfo[] = [];
    await getNERPipeline('Xenova/bert-large-NER-uncased', (info) => nerSeen.push(info));
    await getLLMPipeline('HuggingFaceTB/SmolLM2-135M-Instruct', (info) => llmSeen.push(info));
    expect(nerSeen.map((e) => e.status)).toEqual(['initiate']);
    expect(llmSeen.map((e) => e.status)).toEqual(['initiate']);
  });

  it('does not pass progress_callback when no callback is given', async () => {
    setWebGPU(false);
    await getEmbeddingPipeline('Xenova/bge-small-en-v1.5');
    expect(
      (pipelineCalls[0].options as { progress_callback?: unknown }).progress_callback,
    ).toBeUndefined();
  });

  it('a cancel throw inside the callback aborts pipeline creation', async () => {
    setWebGPU(false);
    downloadEvents = [{ status: 'initiate', file: 'onnx/model_quantized.onnx' }];
    const cancelError = new Error('Correlation cancelled by user.');
    const onDownload: ModelDownloadCallback = () => {
      throw cancelError;
    };
    await expect(
      getSentimentPipeline('Xenova/finbert', onDownload),
    ).rejects.toThrow('Correlation cancelled by user.');
  });
});