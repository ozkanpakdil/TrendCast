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

/**
 * Zero-shot classification result from the pipeline.
 * The pipeline returns { labels: string[], scores: number[] } sorted by score.
 */
interface ZeroShotResult {
  labels: string[];
  scores: number[];
}

/**
 * Classify a text against candidate labels using zero-shot classification.
 * Returns a map of label → entailment score.
 */
async function zeroShotClassify(
  text: string,
  labels: string[],
  model: ZeroShotModel,
): Promise<Map<string, number>> {
  const pipeline = await getZeroShotPipeline(model);
  const output = (await pipeline(text, labels)) as ZeroShotResult;

  const result = new Map<string, number>();
  if (output && Array.isArray(output.labels) && Array.isArray(output.scores)) {
    for (let i = 0; i < output.labels.length; i++) {
      result.set(output.labels[i], output.scores[i]);
    }
  }
  return result;
}

/**
 * Find candidate contracts for a signal based on keyword overlap.
 * This pre-filters before the expensive zero-shot classification,
 * reducing the number of NLI forward passes from O(signals × contracts)
 * to O(signals × min(matching_contracts, MAX_LABELS)).
 */
function findCandidateContracts(
  signalKeywords: string[],
  contracts: MarketContract[],
): MarketContract[] {
  const candidates = contracts
    .filter((c) => c.keywords.some((k) => signalKeywords.includes(k)))
    .slice(0, ZEROSHOT_MAX_LABELS);
  return candidates;
}

/**
 * Find candidate contracts for a news item based on keyword overlap.
 */
function findCandidateContractsForNews(
  newsKeywords: string[],
  contracts: MarketContract[],
): MarketContract[] {
  return contracts
    .filter((c) => c.keywords.some((k) => newsKeywords.includes(k)))
    .slice(0, ZEROSHOT_MAX_LABELS);
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
  const matches: CorrelationMatch[] = [];

  onProgress?.({ phase: 'zero-shot-signals', current: 0, total: signals.length, engine: 'zeroshot', model });
  for (let i = 0; i < signals.length; i++) {
    checkCancelled(cancelFlag);

    // Pre-filter: only classify against contracts that share keywords
    const candidates = findCandidateContracts(signals[i].keywords, contracts);
    if (candidates.length === 0) {
      if (i % 10 === 0 || i === signals.length - 1) {
        onProgress?.({ phase: 'zero-shot-signals', current: i + 1, total: signals.length, engine: 'zeroshot', model });
      }
      continue;
    }

    const candidateLabels = candidates.map((c) => c.question.slice(0, 200));
    const scores = await zeroShotClassify(signals[i].text, candidateLabels, model);
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
  const matches: NewsCorrelationMatch[] = [];

  onProgress?.({ phase: 'zero-shot-news', current: 0, total: news.length, engine: 'zeroshot', model });
  for (let i = 0; i < news.length; i++) {
    checkCancelled(cancelFlag);

    // Pre-filter: only classify against contracts that share keywords
    const candidates = findCandidateContractsForNews(news[i].keywords, contracts);
    if (candidates.length === 0) {
      if (i % 10 === 0 || i === news.length - 1) {
        onProgress?.({ phase: 'zero-shot-news', current: i + 1, total: news.length, engine: 'zeroshot', model });
      }
      continue;
    }

    const candidateLabels = candidates.map((c) => c.question.slice(0, 200));
    const scores = await zeroShotClassify(news[i].headline, candidateLabels, model);
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
  const matches: NewsSocialCorrelationMatch[] = [];

  onProgress?.({ phase: 'zero-shot-news-social', current: 0, total: signals.length, engine: 'zeroshot', model });
  for (let i = 0; i < signals.length; i++) {
    checkCancelled(cancelFlag);

    // Pre-filter: only classify against news that shares keywords with this signal
    const candidateNews = news
      .filter((n) => n.keywords.some((k) => signals[i].keywords.includes(k)))
      .slice(0, ZEROSHOT_MAX_LABELS);

    if (candidateNews.length === 0) {
      if (i % 10 === 0 || i === signals.length - 1) {
        onProgress?.({ phase: 'zero-shot-news-social', current: i + 1, total: signals.length, engine: 'zeroshot', model });
      }
      continue;
    }

    const newsLabels = candidateNews.map((n) => n.headline.slice(0, 200));
    const scores = await zeroShotClassify(signals[i].text, newsLabels, model);
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
        matchedKeywords: news[j].keywords.filter((k) =>
          signals[i].keywords.includes(k),
        ),
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}