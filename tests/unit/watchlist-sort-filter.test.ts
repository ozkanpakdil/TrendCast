/**
 * Unit tests for the watchlist sort/filter + correlation-status helpers (D-04, D-05, D-07).
 */

import { describe, it, expect } from 'vitest';
import {
  sortWatchlist,
  filterWatchlist,
  correlationStatusFor,
  correlationDirectionFor,
} from '@/dashboard/utils/watchlistView';
import { mockContract, mockSignal, newsItem } from './fixtures';
import type { CorrelationResult, WatchlistEntry } from '@/types';

function entry(contractId: string, platform: 'polymarket' | 'kalshi', addedAt: number): WatchlistEntry {
  return { contractId, platform, question: `Q ${contractId}`, addedAt, version: 1 };
}

function market(id: string, platform: 'polymarket' | 'kalshi', volume24h: number) {
  return { ...mockContract, id, platform, volume24h };
}

function correlationResult(overrides: Partial<CorrelationResult> = {}): CorrelationResult {
  return {
    matches: [],
    newsMatches: [],
    newsSocialMatches: [],
    ...overrides,
  };
}

describe('sortWatchlist (D-04)', () => {
  it('sorts by addedAt newest-first by default', () => {
    const entries = [
      entry('a', 'polymarket', 100),
      entry('b', 'polymarket', 300),
      entry('c', 'polymarket', 200),
    ];
    const out = sortWatchlist(entries, 'addedAt', []);
    expect(out.map((e) => e.contractId)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by volume24h descending using live markets', () => {
    const entries = [
      entry('a', 'polymarket', 100),
      entry('b', 'polymarket', 300),
      entry('c', 'polymarket', 200),
    ];
    const markets = [
      market('a', 'polymarket', 5000),
      market('b', 'polymarket', 9000),
      market('c', 'polymarket', 1000),
    ];
    const out = sortWatchlist(entries, 'volume24h', markets);
    expect(out.map((e) => e.contractId)).toEqual(['b', 'a', 'c']);
  });

  it('places entries with no live market / no volume last', () => {
    const entries = [
      entry('a', 'polymarket', 100),
      entry('b', 'polymarket', 300),
      entry('c', 'polymarket', 200),
    ];
    const markets = [market('b', 'polymarket', 9000)];
    const out = sortWatchlist(entries, 'volume24h', markets);
    // b has volume; a and c have no live market → sort last (stable).
    expect(out[0].contractId).toBe('b');
    expect(out.slice(1).map((e) => e.contractId).sort()).toEqual(['a', 'c']);
  });
});

describe('filterWatchlist (D-05)', () => {
  it("returns all entries for 'all'", () => {
    const entries = [entry('a', 'polymarket', 1), entry('b', 'kalshi', 2)];
    expect(filterWatchlist(entries, 'all')).toEqual(entries);
  });

  it('filters by platform', () => {
    const entries = [entry('a', 'polymarket', 1), entry('b', 'kalshi', 2)];
    const out = filterWatchlist(entries, 'polymarket');
    expect(out.map((e) => e.contractId)).toEqual(['a']);
  });
});

describe('correlationStatusFor (D-07)', () => {
  it("returns 'none' for a null result (no run yet)", () => {
    expect(correlationStatusFor('a', 'polymarket', null)).toBe('none');
  });

  it("returns 'none' when the contract appears in neither matches nor newsMatches", () => {
    const result = correlationResult();
    expect(correlationStatusFor('a', 'polymarket', result)).toBe('none');
  });

  it("returns 'has-correlation' when the contract appears in matches", () => {
    const result = correlationResult({
      matches: [{ contract: mockContract, signal: mockSignal, confidence: 0.8, matchedKeywords: ['btc'], correlatedAt: 1 }],
    });
    expect(correlationStatusFor('btc-100k', 'polymarket', result)).toBe('has-correlation');
  });

  it("returns 'has-correlation' when the contract appears in newsMatches", () => {
    const result = correlationResult({
      newsMatches: [{ contract: mockContract, news: newsItem('cnn', 'Bitcoin rally'), confidence: 0.8, matchedKeywords: ['btc'], correlatedAt: 1 }],
    });
    expect(correlationStatusFor('btc-100k', 'polymarket', result)).toBe('has-correlation');
  });
});

describe('correlationDirectionFor (D-07)', () => {
  it("returns 'neutral' for a null result", () => {
    expect(correlationDirectionFor('a', 'polymarket', null)).toBe('neutral');
  });

  it("returns 'neutral' when the contract has no correlation", () => {
    expect(correlationDirectionFor('a', 'polymarket', correlationResult())).toBe('neutral');
  });

  it("returns 'bull' for positive sentiment + Yes >= 0.5", () => {
    const result = correlationResult({
      matches: [{ contract: mockContract, signal: { ...mockSignal, sentiment: 0.8 }, confidence: 0.8, matchedKeywords: ['btc'], correlatedAt: 1 }],
    });
    expect(correlationDirectionFor('btc-100k', 'polymarket', result)).toBe('bull');
  });

  it("returns 'bear' for negative sentiment + Yes < 0.5", () => {
    const bearContract = { ...mockContract, outcomes: [{ label: 'Yes', price: 0.3 }, { label: 'No', price: 0.7 }] };
    const result = correlationResult({
      matches: [{ contract: bearContract, signal: { ...mockSignal, sentiment: -0.8 }, confidence: 0.8, matchedKeywords: ['btc'], correlatedAt: 1 }],
    });
    expect(correlationDirectionFor('btc-100k', 'polymarket', result)).toBe('bear');
  });
});
