/**
 * Transformers.js lazy loader, WASM path configuration, and per-task
 * pipeline caches.
 *
 * We import dynamically so the heavy ONNX runtime is only loaded when
 * the user actually selects an ML engine. The heuristic engine (default)
 * never touches this module, keeping the extension lightweight.
 *
 * NOTE: We intentionally do NOT import `browser` from '@/messaging/browser'
 * (webextension-polyfill) here. That polyfill throws at import time when
 * loaded in a Web Worker (no `chrome`/`browser` global). Instead, we access
 * the extension API lazily via `globalThis` at the call site, wrapped in a
 * try/catch. The worker sets `wasmPathOverride` before any pipeline runs,
 * so `browser.runtime.getURL` is never called in worker context.
 */

import type {
  EmbeddingModel,
  LLMModel,
  NERModel,
  SentimentModel,
} from '@/types';
import { cosineSimilarity, meanPool } from './math';

export type Pipeline = (...args: unknown[]) => Promise<unknown>;

/**
 * Raw model output from a feature-extraction pipeline.
 *
 * Different models return different tensor structures:
 * - all-MiniLM-L6-v2: { data: number[] } when pooling/normalize are applied
 * - bge-small-en-v1.5: { data: number[][] } (token-level embeddings) or
 *   may throw if the built-in pooling option can't find `logits`
 *
 * We handle both cases: if the output is already pooled (1D), use it
 * directly; if it's token-level (2D), mean-pool it ourselves.
 */
export type EmbeddingResult = {
  data: number[] | number[][];
  logits?: number[] | number[][];
  last_hidden_state?: number[] | number[][];
};

export type SentimentResult = Array<{ label: string; score: number }>;

export interface TransformersLib {
  pipeline: (
    task: string,
    model: string,
    options?: { quantized?: boolean; device?: string; dtype?: string },
  ) => Promise<Pipeline>;
  env: {
    allowLocalModels: boolean;
    useBrowserCache: boolean;
    backends: {
      onnx: {
        wasm: {
          wasmPaths: string;
          numThreads?: number;
        };
      };
    };
  };
}

let transformersPromise: Promise<TransformersLib> | null = null;

/**
 * Override the WASM path from outside. Used when running in a Web Worker
 * where `browser.runtime.getURL` is not available — the caller can compute
 * the extension URL via `self.location` or pass it in explicitly.
 */
let wasmPathOverride: string | null = null;

export function setWasmPath(path: string): void {
  wasmPathOverride = path;
}

export async function getTransformers(): Promise<TransformersLib> {
  if (!transformersPromise) {
    console.log('[TrendCast] ML: importing @huggingface/transformers…');
    transformersPromise = import('@huggingface/transformers').then((mod) => {
      console.log('[TrendCast] ML: transformers.js loaded, configuring env…');
      // Configure for browser extension use:
      // - Don't try to load local .onnx files from disk (we have none).
      // - Use the browser Cache API for model downloads.
      mod.env.allowLocalModels = false;
      mod.env.useBrowserCache = true;

      // CRITICAL: Point ONNX Runtime Web to the WASM files bundled locally
      // in the extension (public/wasm/). Without this, ORT defaults to
      // loading from cdn.jsdelivr.net, which is blocked by the extension's
      // CSP (script-src 'self'). The .mjs and .wasm files are copied to
      // dist/wasm/ at build time and served from the extension's own origin.
      //
      // browser.runtime.getURL returns the full extension URL, e.g.:
      //   chrome-extension://<id>/wasm/
      //   moz-extension://<id>/wasm/
      try {
        // In a Web Worker, `wasmPathOverride` is set by the worker before
        // any pipeline is created. In the background script, we fall back
        // to `browser.runtime.getURL` via the global extension API.
        //
        // We use `globalThis` rather than importing webextension-polyfill
        // because the polyfill throws at import time in worker contexts.
        let wasmBaseUrl: string;
        if (wasmPathOverride) {
          wasmBaseUrl = wasmPathOverride;
        } else {
          const ext = (globalThis as { browser?: { runtime?: { getURL?: (path: string) => string } }; chrome?: { runtime?: { getURL?: (path: string) => string } } }).browser ?? (globalThis as { chrome?: { runtime?: { getURL?: (path: string) => string } } }).chrome;
          if (ext?.runtime?.getURL) {
            wasmBaseUrl = ext.runtime.getURL('wasm/');
          } else {
            throw new Error('No extension runtime available for WASM path');
          }
        }
        if (mod.env.backends?.onnx?.wasm) {
          mod.env.backends.onnx.wasm.wasmPaths = wasmBaseUrl;
          // Use multiple threads for faster WASM inference — ORT supports
          // multi-threaded SIMD when cross-origin isolation is enabled.
          // Default is 1, which is very slow for LLMs. Try to use all cores.
          const numThreads = Math.max(1, (navigator?.hardwareConcurrency ?? 4) - 1);
          mod.env.backends.onnx.wasm.numThreads = numThreads;
          console.log('[TrendCast] ML: WASM path set to', wasmBaseUrl, '| threads:', numThreads);
        } else {
          console.warn('[TrendCast] ML: onnx.wasm backend not found in env');
        }

        // Detect WebGPU availability — if present, LLMs can run 10-50× faster
        try {
          const gpu = (navigator as unknown as { gpu?: unknown }).gpu;
          if (gpu) {
            console.log('[TrendCast] ML: ✅ WebGPU detected — LLMs will use GPU acceleration');
          } else {
            console.log('[TrendCast] ML: ❌ WebGPU not available — LLMs will use WASM CPU (slow)');
          }
        } catch {
          console.log('[TrendCast] ML: ❌ WebGPU not available — LLMs will use WASM CPU (slow)');
        }
      } catch (e) {
        // In non-extension contexts (tests), browser.runtime may not exist.
        // ORT will fall back to its default CDN path, which is fine for tests.
        console.warn('[TrendCast] ML: could not set WASM path (non-extension context?):', e);
      }

      console.log('[TrendCast] ML: transformers.js ready');
      return mod as unknown as TransformersLib;
    }).catch((err) => {
      console.error('[TrendCast] ML: failed to import @huggingface/transformers:', err);
      transformersPromise = null; // allow retry on next call
      throw err;
    });
  }
  return transformersPromise;
}

// ── Device / dtype resolution (Phase 8, PERF-04, D-04) ─────────────

/**
 * Preferred dtype fallback chain, smallest first. When WebGPU is available
 * we pick the smallest dtype the model supports to minimise download size
 * and inference cost; if a dtype is unsupported we fall back to the next.
 */
export const DTYPE_FALLBACK_CHAIN = ['q4', 'q8', 'fp16', 'fp32'] as const;

/**
 * Dtype allow-list for embedding (feature-extraction) pipelines.
 *
 * q4 is deliberately excluded: 4-bit quantization measurably distorts
 * embedding vectors, shifting cosine similarities enough to push marginal
 * pairs below EMBEDDING_THRESHOLD (0.45) — or, worse, produce degenerate
 * near-identical vectors (observed: gte-small + q4 on WebGPU matched 100%
 * of signal→market pairs). q8 (int8) was the pre-Phase-8 behavior and is
 * also the smaller download (~23 MB vs ~55 MB for q4 on MiniLM).
 */
export const EMBEDDING_SUPPORTED_DTYPES = ['q8', 'fp16', 'fp32'] as const;

export type ResolvedDevice = { device?: string; dtype?: string };

/**
 * Shared device + dtype resolution used by every `get*Pipeline()`.
 *
 * Detects `navigator.gpu`; if present, returns `device: 'webgpu'` with the
 * smallest supported dtype from `DTYPE_FALLBACK_CHAIN`. If WebGPU is absent
 * (or detection throws), returns an empty object so the caller uses the
 * default WASM CPU path with no dtype override.
 *
 * @param supportedDtypes optional list of dtypes the model supports; when
 *   omitted, the smallest dtype in the chain is always chosen.
 */
export function resolveDeviceAndDtype(supportedDtypes?: readonly string[]): ResolvedDevice {
  try {
    const gpu = (navigator as unknown as { gpu?: unknown }).gpu;
    if (gpu) {
      const dtype = DTYPE_FALLBACK_CHAIN.find(
        (d) => !supportedDtypes || supportedDtypes.includes(d),
      );
      return { device: 'webgpu', dtype };
    }
  } catch {
    // WebGPU detection failed — fall through to WASM CPU.
  }
  return {};
}

/**
 * Create a pipeline with WebGPU→WASM catch-and-retry fallback (D-04).
 *
 * Resolves device/dtype via `resolveDeviceAndDtype()`, attempts the pipeline
 * on WebGPU, and on failure retries once on WASM CPU. Used by all five
 * `get*Pipeline()` functions so the fallback lives at a single choke point.
 */
async function createPipelineWithFallback(
  lib: TransformersLib,
  task: string,
  model: string,
  supportedDtypes?: readonly string[],
): Promise<Pipeline> {
  const resolved = resolveDeviceAndDtype(supportedDtypes);
  const options: { quantized: boolean; device?: string; dtype?: string } = {
    quantized: true, // q4 quantization for smaller download + faster inference
  };
  if (resolved.device) options.device = resolved.device;
  if (resolved.dtype) options.dtype = resolved.dtype;

  try {
    const p = await lib.pipeline(task, model, options);
    console.log(
      `[TrendCast] ML: ${task} pipeline "${model}" ready on ${resolved.device ?? 'wasm-cpu'}` +
        (resolved.dtype ? ` (dtype=${resolved.dtype})` : ''),
    );
    return p;
  } catch (err) {
    // If WebGPU failed, retry with WASM CPU.
    if (resolved.device) {
      console.warn(`[TrendCast] ML: ${task} WebGPU failed for "${model}":`, err);
      console.log(`[TrendCast] ML: Retrying ${task} pipeline with WASM CPU…`);
      return lib.pipeline(task, model, { quantized: true });
    }
    throw err;
  }
}

// ── Embedding sanity check (WebGPU garbage-output guard) ──────────

/**
 * Probe texts for the embedding sanity check.
 *
 * `related` pair shares strong semantic content; `unrelated` pair shares
 * none. A healthy MiniLM scores the related pair ≥ 0.5 and the unrelated
 * pair ≤ 0.4 — a clear margin. Degenerate backends (Firefox WebGPU with
 * quantized models) collapse all cosines toward ~1.0 or ~0.0, failing the
 * margin check.
 */
const SANITY_RELATED = [
  'The Federal Reserve cut interest rates by 25 basis points.',
  'The central bank lowered borrowing costs in its latest policy decision.',
];
const SANITY_UNRELATED = [
  'The Federal Reserve cut interest rates by 25 basis points.',
  'The recipe requires two cups of flour and three eggs.',
];

/** Minimum cosine gap between related and unrelated pairs for a healthy backend. */
const SANITY_MIN_GAP = 0.15;

/**
 * Verify a freshly created embedding pipeline produces meaningful vectors.
 *
 * Firefox's WebGPU execution provider silently returns garbage for
 * quantized embedding models (session creation succeeds, vectors are junk —
 * observed: 61% of unrelated pairs above threshold). This probe embeds a
 * related pair and an unrelated pair and requires the related cosine to
 * beat the unrelated cosine on WASM CPU — the known-good backend.
 *
 * @returns true if the pipeline output is sane, false if degenerate.
 */
async function isEmbeddingPipelineSane(pipeline: Pipeline): Promise<boolean> {
  try {
    const embed = async (texts: string[]): Promise<number[][]> => {
      const out = (await pipeline(texts, { pooling: 'mean', normalize: true })) as {
        data?: number[] | number[][];
        dims?: number[];
      };
      const data = out.data ?? [];
      if (data.length === 0) return [];
      // Flat layout: [dims] for a single text, or [batch * dims] pooled.
      if (typeof data[0] === 'number') {
        const dims = out.dims?.[out.dims.length - 1] ?? data.length;
        if (data.length === dims) return [data as number[]];
        const rows = data.length / dims;
        return Array.from({ length: rows }, (_, i) =>
          (data as number[]).slice(i * dims, (i + 1) * dims),
        );
      }
      const first = (data as unknown as number[][][])[0];
      if (Array.isArray(first?.[0])) {
        // Token-level [batch][tokens][dims] → mean-pool each item.
        return (data as unknown as number[][][]).map((item) => meanPool(item));
      }
      // Already pooled [batch][dims].
      return data as number[][];
    };

    const [a, b] = await embed(SANITY_RELATED);
    const [c, d] = await embed(SANITY_UNRELATED);
    if (!a?.length || !b?.length || !c?.length || !d?.length) return false;

    const related = cosineSimilarity(a, b);
    const unrelated = cosineSimilarity(c, d);
    const gap = related - unrelated;
    console.log(
      `[TrendCast] ML: embedding sanity check — related=${related.toFixed(3)}, ` +
        `unrelated=${unrelated.toFixed(3)}, gap=${gap.toFixed(3)}`,
    );
    return gap >= SANITY_MIN_GAP;
  } catch (err) {
    console.warn('[TrendCast] ML: embedding sanity check threw:', err);
    return false;
  }
}

// ── Model cache ──────────────────────────────────────────────────

const pipelineCache = new Map<string, Promise<Pipeline>>();

/** Clear all cached pipelines. Test-only — lets tests start from a cold cache. */
export function resetPipelineCaches(): void {
  pipelineCache.clear();
}

export async function getEmbeddingPipeline(model: EmbeddingModel): Promise<Pipeline> {
  let pipeline = pipelineCache.get(model);
  if (!pipeline) {
    console.log(`[TrendCast] ML: creating embedding pipeline for "${model}"…`);
    const lib = await getTransformers();
    pipeline = createPipelineWithFallback(lib, 'feature-extraction', model, [
      ...EMBEDDING_SUPPORTED_DTYPES,
    ])
      .then(async (p) => {
        // WebGPU can silently produce garbage vectors for quantized
        // embedding models (Firefox: session creation succeeds, output is
        // junk). Probe the pipeline; if degenerate, rebuild on WASM CPU.
        const resolved = resolveDeviceAndDtype([...EMBEDDING_SUPPORTED_DTYPES]);
        if (resolved.device === 'webgpu' && !(await isEmbeddingPipelineSane(p))) {
          console.warn(
            `[TrendCast] ML: WebGPU embedding output is degenerate for "${model}" — ` +
              'falling back to WASM CPU (known-good backend).',
          );
          const wasmPipeline = await lib.pipeline('feature-extraction', model, { quantized: true });
          if (!(await isEmbeddingPipelineSane(wasmPipeline))) {
            throw new Error(
              `Embedding pipeline "${model}" produced degenerate output on both WebGPU and WASM.`,
            );
          }
          console.log(`[TrendCast] ML: WASM embedding pipeline "${model}" passed sanity check.`);
          return wasmPipeline;
        }
        return p;
      })
      .catch((err) => {
        console.error(`[TrendCast] ML: embedding pipeline "${model}" failed:`, err);
        pipelineCache.delete(model);
        throw err;
      });
    pipelineCache.set(model, pipeline);
  }
  return pipeline;
}

export async function getSentimentPipeline(model: SentimentModel): Promise<Pipeline> {
  let pipeline = pipelineCache.get(model);
  if (!pipeline) {
    console.log(`[TrendCast] ML: creating sentiment pipeline for "${model}"…`);
    const lib = await getTransformers();
    pipeline = createPipelineWithFallback(lib, 'text-classification', model).catch((err) => {
      console.error(`[TrendCast] ML: sentiment pipeline "${model}" failed:`, err);
      pipelineCache.delete(model);
      throw err;
    });
    pipelineCache.set(model, pipeline);
  }
  return pipeline;
}

// ── NER (token classification) pipeline ─────────────────────────────
// Uses a transformer NER model to extract named entities (PER, ORG, LOC, MISC)
// from text. Replaces the regex-based entity extraction in the heuristic engine.

export async function getNERPipeline(model: NERModel): Promise<Pipeline> {
  let pipeline = pipelineCache.get(model);
  if (!pipeline) {
    console.log(`[TrendCast] ML: creating NER pipeline for "${model}"…`);
    const lib = await getTransformers();
    pipeline = createPipelineWithFallback(lib, 'token-classification', model).catch((err) => {
      console.error(`[TrendCast] ML: NER pipeline "${model}" failed:`, err);
      pipelineCache.delete(model);
      throw err;
    });
    pipelineCache.set(model, pipeline);
  }
  return pipeline;
}

// ── LLM (text-generation) pipeline ────────────────────────────────
// Uses a small instruction-tuned LLM to perform correlation assessment
// by prompting the model with the signal/news text and contract question.
// The LLM generates a structured response with a confidence score.
//
// ⚠️ LLM models are much larger than other ML models (270 MB – 1.5 GB).
// On CPU (WASM) they are very slow. WebGPU is strongly recommended.

export async function getLLMPipeline(model: LLMModel): Promise<Pipeline> {
  let pipeline = pipelineCache.get(model);
  if (!pipeline) {
    console.log(`[TrendCast] ML: creating LLM text-generation pipeline for "${model}"…`);
    const lib = await getTransformers();
    pipeline = createPipelineWithFallback(lib, 'text-generation', model).catch((err) => {
      console.error(`[TrendCast] ML: LLM pipeline "${model}" failed on all backends:`, err);
      pipelineCache.delete(model);
      throw err;
    });
    pipelineCache.set(model, pipeline);
  }
  return pipeline;
}