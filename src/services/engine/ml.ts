/**
 * ML-based correlation engine — public API barrel.
 *
 * This module re-exports the public surface of the ML correlation engines
 * split across the `ml/` subdirectory. Consumers (the background script and
 * the ML Web Worker) import from `@/services/engine/ml` as before — no
 * changes needed at call sites.
 *
 * Modules:
 *   - `ml/types`        — progress/cancel types, thresholds
 *   - `ml/transformers` — Transformers.js lazy loader, WASM config, pipeline caches
 *   - `ml/math`         — cosine similarity, mean pooling
 *   - `ml/embedding`    — embedding cosine-similarity engine (3 correlate fns)
 *   - `ml/sentiment`    — sentiment-classification engine (3 correlate fns)
 *   - `ml/zeroshot`     — zero-shot NLI classification engine (3 correlate fns)
 *   - `ml/ner`          — ML NER + weighted Jaccard engine (3 correlate fns)
 *   - `ml/llm`          — LLM text-generation engine (3 correlate fns)
 *
 * Two strategies are supported across engines:
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

// Types & primitives
export type {
  CorrelationPhase,
  ProgressInfo,
  ProgressCallback,
  CancelFlag,
} from './ml/types';

// Transformers.js setup
export { setWasmPath } from './ml/transformers';

// Embedding engine
export {
  correlateEmbedding,
  correlateNewsEmbedding,
  correlateNewsSocialEmbedding,
  correlateAllEmbedding,
} from './ml/embedding';

// Sentiment engine
export {
  correlateSentiment,
  correlateNewsSentiment,
  correlateNewsSocialSentiment,
  correlateAllSentiment,
} from './ml/sentiment';

// Zero-shot classification engine
export {
  correlateZeroShot,
  correlateNewsZeroShot,
  correlateNewsSocialZeroShot,
  correlateAllZeroShot,
} from './ml/zeroshot';

// NER engine
export {
  correlateNER,
  correlateNewsNER,
  correlateNewsSocialNER,
  correlateAllNER,
} from './ml/ner';

// LLM engine
export {
  correlateLLM,
  correlateNewsLLM,
  correlateNewsSocialLLM,
} from './ml/llm';

// ── Convenience helpers ──────────────────────────────────────────

import type {
  EmbeddingModel,
  LLMModel,
  NERModel,
  SentimentModel,
  ZeroShotModel,
} from '@/types';
import { getTransformers } from './ml/transformers';
import { getEmbeddingPipeline } from './ml/transformers';
import { getSentimentPipeline } from './ml/transformers';
import { getZeroShotPipeline } from './ml/transformers';
import { getNERPipeline } from './ml/transformers';
import { getLLMPipeline } from './ml/transformers';

/**
 * Preload an ML model so the first correlation run is fast.
 * Called when the user selects an ML engine in the settings UI.
 */
export async function preloadModel(
  engine: 'embedding' | 'sentiment' | 'zeroshot' | 'ner' | 'llm',
  model: string,
): Promise<void> {
  if (engine === 'embedding') {
    await getEmbeddingPipeline(model as EmbeddingModel);
  } else if (engine === 'sentiment') {
    await getSentimentPipeline(model as SentimentModel);
  } else if (engine === 'zeroshot') {
    await getZeroShotPipeline(model as ZeroShotModel);
  } else if (engine === 'ner') {
    await getNERPipeline(model as NERModel);
  } else if (engine === 'llm') {
    await getLLMPipeline(model as LLMModel);
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