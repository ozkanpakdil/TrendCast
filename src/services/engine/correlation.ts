/**
 * Correlation Engine.
 *
 * The core logic that matches social signals and news headlines to
 * prediction market contracts based on keyword/entity overlap and
 * computes a confidence score.
 *
 * Algorithm:
 *   1. Extract keywords from both the contract question and the social post / news.
 *   2. Compute Jaccard similarity between keyword sets.
 *   3. Boost confidence for exact cashtag/hashtag matches (e.g., $BTC).
 *   4. Weight by the social signal's virality score (for social signals).
 *   5. Filter by a minimum confidence threshold.
 *
 * ⚠️ Pitfall: Pure keyword matching produces false positives. In production,
 *    you'd want NER (Named Entity Recognition) or an LLM to extract entities.
 *    For v0.1, keyword overlap is a reasonable starting point.
 */

import type {
  CorrelationMatch,
  MarketContract,
  NewsCorrelationMatch,
  NewsItem,
  SocialSignal,
} from '@/types';
import { keywordSimilarity } from '@/utils/keywords';

/** Minimum confidence score to include a match (0–1). */
const MIN_CONFIDENCE = 0.15;

/** Boost factor for exact cashtag/hashtag matches. */
const CASHTAG_BOOST = 0.3;

/**
 * Correlate a batch of social signals against a batch of market contracts.
 * Returns all matches above the confidence threshold, sorted by confidence.
 */
export function correlate(
  signals: SocialSignal[],
  contracts: MarketContract[],
): CorrelationMatch[] {
  const matches: CorrelationMatch[] = [];

  for (const signal of signals) {
    for (const contract of contracts) {
      const result = correlatePair(signal, contract);
      if (result) matches.push(result);
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

/** Correlate a single signal-contract pair. */
function correlatePair(signal: SocialSignal, contract: MarketContract): CorrelationMatch | null {
  const similarity = keywordSimilarity(signal.keywords, contract.keywords);
  if (similarity === 0) return null;

  const signalTags = signal.keywords.filter(
    (k) => k.startsWith('$') || signal.text.includes(`#${k}`),
  );
  const contractTags = contract.keywords.filter((k) => k.startsWith('$'));
  const tagOverlap = signalTags.filter((k) => contractTags.includes(k)).length;
  const boost = tagOverlap > 0 ? CASHTAG_BOOST * tagOverlap : 0;

  const viralityWeight = (signal.virality / 100) * 0.1;

  const confidence = Math.min(1, similarity + boost + viralityWeight);

  if (confidence < MIN_CONFIDENCE) return null;

  const matchedKeywords = signal.keywords.filter((k) => contract.keywords.includes(k));

  return {
    contract,
    signal,
    confidence,
    matchedKeywords,
    correlatedAt: Date.now(),
  };
}

/**
 * Correlate a batch of news headlines against a batch of market contracts.
 * Returns all matches above the confidence threshold, sorted by confidence.
 */
export function correlateNews(
  news: NewsItem[],
  contracts: MarketContract[],
): NewsCorrelationMatch[] {
  const matches: NewsCorrelationMatch[] = [];

  for (const item of news) {
    for (const contract of contracts) {
      const result = correlateNewsPair(item, contract);
      if (result) matches.push(result);
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

/** Correlate a single news-contract pair. */
function correlateNewsPair(
  news: NewsItem,
  contract: MarketContract,
): NewsCorrelationMatch | null {
  const similarity = keywordSimilarity(news.keywords, contract.keywords);
  if (similarity === 0) return null;

  // News doesn't have virality, so we use a slightly lower threshold boost.
  const confidence = Math.min(1, similarity + 0.05);

  if (confidence < MIN_CONFIDENCE) return null;

  const matchedKeywords = news.keywords.filter((k) => contract.keywords.includes(k));

  return {
    contract,
    news,
    confidence,
    matchedKeywords,
    correlatedAt: Date.now(),
  };
}