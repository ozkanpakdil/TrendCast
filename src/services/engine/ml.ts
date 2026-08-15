/**
 * ML-based correlation engine.
 *
 * Uses Hugging Face Transformers.js to run ML models fully client-side
 * in the browser extension. No API keys, no server calls — models are
 * downloaded from the Hugging Face Hub on first use and cached by the
 * browser's Cache API.
 *
 * Two strategies:
 *
 * 1. **Embedding** — embeds contract questions and social/news text into
 *    384-dim vectors, then computes cosine similarity. Much better
 *    semantic matching than keyword overlap (e.g., "Will Fed cut rates?"
 *    matches "Powell hints at borrowing cost relief").
 *
 * 2. **Sentiment** — classifies the sentiment of social/news text with a
 *    transformer model, then correlates same-topic items with divergent
 *    sentiment to market contracts (e.g., bearish social sentiment on a
 *    topic that has a "Yes" market contract → lower confidence).
 *
 * Models are lazy-loaded and cached per model ID so switching engines
 * in the UI doesn't re-download the model.
 */

import type {
  CorrelationMatch,
  EmbeddingModel,
  MarketContract,
  NewsCorrelationMatch,
  NewsItem,
  NewsSocialCorrelationMatch,
  SentimentModel,
  SocialSignal,
} from '@/types';

// NOTE: We intentionally do NOT import `browser` from '@/messaging/browser'
// (webextension-polyfill) here. That polyfill throws at import time when
// loaded in a Web Worker (no `chrome`/`browser` global). Instead, we access
// the extension API lazily via `globalThis` at the call site, wrapped in a
// try/catch. The worker sets `wasmPathOverride` before any pipeline runs,
// so `browser.runtime.getURL` is never called in worker context.

// ── Progress & cancellation support ──────────────────────────────
// When running in a Web Worker, the caller can pass a progress callback
// to receive updates on how many items have been processed. The cancel
// flag allows the caller to abort a long-running correlation early.

export type CorrelationPhase =
  | 'loading-model'
  | 'embedding-contracts'
  | 'embedding-signals'
  | 'embedding-news'
  | 'comparing-signals'
  | 'comparing-news'
  | 'comparing-news-social'
  | 'classifying-signals'
  | 'classifying-news'
  | 'classifying-news-social'
  | 'done';

export interface ProgressInfo {
  phase: CorrelationPhase;
  current: number;
  total: number;
  engine: 'embedding' | 'sentiment';
  model: string;
}

export type ProgressCallback = (info: ProgressInfo) => void;

/** A mutable cancel flag. Set `cancelled = true` to abort the correlation. */
export interface CancelFlag {
  cancelled: boolean;
}

/** Check cancel flag and throw if cancelled. */
function checkCancelled(flag: CancelFlag | undefined): void {
  if (flag?.cancelled) {
    throw new Error('Correlation cancelled by user.');
  }
}

// ── Transformers.js lazy import ───────────────────────────────────
// We import dynamically so the heavy ONNX runtime is only loaded when
// the user actually selects an ML engine. The heuristic engine (default)
// never touches this module, keeping the extension lightweight.

type Pipeline = (...args: unknown[]) => Promise<unknown>;

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
type EmbeddingResult = {
  data: number[] | number[][];
  logits?: number[] | number[][];
  last_hidden_state?: number[] | number[][];
};

type SentimentResult = Array<{ label: string; score: number }>;

interface TransformersLib {
  pipeline: (
    task: string,
    model: string,
    options?: { quantized?: boolean },
  ) => Promise<Pipeline>;
  env: {
    allowLocalModels: boolean;
    useBrowserCache: boolean;
    backends: {
      onnx: {
        wasm: {
          wasmPaths: string;
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

async function getTransformers(): Promise<TransformersLib> {
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
          const ext = (globalThis as any).browser ?? (globalThis as any).chrome;
          if (ext?.runtime?.getURL) {
            wasmBaseUrl = ext.runtime.getURL('wasm/');
          } else {
            throw new Error('No extension runtime available for WASM path');
          }
        }
        if (mod.env.backends?.onnx?.wasm) {
          mod.env.backends.onnx.wasm.wasmPaths = wasmBaseUrl;
          console.log('[TrendCast] ML: WASM path set to', wasmBaseUrl);
        } else {
          console.warn('[TrendCast] ML: onnx.wasm backend not found in env');
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

// ── Model cache ──────────────────────────────────────────────────

const pipelineCache = new Map<string, Promise<Pipeline>>();

async function getEmbeddingPipeline(model: EmbeddingModel): Promise<Pipeline> {
  let pipeline = pipelineCache.get(model);
  if (!pipeline) {
    console.log(`[TrendCast] ML: creating embedding pipeline for "${model}"…`);
    const lib = await getTransformers();
    pipeline = lib.pipeline('feature-extraction', model, { quantized: true }).then((p) => {
      console.log(`[TrendCast] ML: embedding pipeline "${model}" ready`);
      return p;
    }).catch((err) => {
      console.error(`[TrendCast] ML: embedding pipeline "${model}" failed:`, err);
      pipelineCache.delete(model);
      throw err;
    });
    pipelineCache.set(model, pipeline);
  }
  return pipeline;
}

async function getSentimentPipeline(model: SentimentModel): Promise<Pipeline> {
  let pipeline = pipelineCache.get(model);
  if (!pipeline) {
    console.log(`[TrendCast] ML: creating sentiment pipeline for "${model}"…`);
    const lib = await getTransformers();
    pipeline = lib.pipeline('text-classification', model, { quantized: true }).then((p) => {
      console.log(`[TrendCast] ML: sentiment pipeline "${model}" ready`);
      return p;
    }).catch((err) => {
      console.error(`[TrendCast] ML: sentiment pipeline "${model}" failed:`, err);
      pipelineCache.delete(model);
      throw err;
    });
    pipelineCache.set(model, pipeline);
  }
  return pipeline;
}

// ── Math helpers ─────────────────────────────────────────────────

/** Cosine similarity between two equal-length vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/** Mean-pool a 2D embedding [tokens][dims] into a single [dims] vector. */
function meanPool(tensor: number[][]): number[] {
  if (tensor.length === 0) return [];
  const dims = tensor[0].length;
  const result = new Array(dims).fill(0);
  for (const row of tensor) {
    for (let d = 0; d < dims; d++) {
      result[d] += row[d];
    }
  }
  for (let d = 0; d < dims; d++) {
    result[d] /= tensor.length;
  }
  return result;
}

// ── Embedding cache ──────────────────────────────────────────────
// Embeddings are computed once per text and reused across all pairs.

class EmbeddingCache {
  private embeddings = new Map<string, number[]>();

  async getEmbedding(text: string, model: EmbeddingModel): Promise<number[]> {
    const cached = this.embeddings.get(text);
    if (cached) return cached;

    const pipeline = await getEmbeddingPipeline(model);

    // Try with built-in pooling/normalize first (works for all-MiniLM-L6-v2).
    // If the model doesn't support these options (e.g., bge-small-en-v1.5
    // throws "logits is undefined"), fall back to raw output + manual pooling.
    let output: EmbeddingResult;
    try {
      output = (await pipeline(text, {
        pooling: 'mean',
        normalize: true,
      })) as EmbeddingResult;
    } catch (poolErr) {
      console.warn(
        `[TrendCast] ML: built-in pooling failed for "${model}", falling back to raw output:`,
        poolErr instanceof Error ? poolErr.message : poolErr,
      );
      // Get raw output without pooling/normalize options
      output = (await pipeline(text)) as EmbeddingResult;
    }

    // Determine the raw data array — some models put the tensor in
    // `data`, others in `logits` or `last_hidden_state`.
    const rawData =
      output.data ??
      output.logits ??
      output.last_hidden_state ??
      [];

    if (rawData.length === 0) {
      throw new Error(
        `Embedding model "${model}" returned empty output. ` +
          'The model may be incompatible with the installed Transformers.js version.',
      );
    }

    // If data is 1D (already pooled), use directly.
    // If data is 2D (token-level [tokens][dims]), mean-pool it.
    let vector: number[];
    if (Array.isArray(rawData[0])) {
      vector = meanPool(rawData as number[][]);
    } else {
      vector = rawData as number[];
    }

    // Normalize the vector (L2 norm = 1) if not already normalized
    let norm = 0;
    for (const v of vector) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm > 0) {
      vector = vector.map((v) => v / norm);
    }

    this.embeddings.set(text, vector);
    return vector;
  }

  clear(): void {
    this.embeddings.clear();
  }
}

// ── Sentiment helpers ────────────────────────────────────────────

/**
 * Classify sentiment of a text. Returns a score in [-1, +1] where
 * -1 = very negative, 0 = neutral, +1 = very positive.
 *
 * Different models use different label sets:
 *   - SST-2 / FinBERT:  { POSITIVE, NEGATIVE }
 *   - Twitter RoBERTa:  { positive, negative, neutral }
 *   - Tiny DistilBERT:  { LABEL_0, LABEL_1 }
 */
async function classifySentiment(
  text: string,
  model: SentimentModel,
): Promise<{ score: number; label: string }> {
  const pipeline = await getSentimentPipeline(model);
  const output = (await pipeline(text)) as SentimentResult;

  // text-classification returns an array of { label, score } entries
  // (one per input text). Take the first.
  const results = Array.isArray(output) ? output : [output];
  const top = results[0] ?? { label: 'neutral', score: 0.5 };

  // Normalise to [-1, +1]
  let score = 0;
  const label = top.label.toLowerCase();
  if (label.includes('pos') || label === 'label_1') {
    score = top.score;
  } else if (label.includes('neg') || label === 'label_0') {
    score = -top.score;
  } else {
    // neutral — map to a small magnitude
    score = 0;
  }

  return { score, label: top.label };
}

// ── Thresholds ───────────────────────────────────────────────────

const EMBEDDING_THRESHOLD = 0.45;
const SENTIMENT_THRESHOLD = 0.35;

// ── Public API ───────────────────────────────────────────────────

/**
 * Correlate social signals against market contracts using embedding
 * cosine similarity. Returns matches above the threshold, sorted by
 * confidence.
 */
export async function correlateEmbedding(
  signals: SocialSignal[],
  contracts: MarketContract[],
  model: EmbeddingModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<CorrelationMatch[]> {
  const matches: CorrelationMatch[] = [];
  const cache = new EmbeddingCache();

  // Pre-compute all contract embeddings (fewer contracts than signals)
  onProgress?.({ phase: 'embedding-contracts', current: 0, total: contracts.length, engine: 'embedding', model });
  const contractEmbeddings = new Map<string, number[]>();
  for (let i = 0; i < contracts.length; i++) {
    checkCancelled(cancelFlag);
    const emb = await cache.getEmbedding(contracts[i].question, model);
    contractEmbeddings.set(contracts[i].id, emb);
    if (i % 10 === 0 || i === contracts.length - 1) {
      onProgress?.({ phase: 'embedding-contracts', current: i + 1, total: contracts.length, engine: 'embedding', model });
    }
  }

  onProgress?.({ phase: 'embedding-signals', current: 0, total: signals.length, engine: 'embedding', model });
  for (let i = 0; i < signals.length; i++) {
    checkCancelled(cancelFlag);
    const signalEmb = await cache.getEmbedding(signals[i].text, model);
    if (i % 10 === 0 || i === signals.length - 1) {
      onProgress?.({ phase: 'embedding-signals', current: i + 1, total: signals.length, engine: 'embedding', model });
    }

    for (const contract of contracts) {
      const contractEmb = contractEmbeddings.get(contract.id)!;
      const sim = cosineSimilarity(signalEmb, contractEmb);

      if (sim < EMBEDDING_THRESHOLD) continue;

      // Boost by virality (same as heuristic engine)
      const viralityWeight = (signals[i].virality / 100) * 0.1;
      const confidence = Math.min(1, sim + viralityWeight);

      matches.push({
        contract,
        signal: signals[i],
        confidence,
        matchedKeywords: signals[i].keywords.filter((k) =>
          contract.keywords.includes(k),
        ),
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Correlate news headlines against market contracts using embedding
 * cosine similarity.
 */
export async function correlateNewsEmbedding(
  news: NewsItem[],
  contracts: MarketContract[],
  model: EmbeddingModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<NewsCorrelationMatch[]> {
  const matches: NewsCorrelationMatch[] = [];
  const cache = new EmbeddingCache();

  // Pre-compute contract embeddings (reuse cache from prior call if same model)
  onProgress?.({ phase: 'embedding-contracts', current: 0, total: contracts.length, engine: 'embedding', model });
  const contractEmbeddings = new Map<string, number[]>();
  for (let i = 0; i < contracts.length; i++) {
    checkCancelled(cancelFlag);
    const emb = await cache.getEmbedding(contracts[i].question, model);
    contractEmbeddings.set(contracts[i].id, emb);
    if (i % 10 === 0 || i === contracts.length - 1) {
      onProgress?.({ phase: 'embedding-contracts', current: i + 1, total: contracts.length, engine: 'embedding', model });
    }
  }

  onProgress?.({ phase: 'embedding-news', current: 0, total: news.length, engine: 'embedding', model });
  for (let i = 0; i < news.length; i++) {
    checkCancelled(cancelFlag);
    const newsEmb = await cache.getEmbedding(news[i].headline, model);
    if (i % 10 === 0 || i === news.length - 1) {
      onProgress?.({ phase: 'embedding-news', current: i + 1, total: news.length, engine: 'embedding', model });
    }

    for (const contract of contracts) {
      const contractEmb = contractEmbeddings.get(contract.id)!;
      const sim = cosineSimilarity(newsEmb, contractEmb);

      if (sim < EMBEDDING_THRESHOLD) continue;

      matches.push({
        contract,
        news: news[i],
        confidence: Math.min(1, sim + 0.05),
        matchedKeywords: news[i].keywords.filter((k) =>
          contract.keywords.includes(k),
        ),
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Correlate news headlines against social signals using embedding
 * cosine similarity.
 */
export async function correlateNewsSocialEmbedding(
  news: NewsItem[],
  signals: SocialSignal[],
  model: EmbeddingModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<NewsSocialCorrelationMatch[]> {
  const matches: NewsSocialCorrelationMatch[] = [];
  const cache = new EmbeddingCache();

  onProgress?.({ phase: 'embedding-news', current: 0, total: news.length, engine: 'embedding', model });
  for (let i = 0; i < news.length; i++) {
    checkCancelled(cancelFlag);
    const newsEmb = await cache.getEmbedding(news[i].headline, model);
    if (i % 10 === 0 || i === news.length - 1) {
      onProgress?.({ phase: 'embedding-news', current: i + 1, total: news.length, engine: 'embedding', model });
    }

    for (let j = 0; j < signals.length; j++) {
      const signalEmb = await cache.getEmbedding(signals[j].text, model);
      const sim = cosineSimilarity(newsEmb, signalEmb);

      if (sim < EMBEDDING_THRESHOLD) continue;

      const viralityWeight = (signals[j].virality / 100) * 0.1;
      const confidence = Math.min(1, sim + viralityWeight);

      matches.push({
        news: news[i],
        signal: signals[j],
        confidence,
        matchedKeywords: news[i].keywords.filter((k) =>
          signals[j].keywords.includes(k),
        ),
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Correlate social signals against market contracts using a sentiment
 * classifier. The idea: if social sentiment on a topic is strongly
 * directional (bullish/bearish) and the market contract asks about
 * that topic, the correlation confidence is higher.
 *
 * We use keyword overlap to find candidate pairs (same as heuristic),
 * then use the sentiment classifier to refine the confidence.
 */
export async function correlateSentiment(
  signals: SocialSignal[],
  contracts: MarketContract[],
  model: SentimentModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<CorrelationMatch[]> {
  const matches: CorrelationMatch[] = [];

  onProgress?.({ phase: 'classifying-signals', current: 0, total: signals.length, engine: 'sentiment', model });
  for (let i = 0; i < signals.length; i++) {
    checkCancelled(cancelFlag);
    // Classify the signal's sentiment with the ML model
    const { score: mlSentiment } = await classifySentiment(signals[i].text, model);
    if (i % 5 === 0 || i === signals.length - 1) {
      onProgress?.({ phase: 'classifying-signals', current: i + 1, total: signals.length, engine: 'sentiment', model });
    }

    for (const contract of contracts) {
      // Use keyword overlap as candidate filter
      const matchedKeywords = signals[i].keywords.filter((k) =>
        contract.keywords.includes(k),
      );
      if (matchedKeywords.length === 0) continue;

      // Base confidence from keyword overlap ratio
      const overlapRatio =
        matchedKeywords.length /
        Math.max(signals[i].keywords.length, contract.keywords.length, 1);

      // Sentiment magnitude — stronger sentiment = more confident correlation
      const sentimentMagnitude = Math.abs(mlSentiment);

      // Virality boost
      const viralityWeight = (signals[i].virality / 100) * 0.1;

      const confidence = Math.min(
        1,
        overlapRatio * 0.5 + sentimentMagnitude * 0.3 + viralityWeight,
      );

      if (confidence < SENTIMENT_THRESHOLD) continue;

      matches.push({
        contract,
        signal: signals[i],
        confidence,
        matchedKeywords,
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Correlate news headlines against market contracts using a sentiment
 * classifier.
 */
export async function correlateNewsSentiment(
  news: NewsItem[],
  contracts: MarketContract[],
  model: SentimentModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<NewsCorrelationMatch[]> {
  const matches: NewsCorrelationMatch[] = [];

  onProgress?.({ phase: 'classifying-news', current: 0, total: news.length, engine: 'sentiment', model });
  for (let i = 0; i < news.length; i++) {
    checkCancelled(cancelFlag);
    const { score: mlSentiment } = await classifySentiment(news[i].headline, model);
    if (i % 5 === 0 || i === news.length - 1) {
      onProgress?.({ phase: 'classifying-news', current: i + 1, total: news.length, engine: 'sentiment', model });
    }

    for (const contract of contracts) {
      const matchedKeywords = news[i].keywords.filter((k) =>
        contract.keywords.includes(k),
      );
      if (matchedKeywords.length === 0) continue;

      const overlapRatio =
        matchedKeywords.length /
        Math.max(news[i].keywords.length, contract.keywords.length, 1);

      const sentimentMagnitude = Math.abs(mlSentiment);

      const confidence = Math.min(1, overlapRatio * 0.5 + sentimentMagnitude * 0.3 + 0.05);

      if (confidence < SENTIMENT_THRESHOLD) continue;

      matches.push({
        contract,
        news: news[i],
        confidence,
        matchedKeywords,
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Correlate news headlines against social signals using a sentiment
 * classifier.
 */
export async function correlateNewsSocialSentiment(
  news: NewsItem[],
  signals: SocialSignal[],
  model: SentimentModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<NewsSocialCorrelationMatch[]> {
  const matches: NewsSocialCorrelationMatch[] = [];

  onProgress?.({ phase: 'classifying-news-social', current: 0, total: news.length, engine: 'sentiment', model });
  for (let i = 0; i < news.length; i++) {
    checkCancelled(cancelFlag);
    const { score: newsSentiment } = await classifySentiment(news[i].headline, model);
    if (i % 5 === 0 || i === news.length - 1) {
      onProgress?.({ phase: 'classifying-news-social', current: i + 1, total: news.length, engine: 'sentiment', model });
    }

    for (let j = 0; j < signals.length; j++) {
      const matchedKeywords = news[i].keywords.filter((k) =>
        signals[j].keywords.includes(k),
      );
      if (matchedKeywords.length === 0) continue;

      const { score: signalSentiment } = await classifySentiment(signals[j].text, model);

      // If news and social sentiment align (both bullish or both bearish),
      // the correlation is stronger.
      const sentimentAlignment =
        1 - Math.abs(newsSentiment - signalSentiment) / 2;

      const overlapRatio =
        matchedKeywords.length /
        Math.max(news[i].keywords.length, signals[j].keywords.length, 1);

      const viralityWeight = (signals[j].virality / 100) * 0.1;

      const confidence = Math.min(
        1,
        overlapRatio * 0.4 + sentimentAlignment * 0.3 + viralityWeight,
      );

      if (confidence < SENTIMENT_THRESHOLD) continue;

      matches.push({
        news: news[i],
        signal: signals[j],
        confidence,
        matchedKeywords,
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Preload an ML model so the first correlation run is fast.
 * Called when the user selects an ML engine in the settings UI.
 */
export async function preloadModel(
  engine: 'embedding' | 'sentiment',
  model: string,
): Promise<void> {
  if (engine === 'embedding') {
    await getEmbeddingPipeline(model as EmbeddingModel);
  } else {
    await getSentimentPipeline(model as SentimentModel);
  }
}

/**
 * Check whether the ML runtime is available (Transformers.js loaded).
 * Used by the UI to show a warning if the ML backend fails to load.
 */
export async function isMLAvailable(): Promise<boolean> {
  try {
    await getTransformers();
    return true;
  } catch {
    return false;
  }
}