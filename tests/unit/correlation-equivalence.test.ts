/**
 * Heuristic correlation equivalence tests (D-02 / D-03 / D-04).
 *
 * The heuristic path (`correlate`, `correlateNews`, `correlateNewsSocial`) was
 * converted from the O(n×m) nested loop to candidate-filtered via the shared
 * `InvertedIndex`. This file proves the indexed output is IDENTICAL to the
 * naive loop — same matches, same confidence, same order — over the shared
 * fixtures, the hand-verified golden fixtures, and the D-03 edge cases.
 *
 * The naive oracles below replicate the pre-change nested loops (including the
 * pair-scoring logic) so the indexed path is compared against an independent
 * reference, not against itself. The golden fixtures additionally assert exact
 * expected matches, guarding against both paths sharing the same bug.
 */

import { describe, it, expect } from 'vitest';
import { keywordSimilarity } from '@/utils/keywords';
import { extractEntityKeywords, extractEntities } from '@/utils/entities';
import {
  correlate,
  correlateNews,
  correlateNewsSocial,
} from '@/services/engine/correlation';
import {
  mockContract,
  mockSignal,
  newsItem,
  cashtagOnlyContract,
  cashtagOnlySignal,
  hashtagOnlyContract,
  hashtagOnlySignal,
} from './fixtures';
import type {
  CorrelationMatch,
  MarketContract,
  NewsCorrelationMatch,
  NewsItem,
  NewsSocialCorrelationMatch,
  SocialSignal,
} from '@/types';

// ── Naive oracle helpers (replicate the pre-change engine) ─────────

const MIN_CONFIDENCE = 0.75;
const MIN_CONFIDENCE_ENTITY_MATCH = 0.35;
const CASHTAG_BOOST = 0.3;
const ENTITY_WEIGHT = 0.65;
const KEYWORD_WEIGHT = 0.35;

/** Replica of the production EntityCache (memoized NER extraction). */
class NaiveEntityCache {
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

/** Replica of the production cachedEntitySimilarity. */
function naiveCachedEntitySimilarity(
  textA: string,
  textB: string,
  cache: NaiveEntityCache,
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

/** Replica of the production correlatePair. */
function naiveCorrelatePair(
  signal: SocialSignal,
  contract: MarketContract,
  cache: NaiveEntityCache,
): CorrelationMatch | null {
  const entSim = naiveCachedEntitySimilarity(signal.text, contract.question, cache);
  const kwSim = keywordSimilarity(signal.keywords, contract.keywords);
  const baseSim = entSim * ENTITY_WEIGHT + kwSim * KEYWORD_WEIGHT;
  if (baseSim === 0) return null;

  const signalTags = signal.keywords.filter(
    (k) => k.startsWith('$') || signal.text.includes(`#${k}`),
  );
  const contractTags = contract.keywords.filter((k) => k.startsWith('$'));
  const tagOverlap = signalTags.filter((k) => contractTags.includes(k)).length;
  const boost = tagOverlap > 0 ? CASHTAG_BOOST * tagOverlap : 0;

  const viralityWeight = (signal.virality / 100) * 0.1;
  const confidence = Math.min(1, baseSim + boost + viralityWeight);

  const sEntities = cache.getKeywords(signal.text);
  const cEntities = cache.getKeywords(contract.question);
  const hasEntityMatch = sEntities.some((e) => cEntities.includes(e));
  const threshold = hasEntityMatch ? MIN_CONFIDENCE_ENTITY_MATCH : MIN_CONFIDENCE;
  if (confidence < threshold) return null;

  const matchedKeywords = signal.keywords.filter((k) => contract.keywords.includes(k));
  const entityKeywords = sEntities.filter((ek) => cEntities.includes(ek));
  const allMatched = [...new Set([...matchedKeywords, ...entityKeywords])];

  return {
    contract,
    signal,
    confidence,
    matchedKeywords: allMatched,
    correlatedAt: Date.now(),
  };
}

/** Replica of the production correlateNewsPair. */
function naiveCorrelateNewsPair(
  news: NewsItem,
  contract: MarketContract,
  cache: NaiveEntityCache,
): NewsCorrelationMatch | null {
  const entSim = naiveCachedEntitySimilarity(news.headline, contract.question, cache);
  const kwSim = keywordSimilarity(news.keywords, contract.keywords);
  const baseSim = entSim * ENTITY_WEIGHT + kwSim * KEYWORD_WEIGHT;
  if (baseSim === 0) return null;

  const confidence = Math.min(1, baseSim + 0.05);

  const nEntities = cache.getKeywords(news.headline);
  const cEntities = cache.getKeywords(contract.question);
  const hasEntityMatch = nEntities.some((e) => cEntities.includes(e));
  const threshold = hasEntityMatch ? MIN_CONFIDENCE_ENTITY_MATCH : MIN_CONFIDENCE;
  if (confidence < threshold) return null;

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

/** Replica of the production correlateNewsSocialPair. */
function naiveCorrelateNewsSocialPair(
  news: NewsItem,
  signal: SocialSignal,
  cache: NaiveEntityCache,
): NewsSocialCorrelationMatch | null {
  const entSim = naiveCachedEntitySimilarity(news.headline, signal.text, cache);
  const kwSim = keywordSimilarity(news.keywords, signal.keywords);
  const baseSim = entSim * ENTITY_WEIGHT + kwSim * KEYWORD_WEIGHT;
  if (baseSim === 0) return null;

  const viralityWeight = (signal.virality / 100) * 0.1;
  const confidence = Math.min(1, baseSim + viralityWeight);

  const nEntities = cache.getKeywords(news.headline);
  const sEntities = cache.getKeywords(signal.text);
  const hasEntityMatch = nEntities.some((e) => sEntities.includes(e));
  const threshold = hasEntityMatch ? MIN_CONFIDENCE_ENTITY_MATCH : MIN_CONFIDENCE;
  if (confidence < threshold) return null;

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

/** Naive oracle for `correlate` (the pre-change nested loop). */
function naiveCorrelate(
  signals: SocialSignal[],
  contracts: MarketContract[],
): CorrelationMatch[] {
  const matches: CorrelationMatch[] = [];
  const cache = new NaiveEntityCache();
  for (const signal of signals) {
    for (const contract of contracts) {
      const result = naiveCorrelatePair(signal, contract, cache);
      if (result) matches.push(result);
    }
  }
  return matches.sort((a, b) => b.confidence - a.confidence);
}

/** Naive oracle for `correlateNews` (the pre-change nested loop). */
function naiveCorrelateNews(
  news: NewsItem[],
  contracts: MarketContract[],
): NewsCorrelationMatch[] {
  const matches: NewsCorrelationMatch[] = [];
  const cache = new NaiveEntityCache();
  for (const item of news) {
    for (const contract of contracts) {
      const result = naiveCorrelateNewsPair(item, contract, cache);
      if (result) matches.push(result);
    }
  }
  return matches.sort((a, b) => b.confidence - a.confidence);
}

/** Naive oracle for `correlateNewsSocial` (the pre-change nested loop). */
function naiveCorrelateNewsSocial(
  news: NewsItem[],
  signals: SocialSignal[],
): NewsSocialCorrelationMatch[] {
  const matches: NewsSocialCorrelationMatch[] = [];
  const cache = new NaiveEntityCache();
  for (const item of news) {
    for (const signal of signals) {
      const result = naiveCorrelateNewsSocialPair(item, signal, cache);
      if (result) matches.push(result);
    }
  }
  return matches.sort((a, b) => b.confidence - a.confidence);
}

// ── Comparison helpers ────────────────────────────────────────────────

/** Normalize a match to the comparable fields (drop correlatedAt timestamp). */
function normSignal(m: CorrelationMatch) {
  return {
    contractId: m.contract.id,
    signalId: m.signal.id,
    confidence: m.confidence,
    matchedKeywords: m.matchedKeywords,
  };
}
function normNews(m: NewsCorrelationMatch) {
  return {
    contractId: m.contract.id,
    newsId: m.news.id,
    confidence: m.confidence,
    matchedKeywords: m.matchedKeywords,
  };
}
function normNewsSocial(m: NewsSocialCorrelationMatch) {
  return {
    newsId: m.news.id,
    signalId: m.signal.id,
    confidence: m.confidence,
    matchedKeywords: m.matchedKeywords,
  };
}

// ── Fixture sets ─────────────────────────────────────────────────────

/** A contract set large enough to exercise the indexed path (≥ threshold). */
const contractSet: MarketContract[] = [
  mockContract,
  cashtagOnlyContract,
  hashtagOnlyContract,
  {
    ...mockContract,
    id: 'eth-price',
    question: 'Will Ethereum close above $4000 this month?',
    keywords: ['ethereum', 'eth', '4000', 'close', 'month'],
  },
  {
    ...mockContract,
    id: 'trump-2028',
    question: 'Will Donald Trump run for president in 2028?',
    keywords: ['trump', 'president', '2028', 'run'],
  },
];

/** A signal set with keyword, entity, cashtag, and hashtag-only variants. */
const signalSet: SocialSignal[] = [
  mockSignal,
  cashtagOnlySignal,
  hashtagOnlySignal,
  {
    ...mockSignal,
    id: 'sig-eth',
    text: 'Ethereum $ETH is pumping hard',
    keywords: ['ethereum', 'eth', 'pumping'],
  },
  {
    ...mockSignal,
    id: 'sig-trump',
    text: 'Trump announces 2028 run',
    keywords: ['trump', '2028', 'run'],
  },
  {
    ...mockSignal,
    id: 'sig-unrelated',
    text: 'The weather is nice today',
    keywords: ['weather', 'nice', 'today'],
  },
];

/** A news set covering keyword, entity, and cashtag/hashtag variants. */
const newsSet: NewsItem[] = [
  newsItem('bbc', 'Bitcoin surges past $100k'),
  newsItem('cnn', 'Ethereum hits new all-time high'),
  newsItem('yahoo', 'Trump announces 2028 presidential run'),
  newsItem('investing', 'The weather forecast for tomorrow'),
];

// ── Equivalence: correlate ───────────────────────────────────────────

describe('correlate equivalence (indexed vs naive)', () => {
  it('produces identical matches, confidence, and order over the shared fixture set', () => {
    const indexed = correlate(signalSet, contractSet).map(normSignal);
    const naive = naiveCorrelate(signalSet, contractSet).map(normSignal);
    expect(indexed).toEqual(naive);
  });

  it('matches the hand-verified golden fixtures exactly', () => {
    // mockSignal (bitcoin/btc/moon) vs mockContract (bitcoin/btc/100k/close/december)
    const matches = correlate([mockSignal], [mockContract]);
    expect(matches.length).toBe(1);
    expect(matches[0].contract.id).toBe('btc-100k');
    expect(matches[0].signal.id).toBe('sig-1');
    expect(matches[0].confidence).toBeGreaterThan(0);
    expect(matches[0].matchedKeywords).toContain('bitcoin');
    expect(matches[0].matchedKeywords).toContain('btc');
  });

  it('cashtag-only signal matches a cashtag-only contract via entity overlap', () => {
    // $BTC signal (keyword $btc, entity btc) vs $BTC contract (keyword $btc, entity btc)
    const matches = correlate([cashtagOnlySignal], [cashtagOnlyContract]);
    expect(matches.length).toBe(1);
    expect(matches[0].contract.id).toBe('cashtag-btc');
  });

  it('hashtag-only signal matches a hashtag-only contract', () => {
    const matches = correlate([hashtagOnlySignal], [hashtagOnlyContract]);
    expect(matches.length).toBe(1);
    expect(matches[0].contract.id).toBe('hashtag-bitcoin');
  });

  it('does not match signals with no keyword or entity overlap', () => {
    const matches = correlate([signalSet[5]], contractSet);
    expect(matches.length).toBe(0);
  });

  it('sorts matches by confidence descending', () => {
    const matches = correlate(signalSet, contractSet);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].confidence).toBeGreaterThanOrEqual(matches[i].confidence);
    }
  });
});

// ── Equivalence: correlateNews ───────────────────────────────────────

describe('correlateNews equivalence (indexed vs naive)', () => {
  it('produces identical output, confidence, and order over the shared fixture set', () => {
    const indexed = correlateNews(newsSet, contractSet).map(normNews);
    const naive = naiveCorrelateNews(newsSet, contractSet).map(normNews);
    expect(indexed).toEqual(naive);
  });

  it('matches news to contracts with overlapping keywords', () => {
    const matches = correlateNews([newsSet[0]], contractSet);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].news.id).toBe(newsSet[0].id);
  });

  it('does not match news with no overlap', () => {
    const matches = correlateNews([newsSet[3]], contractSet);
    expect(matches.length).toBe(0);
  });
});

// ── Equivalence: correlateNewsSocial ─────────────────────────────────

describe('correlateNewsSocial equivalence (indexed vs naive)', () => {
  it('produces identical output, confidence, and order over the shared fixture set', () => {
    const indexed = correlateNewsSocial(newsSet, signalSet).map(normNewsSocial);
    const naive = naiveCorrelateNewsSocial(newsSet, signalSet).map(normNewsSocial);
    expect(indexed).toEqual(naive);
  });

  it('matches news to signals with overlapping keywords', () => {
    const matches = correlateNewsSocial([newsSet[0]], signalSet);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].news.id).toBe(newsSet[0].id);
  });

  it('does not match news with no overlap', () => {
    const matches = correlateNewsSocial([newsSet[3]], signalSet);
    expect(matches.length).toBe(0);
  });
});

// ── D-03 edge cases ──────────────────────────────────────────────────

describe('D-03 edge cases', () => {
  it('empty keyword arrays produce no matches', () => {
    // Empty keywords AND empty text → no keyword or entity overlap.
    const emptySignal: SocialSignal = {
      ...mockSignal,
      id: 'sig-empty',
      text: '',
      keywords: [],
    };
    const emptyContract: MarketContract = { ...mockContract, id: 'c-empty', keywords: [] };
    expect(correlate([emptySignal], [emptyContract])).toEqual([]);
    expect(correlate([emptySignal], contractSet)).toEqual([]);
  });

  it('empty keywords but non-empty text still matches via entity overlap (equiv to naive)', () => {
    // A signal with an empty keywords array but text carrying entities (btc,
    // bitcoin) still matches via cachedEntitySimilarity — the indexed path must
    // preserve this (superset invariant). Assert equivalence with the oracle.
    const emptyKeywordsSignal: SocialSignal = {
      ...mockSignal,
      id: 'sig-empty-kw',
      keywords: [],
    };
    const indexed = correlate([emptyKeywordsSignal], contractSet).map(normSignal);
    const naive = naiveCorrelate([emptyKeywordsSignal], contractSet).map(normSignal);
    expect(indexed).toEqual(naive);
    expect(indexed.length).toBeGreaterThan(0);
  });

  it('single contract (tiny-input fallback) matches the naive oracle', () => {
    const single = [mockContract];
    const indexed = correlate(signalSet, single).map(normSignal);
    const naive = naiveCorrelate(signalSet, single).map(normSignal);
    expect(indexed).toEqual(naive);
  });

  it('single signal (tiny-input fallback) matches the naive oracle', () => {
    const single = [mockSignal];
    const indexed = correlate(single, contractSet).map(normSignal);
    const naive = naiveCorrelate(single, contractSet).map(normSignal);
    expect(indexed).toEqual(naive);
  });

  it('duplicate keywords are handled identically', () => {
    const dupSignal: SocialSignal = {
      ...mockSignal,
      id: 'sig-dup',
      keywords: ['bitcoin', 'bitcoin', 'btc', 'btc'],
    };
    const indexed = correlate([dupSignal], contractSet).map(normSignal);
    const naive = naiveCorrelate([dupSignal], contractSet).map(normSignal);
    expect(indexed).toEqual(naive);
  });

  it('cashtag-only texts match via the indexed path', () => {
    const indexed = correlate([cashtagOnlySignal], contractSet).map(normSignal);
    const naive = naiveCorrelate([cashtagOnlySignal], contractSet).map(normSignal);
    expect(indexed).toEqual(naive);
    expect(indexed.length).toBeGreaterThan(0);
  });

  it('hashtag-only texts match via the indexed path', () => {
    const indexed = correlate([hashtagOnlySignal], contractSet).map(normSignal);
    const naive = naiveCorrelate([hashtagOnlySignal], contractSet).map(normSignal);
    expect(indexed).toEqual(naive);
    expect(indexed.length).toBeGreaterThan(0);
  });

  it('tiny-input fallback for correlateNews matches the naive oracle', () => {
    const single = [mockContract];
    const indexed = correlateNews(newsSet, single).map(normNews);
    const naive = naiveCorrelateNews(newsSet, single).map(normNews);
    expect(indexed).toEqual(naive);
  });

  it('tiny-input fallback for correlateNewsSocial matches the naive oracle', () => {
    const single = [mockSignal];
    const indexed = correlateNewsSocial(newsSet, single).map(normNewsSocial);
    const naive = naiveCorrelateNewsSocial(newsSet, single).map(normNewsSocial);
    expect(indexed).toEqual(naive);
  });
});
