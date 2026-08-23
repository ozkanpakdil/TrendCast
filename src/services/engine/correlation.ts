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
  NewsSocialCorrelationMatch,
  NewsItem,
  SocialSignal,
} from '@/types';
import { keywordSimilarity } from '@/utils/keywords';
import { extractEntityKeywords, extractEntities } from '@/utils/entities';
import { InvertedIndex, getIncrementalIndex } from './index';

/** Minimum confidence score to include a match (0–1). */
const MIN_CONFIDENCE = 0.75;

/**
 * Cache of extracted entities keyed by text string.
 * Avoids re-running expensive NER regexes on the same text across
 * multiple correlation functions (correlate, correlateNews, correlateNewsSocial).
 */
class EntityCache {
  private entityKeywords = new Map<string, string[]>();
  private entityMaps = new Map<string, Map<string, number>>();

  getKeywords(text: string): string[] {
    let cached = this.entityKeywords.get(text);
    if (!cached) {
      cached = extractEntityKeywords(text);
      this.entityKeywords.set(text, cached);
    }
    return cached;
  }

  getConfidenceMap(text: string): Map<string, number> {
    let cached = this.entityMaps.get(text);
    if (!cached) {
      const entities = extractEntities(text);
      cached = new Map(entities.map((e) => [e.normalized, e.confidence]));
      this.entityMaps.set(text, cached);
    }
    return cached;
  }
}

/**
 * Compute entity similarity using cached entity maps.
 * Replaces the text-based entitySimilarity with a cache-aware version.
 */
function cachedEntitySimilarity(
  textA: string,
  textB: string,
  cache: EntityCache,
): number {
  const mapA = cache.getConfidenceMap(textA);
  const mapB = cache.getConfidenceMap(textB);

  if (mapA.size === 0 || mapB.size === 0) return 0;

  let intersectionWeight = 0;
  let unionWeight = 0;

  const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);
  for (const key of allKeys) {
    const wA = mapA.get(key) ?? 0;
    const wB = mapB.get(key) ?? 0;
    intersectionWeight += Math.min(wA, wB);
    unionWeight += Math.max(wA, wB);
  }

  return unionWeight > 0 ? intersectionWeight / unionWeight : 0;
}

/**
 * Lower threshold when the two texts share at least one named entity.
 * Short-text signals like X trends ("Bitcoin", "Trump") share a meaningful
 * entity with a contract but have low keyword overlap. This carve-out lets
 * them through while still filtering keyword-only false positives.
 */
const MIN_CONFIDENCE_ENTITY_MATCH = 0.35;

/** Boost factor for exact cashtag/hashtag matches. */
const CASHTAG_BOOST = 0.3;

/** Weight for entity-based similarity (primary). */
const ENTITY_WEIGHT = 0.65;

/** Weight for keyword-based similarity (secondary/fallback). */
const KEYWORD_WEIGHT = 0.35;

/**
 * Candidate keywords for the inverted-index query.
 *
 * The index is built with `includeEntityKeywords: true`, so it carries both
 * `item.keywords` and entity-derived postings. To preserve entity-only matches
 * (a signal/news whose *entity* — e.g. a cashtag `$BTC` → entity `btc`, or a
 * multi-word proper noun — is not present in its own `keywords` array), the
 * query must also include the item's entity-derived keywords. Otherwise the
 * indexed path would miss contracts the naive loop matches via
 * `cachedEntitySimilarity` (superset invariant, must-have truth #4).
 */
function candidateKeywords(keywords: string[], text: string): string[] {
  return [...new Set([...keywords, ...extractEntityKeywords(text)])];
}

/**
 * Correlate a batch of social signals against a batch of market contracts.
 * Returns all matches above the confidence threshold, sorted by confidence.
 */
export function correlate(
  signals: SocialSignal[],
  contracts: MarketContract[],
): CorrelationMatch[] {
  const matches: CorrelationMatch[] = [];
  const cache = new EntityCache();

  console.debug(
    `[TrendCast] Heuristic correlate: ${signals.length} signals × ${contracts.length} contracts`,
  );

  // Tiny-input fallback (D-03): below the threshold, the index build overhead
  // exceeds the loop cost, so keep the naive nested loop unchanged.
  if (contracts.length < InvertedIndex.TINY_INPUT_THRESHOLD) {
    for (const signal of signals) {
      for (const contract of contracts) {
        const result = correlatePair(signal, contract, cache);
        if (result) matches.push(result);
      }
    }
  } else {
    // Candidate-filtered path: index contracts once, then resolve each signal's
    // keyword set to a deduplicated, order-preserving superset of candidates.
    const index = getIncrementalIndex(contracts, { includeEntityKeywords: true });
    for (const signal of signals) {
      for (const i of index.candidates(candidateKeywords(signal.keywords, signal.text))) {
        const contract = contracts[i];
        const result = correlatePair(signal, contract, cache);
        if (result) matches.push(result);
      }
    }
  }

  console.debug(
    `[TrendCast] Heuristic correlate: produced ${matches.length} matches`,
  );

  return matches.sort((a, b) => b.confidence - a.confidence);
}

/** Correlate a single signal-contract pair. */
function correlatePair(
  signal: SocialSignal,
  contract: MarketContract,
  cache: EntityCache,
): CorrelationMatch | null {
  // Entity-based similarity (primary) — uses NER for precise matching
  const entSim = cachedEntitySimilarity(signal.text, contract.question, cache);

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

  // Use lower threshold when texts share at least one named entity (e.g., X trends)
  const sEntities = cache.getKeywords(signal.text);
  const cEntities = cache.getKeywords(contract.question);
  const hasEntityMatch = sEntities.some((e) => cEntities.includes(e));
  const threshold = hasEntityMatch ? MIN_CONFIDENCE_ENTITY_MATCH : MIN_CONFIDENCE;
  if (confidence < threshold) {
    console.debug(
      `[TrendCast] Heuristic reject: conf=${confidence.toFixed(3)} < threshold=${threshold.toFixed(3)} ` +
      `(entSim=${entSim.toFixed(3)}, kwSim=${kwSim.toFixed(3)}, entityMatch=${hasEntityMatch}) ` +
      `signal="${signal.text.slice(0, 50)}…" contract="${contract.question.slice(0, 50)}…"`,
    );
    return null;
  }

  // Collect matched keywords from both entity and keyword overlap
  const matchedKeywords = signal.keywords.filter((k) => contract.keywords.includes(k));
  const entityKeywords = sEntities.filter((ek) => cEntities.includes(ek));
  const allMatched = [...new Set([...matchedKeywords, ...entityKeywords])];

  console.debug(
    `[TrendCast] Heuristic match: conf=${confidence.toFixed(3)} keywords=[${allMatched.join(', ')}] ` +
    `signal="${signal.text.slice(0, 50)}…" contract="${contract.question.slice(0, 50)}…"`,
  );

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
  const cache = new EntityCache();

  // Tiny-input fallback (D-03): keep the naive loop below the threshold.
  if (contracts.length < InvertedIndex.TINY_INPUT_THRESHOLD) {
    for (const item of news) {
      for (const contract of contracts) {
        const result = correlateNewsPair(item, contract, cache);
        if (result) matches.push(result);
      }
    }
  } else {
    // Candidate-filtered path: index contracts once, resolve each news item's
    // keyword set to a deduplicated, order-preserving superset of candidates.
    const index = getIncrementalIndex(contracts, { includeEntityKeywords: true });
    for (const item of news) {
      for (const i of index.candidates(candidateKeywords(item.keywords, item.headline))) {
        const contract = contracts[i];
        const result = correlateNewsPair(item, contract, cache);
        if (result) matches.push(result);
      }
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

/** Correlate a single news-contract pair. */
function correlateNewsPair(
  news: NewsItem,
  contract: MarketContract,
  cache: EntityCache,
): NewsCorrelationMatch | null {
  // Entity-based similarity (primary)
  const entSim = cachedEntitySimilarity(news.headline, contract.question, cache);

  // Keyword-based similarity (secondary)
  const kwSim = keywordSimilarity(news.keywords, contract.keywords);

  const baseSim = entSim * ENTITY_WEIGHT + kwSim * KEYWORD_WEIGHT;
  if (baseSim === 0) return null;

  // News doesn't have virality, so we use a slightly lower threshold boost.
  const confidence = Math.min(1, baseSim + 0.05);

  // Use lower threshold when texts share at least one named entity
  const nEntities = cache.getKeywords(news.headline);
  const cEntities = cache.getKeywords(contract.question);
  const hasEntityMatch = nEntities.some((e) => cEntities.includes(e));
  const threshold = hasEntityMatch ? MIN_CONFIDENCE_ENTITY_MATCH : MIN_CONFIDENCE;
  if (confidence < threshold) return null;

  // Collect matched keywords from both entity and keyword overlap
  const matchedKeywords = news.keywords.filter((k) => contract.keywords.includes(k));
  const entityKeywords = nEntities.filter((ek) => cEntities.includes(ek));
  const allMatched = [...new Set([...matchedKeywords, ...entityKeywords])];

  return {
    contract,
    news,
    confidence,
    matchedKeywords: allMatched,
    correlatedAt: Date.now(),
  };
}

/**
 * Correlate news headlines against social signals.
 * Finds news stories that are driving social media discussion.
 * Returns all matches above the confidence threshold, sorted by confidence.
 */
export function correlateNewsSocial(
  news: NewsItem[],
  signals: SocialSignal[],
): NewsSocialCorrelationMatch[] {
  const matches: NewsSocialCorrelationMatch[] = [];
  const cache = new EntityCache();

  // Tiny-input fallback (D-03): keep the naive loop below the threshold.
  if (signals.length < InvertedIndex.TINY_INPUT_THRESHOLD) {
    for (const item of news) {
      for (const signal of signals) {
        const result = correlateNewsSocialPair(item, signal, cache);
        if (result) matches.push(result);
      }
    }
  } else {
    // Candidate-filtered path: index the signals array once, resolve each news
    // item's keyword set to a deduplicated, order-preserving superset of candidates.
    const index = getIncrementalIndex(signals, { includeEntityKeywords: true });
    for (const item of news) {
      for (const i of index.candidates(candidateKeywords(item.keywords, item.headline))) {
        const signal = signals[i];
        const result = correlateNewsSocialPair(item, signal, cache);
        if (result) matches.push(result);
      }
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

/** Correlate a single news-social pair. */
function correlateNewsSocialPair(
  news: NewsItem,
  signal: SocialSignal,
  cache: EntityCache,
): NewsSocialCorrelationMatch | null {
  // Entity-based similarity (primary)
  const entSim = cachedEntitySimilarity(news.headline, signal.text, cache);

  // Keyword-based similarity (secondary)
  const kwSim = keywordSimilarity(news.keywords, signal.keywords);

  const baseSim = entSim * ENTITY_WEIGHT + kwSim * KEYWORD_WEIGHT;
  if (baseSim === 0) return null;

  // Weight by signal virality — viral posts matching news are more significant
  const viralityWeight = (signal.virality / 100) * 0.1;
  const confidence = Math.min(1, baseSim + viralityWeight);

  // Use lower threshold when texts share at least one named entity
  const nEntities = cache.getKeywords(news.headline);
  const sEntities = cache.getKeywords(signal.text);
  const hasEntityMatch = nEntities.some((e) => sEntities.includes(e));
  const threshold = hasEntityMatch ? MIN_CONFIDENCE_ENTITY_MATCH : MIN_CONFIDENCE;
  if (confidence < threshold) return null;

  // Collect matched keywords from both entity and keyword overlap
  const matchedKeywords = news.keywords.filter((k) => signal.keywords.includes(k));
  const entityKeywords = nEntities.filter((ek) => sEntities.includes(ek));
  const allMatched = [...new Set([...matchedKeywords, ...entityKeywords])];

  return {
    news,
    signal,
    confidence,
    matchedKeywords: allMatched,
    correlatedAt: Date.now(),
  };
}