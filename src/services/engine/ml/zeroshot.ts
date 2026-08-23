/**
 * Zero-shot classification correlation engine.
 *
 * Uses a NLI (natural language inference) model to classify text against
 * arbitrary labels. For correlation, we use each contract question as a
 * candidate label and score how well each signal/news headline entails
 * (supports) that label.
 *
 * The zero-shot classification pipeline returns an array of scores for each
 * candidate label. We use the entailment score as the correlation confidence.
 *
 * ── Performance ──────────────────────────────────────────────────
 * Unlike the embedding/sentiment/NER pipelines, `ZeroShotClassificationPipeline`
 * does NOT batch across texts: its `_call` loops over each premise × each
 * hypothesis internally, so passing an array of texts does not reduce the
 * number of ONNX forward passes. The real cost control here is the keyword
 * pre-filter, which caps candidate labels at `ZEROSHOT_MAX_LABELS` per item.
 * We still share a single result cache across the three correlation passes so
 * a text scored against the same label set is never recomputed.
 */

import type {
  CorrelationMatch,
  MarketContract,
  NewsCorrelationMatch,
  NewsItem,
  NewsSocialCorrelationMatch,
  SocialSignal,
  ZeroShotModel,
} from '@/types';
import {
  type CancelFlag,
  type ProgressCallback,
  checkCancelled,
  ZEROSHOT_THRESHOLD,
  ZEROSHOT_MAX_LABELS,
} from './types';
import { getZeroShotPipeline } from './transformers';
import { getIncrementalIndex } from '../index';

/**
 * Zero-shot classification result from the pipeline.
 * The pipeline returns { labels: string[], scores: number[] } sorted by score.
 */
interface ZeroShotResult {
  labels: string[];
  scores: number[];
}

// ── Shared zero-shot store ───────────────────────────────────────
// Caches label→score maps by (text, labels) so a text scored against the
// same candidate labels in one pass is reused by the next.

class ZeroShotIndex {
  private readonly cache = new Map<string, Map<string, number>>();
  private readonly model: ZeroShotModel;

  constructor(model: ZeroShotModel) {
    this.model = model;
  }

  /**
   * Classify a text against candidate labels, returning a label→score map.
   * Results are cached by `text + "\u0000" + labels.join("\u0000")`.
   */
  async classify(
    text: string,
    labels: string[],
  ): Promise<Map<string, number>> {
    const key = text + '\u0000' + labels.join('\u0000');
    const cached = this.cache.get(key);
    if (cached) return cached;

    const pipeline = await getZeroShotPipeline(this.model);
    const output = (await pipeline(text, labels)) as ZeroShotResult;

    const result = new Map<string, number>();
    if (output && Array.isArray(output.labels) && Array.isArray(output.scores)) {
      for (let i = 0; i < output.labels.length; i++) {
        result.set(output.labels[i], output.scores[i]);
      }
    }

    this.cache.set(key, result);
    return result;
  }
}

/**
 * Correlate social signals against market contracts using zero-shot
 * classification. Uses keyword overlap as a pre-filter to avoid running
 * expensive NLI inference on all signal × contract pairs.
 */
export async function correlateZeroShot(
  signals: SocialSignal[],
  contracts: MarketContract[],
  model: ZeroShotModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<CorrelationMatch[]> {
  const index = new ZeroShotIndex(model);
  return correlateSignalsToContracts(index, signals, contracts, model, onProgress, cancelFlag);
}

/**
 * Correlate news headlines against market contracts using zero-shot
 * classification. Uses keyword overlap as a pre-filter.
 */
export async function correlateNewsZeroShot(
  news: NewsItem[],
  contracts: MarketContract[],
  model: ZeroShotModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<NewsCorrelationMatch[]> {
  const index = new ZeroShotIndex(model);
  return correlateNewsToContracts(index, news, contracts, model, onProgress, cancelFlag);
}

/**
 * Correlate news headlines against social signals using zero-shot
 * classification. Uses keyword overlap as a pre-filter — only classifies
 * signals against news headlines that share at least one keyword.
 */
export async function correlateNewsSocialZeroShot(
  news: NewsItem[],
  signals: SocialSignal[],
  model: ZeroShotModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<NewsSocialCorrelationMatch[]> {
  const index = new ZeroShotIndex(model);
  return correlateNewsToSignals(index, news, signals, model, onProgress, cancelFlag);
}

/**
 * Run all three zero-shot correlation passes with a single shared result
 * cache. A text scored against the same candidate labels is never recomputed
 * across passes — this is the fast path used by the ML worker.
 */
export async function correlateAllZeroShot(
  signals: SocialSignal[],
  contracts: MarketContract[],
  news: NewsItem[],
  model: ZeroShotModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<{
  matches: CorrelationMatch[];
  newsMatches: NewsCorrelationMatch[];
  newsSocialMatches: NewsSocialCorrelationMatch[];
}> {
  const index = new ZeroShotIndex(model);

  const matches = await correlateSignalsToContracts(index, signals, contracts, model, onProgress, cancelFlag);
  const newsMatches = await correlateNewsToContracts(index, news, contracts, model, onProgress, cancelFlag);
  const newsSocialMatches = await correlateNewsToSignals(index, news, signals, model, onProgress, cancelFlag);

  return { matches, newsMatches, newsSocialMatches };
}

// ── Internal implementations (share an index) ────────────────────

async function correlateSignalsToContracts(
  index: ZeroShotIndex,
  signals: SocialSignal[],
  contracts: MarketContract[],
  model: ZeroShotModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<CorrelationMatch[]> {
  const matches: CorrelationMatch[] = [];

  onProgress?.({ phase: 'zero-shot-signals', current: 0, total: signals.length, engine: 'zeroshot', model });
  // Pre-filter via the shared inverted index (single tokenization source).
  const candidateIndex = getIncrementalIndex(contracts);
  for (let i = 0; i < signals.length; i++) {
    checkCancelled(cancelFlag);

    // Pre-filter: only classify against contracts that share keywords
    const candidates = candidateIndex
      .candidates(signals[i].keywords)
      .slice(0, ZEROSHOT_MAX_LABELS)
      .map((idx) => contracts[idx]);
    if (candidates.length === 0) {
      if (i % 10 === 0 || i === signals.length - 1) {
        onProgress?.({ phase: 'zero-shot-signals', current: i + 1, total: signals.length, engine: 'zeroshot', model });
      }
      continue;
    }

    const candidateLabels = candidates.map((c) => c.question.slice(0, 200));
    const scores = await index.classify(signals[i].text, candidateLabels);
    if (i % 10 === 0 || i === signals.length - 1) {
      onProgress?.({ phase: 'zero-shot-signals', current: i + 1, total: signals.length, engine: 'zeroshot', model });
    }

    for (let j = 0; j < candidates.length; j++) {
      const entailmentScore = scores.get(candidateLabels[j]) ?? 0;
      if (entailmentScore < ZEROSHOT_THRESHOLD) continue;

      // Boost by virality (same as other engines)
      const viralityWeight = (signals[i].virality / 100) * 0.1;
      const confidence = Math.min(1, entailmentScore + viralityWeight);

      matches.push({
        contract: candidates[j],
        signal: signals[i],
        confidence,
        matchedKeywords: signals[i].keywords.filter((k) =>
          candidates[j].keywords.includes(k),
        ),
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

async function correlateNewsToContracts(
  index: ZeroShotIndex,
  news: NewsItem[],
  contracts: MarketContract[],
  model: ZeroShotModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<NewsCorrelationMatch[]> {
  const matches: NewsCorrelationMatch[] = [];

  onProgress?.({ phase: 'zero-shot-news', current: 0, total: news.length, engine: 'zeroshot', model });
  // Pre-filter via the shared inverted index (single tokenization source).
  const candidateIndex = getIncrementalIndex(contracts);
  for (let i = 0; i < news.length; i++) {
    checkCancelled(cancelFlag);

    // Pre-filter: only classify against contracts that share keywords
    const candidates = candidateIndex
      .candidates(news[i].keywords)
      .slice(0, ZEROSHOT_MAX_LABELS)
      .map((idx) => contracts[idx]);
    if (candidates.length === 0) {
      if (i % 10 === 0 || i === news.length - 1) {
        onProgress?.({ phase: 'zero-shot-news', current: i + 1, total: news.length, engine: 'zeroshot', model });
      }
      continue;
    }

    const candidateLabels = candidates.map((c) => c.question.slice(0, 200));
    const scores = await index.classify(news[i].headline, candidateLabels);
    if (i % 10 === 0 || i === news.length - 1) {
      onProgress?.({ phase: 'zero-shot-news', current: i + 1, total: news.length, engine: 'zeroshot', model });
    }

    for (let j = 0; j < candidates.length; j++) {
      const entailmentScore = scores.get(candidateLabels[j]) ?? 0;
      if (entailmentScore < ZEROSHOT_THRESHOLD) continue;

      matches.push({
        contract: candidates[j],
        news: news[i],
        confidence: Math.min(1, entailmentScore + 0.05),
        matchedKeywords: news[i].keywords.filter((k) =>
          candidates[j].keywords.includes(k),
        ),
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

async function correlateNewsToSignals(
  index: ZeroShotIndex,
  news: NewsItem[],
  signals: SocialSignal[],
  model: ZeroShotModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<NewsSocialCorrelationMatch[]> {
  const matches: NewsSocialCorrelationMatch[] = [];

  onProgress?.({ phase: 'zero-shot-news-social', current: 0, total: signals.length, engine: 'zeroshot', model });
  // Pre-filter via the shared inverted index over the news array (single tokenization source).
  const candidateIndex = getIncrementalIndex(news);
  for (let i = 0; i < signals.length; i++) {
    checkCancelled(cancelFlag);

    // Pre-filter: only classify against news that shares keywords with this signal
    const candidateNews = candidateIndex
      .candidates(signals[i].keywords)
      .slice(0, ZEROSHOT_MAX_LABELS)
      .map((idx) => news[idx]);

    if (candidateNews.length === 0) {
      if (i % 10 === 0 || i === signals.length - 1) {
        onProgress?.({ phase: 'zero-shot-news-social', current: i + 1, total: signals.length, engine: 'zeroshot', model });
      }
      continue;
    }

    const newsLabels = candidateNews.map((n) => n.headline.slice(0, 200));
    const scores = await index.classify(signals[i].text, newsLabels);
    if (i % 10 === 0 || i === signals.length - 1) {
      onProgress?.({ phase: 'zero-shot-news-social', current: i + 1, total: signals.length, engine: 'zeroshot', model });
    }

    for (let j = 0; j < candidateNews.length; j++) {
      const entailmentScore = scores.get(newsLabels[j]) ?? 0;
      if (entailmentScore < ZEROSHOT_THRESHOLD) continue;

      const viralityWeight = (signals[i].virality / 100) * 0.1;
      const confidence = Math.min(1, entailmentScore + viralityWeight);

      matches.push({
        news: candidateNews[j],
        signal: signals[i],
        confidence,
        matchedKeywords: candidateNews[j].keywords.filter((k) =>
          signals[i].keywords.includes(k),
        ),
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}