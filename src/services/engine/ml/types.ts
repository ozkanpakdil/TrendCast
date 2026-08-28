/**
 * Shared types, progress/cancellation primitives, and thresholds for the
 * ML correlation engines.
 */

export type CorrelationPhase =
  | 'loading-model'
  | 'embedding-contracts'
  | 'embedding-signals'
  | 'embedding-news'
  | 'comparing-signals'
  | 'comparing-news'
  | 'comparing-news-social'
  | 'comparing-news-news'
  | 'classifying-signals'
  | 'classifying-news'
  | 'classifying-news-social'
  | 'zero-shot-signals'
  | 'zero-shot-news'
  | 'zero-shot-news-social'
  | 'ner-extracting-signals'
  | 'ner-extracting-news'
  | 'ner-extracting-contracts'
  | 'ner-comparing-signals'
  | 'ner-comparing-news'
  | 'ner-comparing-news-social'
  | 'llm-generating-signals'
  | 'llm-generating-news'
  | 'llm-generating-news-social'
  | 'done';

export interface ProgressInfo {
  phase: CorrelationPhase;
  current: number;
  total: number;
  engine: 'embedding' | 'sentiment' | 'zeroshot' | 'ner' | 'llm';
  model: string;
}

export type ProgressCallback = (info: ProgressInfo) => void;

/** A mutable cancel flag. Set `cancelled = true` to abort the correlation. */
export interface CancelFlag {
  cancelled: boolean;
}

/** Check cancel flag and throw if cancelled. */
export function checkCancelled(flag: CancelFlag | undefined): void {
  if (flag?.cancelled) {
    throw new Error('Correlation cancelled by user.');
  }
}

// ── Thresholds ───────────────────────────────────────────────────

export const EMBEDDING_THRESHOLD = 0.45;

/**
 * Lower embedding threshold for pairs that share a canonical entity
 * (CORR-01 unified keys — e.g. "$NVDA breaking out" and "NVDA — VCP
 * 2026-08-27" both resolve to `nvidia`). Mirrors the heuristic engine's
 * MIN_CONFIDENCE_ENTITY_MATCH: a shared named entity is strong evidence of
 * topical identity, so thin screener headlines (mostly date/label tokens)
 * can bridge to ticker-centric social posts even though their raw cosine
 * sits between 0.35 and the general 0.45 bar. Pairs without a shared
 * entity still require the full EMBEDDING_THRESHOLD.
 */
export const EMBEDDING_ENTITY_THRESHOLD = 0.35;

export const SENTIMENT_THRESHOLD = 0.35;

/** Minimum entailment score for zero-shot classification matches. */
export const ZEROSHOT_THRESHOLD = 0.50;

/** Minimum entity similarity for ML-NER matches. */
export const NER_THRESHOLD = 0.35;

/** Minimum LLM confidence score (0–1) for a match. */
export const LLM_THRESHOLD = 0.40;

/**
 * Maximum tokens for LLM generation.
 * Per-signal mode: we ask for one score (0-100) per candidate question.
 * With up to 5 candidates → 5 numbers → ~20 tokens. Keep it tight.
 */
export const LLM_MAX_NEW_TOKENS = 20;

/**
 * Maximum candidate contracts per signal for LLM scoring.
 * LLM forward passes are extremely expensive on WASM CPU (2-10s each),
 * so we cap this much lower than zero-shot (15) to keep runtime reasonable.
 */
export const LLM_MAX_CANDIDATES = 5;

/**
 * Maximum number of candidate labels per zero-shot classification call.
 * NLI models have token limits and performance degrades with too many labels.
 * We pre-filter by keyword overlap, then cap to the top-K most promising.
 */
export const ZEROSHOT_MAX_LABELS = 15;