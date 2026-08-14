/**
 * Correlation Engine.
 *
 * The core logic that matches social signals and news headlines to
 * prediction market contracts based on entity + keyword overlap and
 * computes a confidence score.
 *
 * Algorithm:
 *   1. Extract entities (NER) from both the contract question and the social post / news.
 *   2. Compute weighted entity similarity (Jaccard on confidence-weighted entity sets).
 *   3. Fall back to keyword similarity for broader matching.
 *   4. Boost confidence for exact cashtag/hashtag matches (e.g., $BTC).
 *   5. Weight by the social signal's virality score (for social signals).
 *   6. Filter by a minimum confidence threshold.
 *
 * Phase 3: Now uses entity-based matching (NER) as the primary signal,
 * with keyword overlap as a secondary fallback for broader coverage.
 */

import type {
  CorrelationMatch,
  MarketContract,
  NewsCorrelationMatch,
  NewsItem,
  SocialSignal,
} from '@/types';
import { keywordSimilarity } from '@/utils/keywords';
import { entitySimilarity, extractEntityKeywords } from '@/utils/entities';

/** Minimum confidence score to include a match (0–1). */
const MIN_CONFIDENCE = 0.15;

/** Boost factor for exact cashtag/hashtag matches. */
const CASHTAG_BOOST = 0.3;

/** Weight for entity-based similarity (primary). */
const ENTITY_WEIGHT = 0.65;

/** Weight for keyword-based similarity (secondary/fallback). */
const KEYWORD_WEIGHT = 0.35;

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
  // Entity-based similarity (primary) — uses NER for precise matching
  const entSim = entitySimilarity(signal.text, contract.question);

  // Keyword-based similarity (secondary) — broader fallback
  const kwSim = keywordSimilarity(signal.keywords, contract.keywords);

  // Blend: weighted combination of entity + keyword similarity
  const baseSim = entSim * ENTITY_WEIGHT + kwSim * KEYWORD_WEIGHT;
  if (baseSim === 0) return null;

  // Cashtag/hashtag boost
  const signalTags = signal.keywords.filter(
    (k) => k.startsWith('$') || signal.text.includes(`#${k}`),
  );
  const contractTags = contract.keywords.filter((k) => k.startsWith('$'));
  const tagOverlap = signalTags.filter((k) => contractTags.includes(k)).length;
  const boost = tagOverlap > 0 ? CASHTAG_BOOST * tagOverlap : 0;

  const viralityWeight = (signal.virality / 100) * 0.1;

  const confidence = Math.min(1, baseSim + boost + viralityWeight);

  if (confidence < MIN_CONFIDENCE) return null;

  // Collect matched keywords from both entity and keyword overlap
  const matchedKeywords = signal.keywords.filter((k) => contract.keywords.includes(k));
  const entityKeywords = extractEntityKeywords(signal.text).filter((ek) =>
    extractEntityKeywords(contract.question).includes(ek),
  );
  const allMatched = [...new Set([...matchedKeywords, ...entityKeywords])];

  return {
    contract,
    signal,
    confidence,
    matchedKeywords: allMatched,
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
  // Entity-based similarity (primary)
  const entSim = entitySimilarity(news.headline, contract.question);

  // Keyword-based similarity (secondary)
  const kwSim = keywordSimilarity(news.keywords, contract.keywords);

  const baseSim = entSim * ENTITY_WEIGHT + kwSim * KEYWORD_WEIGHT;
  if (baseSim === 0) return null;

  // News doesn't have virality, so we use a slightly lower threshold boost.
  const confidence = Math.min(1, baseSim + 0.05);

  if (confidence < MIN_CONFIDENCE) return null;

  // Collect matched keywords from both entity and keyword overlap
  const matchedKeywords = news.keywords.filter((k) => contract.keywords.includes(k));
  const entityKeywords = extractEntityKeywords(news.headline).filter((ek) =>
    extractEntityKeywords(contract.question).includes(ek),
  );
  const allMatched = [...new Set([...matchedKeywords, ...entityKeywords])];

  return {
    contract,
    news,
    confidence,
    matchedKeywords: allMatched,
    correlatedAt: Date.now(),
  };
}