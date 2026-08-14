/**
 * Correlation Engine.
 *
 * The core logic that matches social signals to prediction market contracts
 * based on keyword/entity overlap and computes a confidence score.
 *
 * Algorithm:
 *   1. Extract keywords from both the contract question and the social post.
 *   2. Compute Jaccard similarity between keyword sets.
 *   3. Boost confidence for exact cashtag/hashtag matches (e.g., $BTC).
 *   4. Weight by the social signal's virality score.
 *   5. Filter by a minimum confidence threshold.
 *
 * ⚠️ Pitfall: Pure keyword matching produces false positives. In production,
 *    you'd want NER (Named Entity Recognition) or an LLM to extract entities.
 *    For v0.1, keyword overlap is a reasonable starting point.
 */

import type { CorrelationMatch, MarketContract, SocialSignal } from '@/types';
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

  // Sort by confidence descending.
  return matches.sort((a, b) => b.confidence - a.confidence);
}

/** Correlate a single signal-contract pair. */
function correlatePair(signal: SocialSignal, contract: MarketContract): CorrelationMatch | null {
  // Base similarity: Jaccard overlap of keyword sets.
  const similarity = keywordSimilarity(signal.keywords, contract.keywords);
  if (similarity === 0) return null;

  // Boost: exact cashtag/hashtag matches (e.g., $btc in both).
  const signalTags = signal.keywords.filter((k) => k.startsWith('$') || signal.text.includes(`#${k}`));
  const contractTags = contract.keywords.filter((k) => k.startsWith('$'));
  const tagOverlap = signalTags.filter((k) => contractTags.includes(k)).length;
  const boost = tagOverlap > 0 ? CASHTAG_BOOST * tagOverlap : 0;

  // Virality weight: high-virality signals get a small confidence bump.
  const viralityWeight = (signal.virality / 100) * 0.1;

  const confidence = Math.min(1, similarity + boost + viralityWeight);

  if (confidence < MIN_CONFIDENCE) return null;

  const matchedKeywords = signal.keywords.filter((k) =>
    contract.keywords.includes(k),
  );

  return {
    contract,
    signal,
    confidence,
    matchedKeywords,
    correlatedAt: Date.now(),
  };
}