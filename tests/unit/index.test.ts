/**
 * Unit tests for the shared InvertedIndex and incremental cache.
 *
 * Covers build/candidates/fallback (Task 1) and the comprehensive edge cases
 * mandated by D-03 (Task 2): empty keyword arrays, single contract, single
 * signal, duplicate keywords, cashtag/hashtag-only texts, tiny-input fallback,
 * and `includeEntityKeywords`.
 */

import { describe, it, expect } from 'vitest';
import {
  InvertedIndex,
  getIncrementalIndex,
  getInvertedIndex,
  type Indexable,
} from '@/services/engine/index';
import {
  mockContract,
  mockSignal,
  newsItem,
  cashtagOnlyContract,
  cashtagOnlySignal,
  hashtagOnlyContract,
  hashtagOnlySignal,
} from './fixtures';

describe('InvertedIndex.build', () => {
  it('populates the map with keyword → contract indices', () => {
    const idx = InvertedIndex.build([mockContract]);
    expect(idx.size).toBeGreaterThan(0);
    expect(idx.has('bitcoin')).toBe(true);
    expect(idx.has('btc')).toBe(true);
    expect(idx.has('100k')).toBe(true);
  });

  it('maps each keyword to the correct contract indices', () => {
    const a: Indexable = { id: 'a', keywords: ['btc', 'price'] };
    const b: Indexable = { id: 'b', keywords: ['btc', 'eth'] };
    const idx = InvertedIndex.build([a, b]);
    expect(idx.candidates(['btc'])).toEqual([0, 1]);
    expect(idx.candidates(['price'])).toEqual([0]);
    expect(idx.candidates(['eth'])).toEqual([1]);
  });

  it('deduplicates repeated keywords within a single item', () => {
    const idx = InvertedIndex.build([{ id: 'dup', keywords: ['btc', 'btc'] }]);
    expect(idx.candidates(['btc'])).toEqual([0]);
  });

  it('builds an empty index from an empty items array', () => {
    const idx = InvertedIndex.build([]);
    expect(idx.size).toBe(0);
    expect(idx.candidates(['btc'])).toEqual([]);
  });

  it('includeEntityKeywords adds entity-derived postings from question', () => {
    // "Powell" is a known person entity but is NOT in keywords.
    const item: Indexable = {
      id: 'powell',
      keywords: ['fed'],
      question: 'Will Powell cut rates in March?',
    };
    const without = InvertedIndex.build([item]);
    expect(without.has('powell')).toBe(false);

    const withEntities = InvertedIndex.build([item], { includeEntityKeywords: true });
    expect(withEntities.has('powell')).toBe(true);
    expect(withEntities.candidates(['powell'])).toEqual([0]);
  });

  it('caps distinct keyword cardinality (T-3-02)', () => {
    // 12k distinct keywords across items — only the first 10k are indexed.
    const items: Indexable[] = [];
    for (let i = 0; i < 12_000; i++) {
      items.push({ id: `c${i}`, keywords: [`kw${i}`] });
    }
    const idx = InvertedIndex.build(items);
    expect(idx.size).toBeLessThanOrEqual(10_000);
    // The first keyword is indexed; a keyword beyond the cap is not.
    expect(idx.has('kw0')).toBe(true);
    expect(idx.has('kw11999')).toBe(false);
  });
});

describe('InvertedIndex.candidates', () => {
  it('returns a deduplicated, order-preserving superset for overlapping keywords', () => {
    const a: Indexable = { id: 'a', keywords: ['btc', 'price'] };
    const b: Indexable = { id: 'b', keywords: ['btc', 'eth'] };
    const c: Indexable = { id: 'c', keywords: ['eth', 'moon'] };
    const idx = InvertedIndex.build([a, b, c]);
    // btc → [0,1], eth → [1,2]; union deduped in contract order.
    expect(idx.candidates(['btc', 'eth'])).toEqual([0, 1, 2]);
  });

  it('returns [] for an empty keyword array', () => {
    const idx = InvertedIndex.build([mockContract]);
    expect(idx.candidates([])).toEqual([]);
  });

  it('returns [] for keywords with no matches', () => {
    const idx = InvertedIndex.build([mockContract]);
    expect(idx.candidates(['nonexistent'])).toEqual([]);
  });

  it('single contract: matching keyword → [0], non-matching → []', () => {
    const idx = InvertedIndex.build([mockContract]);
    expect(idx.candidates(['bitcoin'])).toEqual([0]);
    expect(idx.candidates(['weather'])).toEqual([]);
  });

  it('single signal: one-keyword signal resolves to the correct contract index', () => {
    const idx = InvertedIndex.build([mockContract]);
    expect(idx.candidates(mockSignal.keywords)).toContain(0);
  });

  it('cashtag-only contract is found by its cashtag keyword', () => {
    const idx = InvertedIndex.build([cashtagOnlyContract]);
    expect(idx.candidates(['$btc'])).toEqual([0]);
    expect(idx.candidates(cashtagOnlySignal.keywords)).toEqual([0]);
  });

  it('hashtag-only contract is found by its hashtag-derived keyword', () => {
    const idx = InvertedIndex.build([hashtagOnlyContract]);
    expect(idx.candidates(['bitcoin'])).toEqual([0]);
    expect(idx.candidates(hashtagOnlySignal.keywords)).toEqual([0]);
  });
});

describe('InvertedIndex.TINY_INPUT_THRESHOLD', () => {
  it('is exported and equals 2', () => {
    expect(InvertedIndex.TINY_INPUT_THRESHOLD).toBe(2);
  });

  it('callers skip the index for inputs below the threshold', () => {
    // Fewer than TINY_INPUT_THRESHOLD items → the caller uses the naive loop.
    const items = [mockContract];
    const useIndex = items.length >= InvertedIndex.TINY_INPUT_THRESHOLD;
    expect(useIndex).toBe(false);
  });
});

describe('getIncrementalIndex / getInvertedIndex', () => {
  it('returns the same instance for an unchanged contract set', () => {
    const items = [mockContract];
    const first = getIncrementalIndex(items);
    const second = getIncrementalIndex(items);
    expect(second).toBe(first);
  });

  it('returns a fresh instance when the contract set changes', () => {
    const items = [mockContract];
    const first = getIncrementalIndex(items);
    const changed = getIncrementalIndex([{ ...mockContract, id: 'btc-200k' }]);
    expect(changed).not.toBe(first);
  });

  it('rebuilds when a contract keeps its id but its keywords change', () => {
    // mergeMarkets can overwrite a contract's keywords while the id stays
    // stable; an id-only cache key would return a stale index and drop
    // matches (PERF-02 equivalence). The keyword content must be in the key.
    const items = [mockContract];
    const first = getIncrementalIndex(items);
    const reworded = getIncrementalIndex([
      { ...mockContract, keywords: ['bitcoin', 'halving'] },
    ]);
    expect(reworded).not.toBe(first);
    expect(reworded.has('halving')).toBe(true);
    expect(reworded.has('100k')).toBe(false);
  });

  it('distinguishes build options in the cache key', () => {
    const items = [mockContract];
    const plain = getIncrementalIndex(items);
    const withEntities = getIncrementalIndex(items, { includeEntityKeywords: true });
    expect(withEntities).not.toBe(plain);
  });

  it('getInvertedIndex is an alias for getIncrementalIndex', () => {
    const items = [mockContract];
    expect(getInvertedIndex(items)).toBe(getIncrementalIndex(items));
  });
});

describe('newsItem fixture', () => {
  it('derives keywords from the headline', () => {
    const item = newsItem('bbc', 'Bitcoin surges past $100k');
    expect(item.keywords).toContain('bitcoin');
    expect(item.keywords).toContain('surges');
  });
});
