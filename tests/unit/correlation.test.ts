/**
 * Unit tests for the keyword extraction and correlation engine.
 */

import { describe, it, expect } from 'vitest';
import { extractKeywords, keywordSimilarity } from '@/utils/keywords';
import { correlate } from '@/services/engine/correlation';
import type { MarketContract, SocialSignal } from '@/types';

describe('extractKeywords', () => {
  it('extracts hashtags', () => {
    const result = extractKeywords('Check out #Bitcoin and #Ethereum today');
    expect(result).toContain('bitcoin');
    expect(result).toContain('ethereum');
  });

  it('extracts cashtags', () => {
    const result = extractKeywords('$BTC to $100k soon');
    expect(result).toContain('$btc');
  });

  it('filters stop words', () => {
    const result = extractKeywords('the quick brown fox jumps over the lazy dog');
    expect(result).not.toContain('the');
    expect(result).toContain('quick');
    expect(result).toContain('brown');
    expect(result).toContain('fox');
  });

  it('handles empty text', () => {
    expect(extractKeywords('')).toEqual([]);
  });
});

describe('keywordSimilarity', () => {
  it('returns 1 for identical sets', () => {
    expect(keywordSimilarity(['btc', 'price'], ['btc', 'price'])).toBe(1);
  });

  it('returns 0 for disjoint sets', () => {
    expect(keywordSimilarity(['btc'], ['eth'])).toBe(0);
  });

  it('returns 0 for empty sets', () => {
    expect(keywordSimilarity([], [])).toBe(0);
  });

  it('returns fractional similarity for partial overlap', () => {
    const sim = keywordSimilarity(['btc', 'price', 'up'], ['btc', 'price', 'down']);
    // Intersection: {btc, price} = 2, Union: {btc, price, up, down} = 4
    expect(sim).toBeCloseTo(0.5, 5);
  });
});

describe('correlate', () => {
  const mockContract: MarketContract = {
    id: 'test-1',
    platform: 'polymarket',
    question: 'Will Bitcoin close above $100k on Dec 31?',
    outcomes: [
      { label: 'Yes', price: 0.65 },
      { label: 'No', price: 0.35 },
    ],
    endDate: '2025-12-31T23:59:59Z',
    keywords: ['bitcoin', 'btc', '100k', 'close', 'december'],
    lastUpdated: Date.now(),
  };

  const mockSignal: SocialSignal = {
    id: 'sig-1',
    platform: 'reddit',
    text: 'Bitcoin $BTC is going to the moon! #bitcoin',
    author: 'r/cryptocurrency',
    metrics: { likes: 5000, shares: 200, comments: 800 },
    timestamp: new Date().toISOString(),
    keywords: ['bitcoin', 'btc', 'moon'],
    sentiment: 0.8,
    virality: 85,
  };

  it('matches signals to contracts with overlapping keywords', () => {
    const matches = correlate([mockSignal], [mockContract]);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].confidence).toBeGreaterThan(0);
    expect(matches[0].matchedKeywords).toContain('bitcoin');
    expect(matches[0].matchedKeywords).toContain('btc');
  });

  it('does not match signals with no keyword overlap', () => {
    const unrelatedSignal: SocialSignal = {
      ...mockSignal,
      id: 'sig-2',
      text: 'The weather is nice today',
      keywords: ['weather', 'nice', 'today'],
    };
    const matches = correlate([unrelatedSignal], [mockContract]);
    expect(matches.length).toBe(0);
  });

  it('sorts matches by confidence descending', () => {
    const lowConfidenceSignal: SocialSignal = {
      ...mockSignal,
      id: 'sig-low',
      keywords: ['bitcoin'], // only 1 keyword overlap
      virality: 10,
    };
    const highConfidenceSignal: SocialSignal = {
      ...mockSignal,
      id: 'sig-high',
      keywords: ['bitcoin', 'btc', '100k', 'close'], // 4 keyword overlap
      virality: 90,
    };
    const matches = correlate([lowConfidenceSignal, highConfidenceSignal], [mockContract]);
    expect(matches.length).toBe(2);
    expect(matches[0].confidence).toBeGreaterThanOrEqual(matches[1].confidence);
  });
});