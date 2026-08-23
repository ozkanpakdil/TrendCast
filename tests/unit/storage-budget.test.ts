/**
 * Storage budget tests (Phase 8, PERF-03).
 *
 * Verifies:
 *   - Per-key caps are enforced at write time in the merge helpers
 *     (maxSignals/maxNews/maxMarkets), evicting oldest-first (D-01).
 *   - Under-cap input is unchanged.
 *   - `capByOldest` handles missing/parseable dates gracefully.
 */

import { describe, it, expect } from 'vitest';
import { CONFIG } from '@/config';
import { capByOldest, mergeMarkets, mergeSignals, mergeNews } from '@/background/merge';
import type { MarketContract, NewsItem, SocialSignal } from '@/types';

// ── Fixture builders ──────────────────────────────────────────────

function makeSignal(id: string, timestamp: string): SocialSignal {
  return {
    id,
    platform: 'reddit',
    text: `signal ${id}`,
    author: 'author',
    metrics: { likes: 1, shares: 0, comments: 0 },
    timestamp,
    keywords: ['bitcoin'],
    sentiment: 0.5,
    virality: 50,
  };
}

function makeNews(id: string, publishedAt: string): NewsItem {
  return {
    id,
    source: 'bbc',
    headline: `headline ${id}`,
    url: `https://example.com/${id}`,
    publishedAt,
    keywords: ['bitcoin'],
  };
}

function makeMarket(id: string, lastUpdated: number): MarketContract {
  return {
    id,
    platform: 'polymarket',
    question: `Will ${id} happen?`,
    outcomes: [
      { label: 'Yes', price: 0.6 },
      { label: 'No', price: 0.4 },
    ],
    endDate: '2025-12-31T23:59:59Z',
    keywords: ['bitcoin'],
    lastUpdated,
  };
}

// ── capByOldest ───────────────────────────────────────────────────

describe('capByOldest', () => {
  it('returns the array unchanged when at or under the cap', () => {
    const items = [makeSignal('a', '2025-01-01T00:00:00Z'), makeSignal('b', '2025-01-02T00:00:00Z')];
    expect(capByOldest(items, 5, 'timestamp')).toHaveLength(2);
  });

  it('evicts oldest-first when over the cap', () => {
    const items = [
      makeSignal('old', '2025-01-01T00:00:00Z'),
      makeSignal('mid', '2025-01-02T00:00:00Z'),
      makeSignal('new', '2025-01-03T00:00:00Z'),
    ];
    const capped = capByOldest(items, 2, 'timestamp');
    expect(capped).toHaveLength(2);
    expect(capped.map((s) => s.id).sort()).toEqual(['mid', 'new']);
  });

  it('treats items without a parseable date as oldest (evicted first)', () => {
    const items = [
      makeSignal('nodate', 'not-a-date'),
      makeSignal('dated', '2025-01-03T00:00:00Z'),
    ];
    const capped = capByOldest(items, 1, 'timestamp');
    expect(capped).toHaveLength(1);
    expect(capped[0].id).toBe('dated');
  });

  it('does not mutate the input array', () => {
    const items = [
      makeSignal('a', '2025-01-01T00:00:00Z'),
      makeSignal('b', '2025-01-02T00:00:00Z'),
      makeSignal('c', '2025-01-03T00:00:00Z'),
    ];
    capByOldest(items, 2, 'timestamp');
    expect(items).toHaveLength(3);
  });
});

// ── mergeSignals cap ──────────────────────────────────────────────

describe('mergeSignals cap (PERF-03, D-01)', () => {
  it('caps merged signals to maxSignals, evicting oldest', () => {
    const cap = CONFIG.storageBudget.maxSignals;
    const existing = Array.from({ length: cap }, (_, i) =>
      makeSignal(`existing-${i}`, `2025-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`),
    );
    const incoming = [makeSignal('new-signal', '2025-02-01T00:00:00Z')];
    const merged = mergeSignals(existing, incoming);
    expect(merged).toHaveLength(cap);
    // The newest incoming signal survives.
    expect(merged.some((s) => s.id === 'new-signal')).toBe(true);
    // The oldest existing signal was evicted.
    expect(merged.some((s) => s.id === 'existing-0')).toBe(false);
  });

  it('keeps under-cap input unchanged', () => {
    const existing = [makeSignal('a', '2025-01-01T00:00:00Z')];
    const incoming = [makeSignal('b', '2025-01-02T00:00:00Z')];
    const merged = mergeSignals(existing, incoming);
    expect(merged).toHaveLength(2);
  });
});

// ── mergeNews cap ─────────────────────────────────────────────────

describe('mergeNews cap (PERF-03, D-01)', () => {
  it('caps merged news to maxNews, evicting oldest', () => {
    const cap = CONFIG.storageBudget.maxNews;
    const existing = Array.from({ length: cap }, (_, i) =>
      makeNews(`existing-${i}`, `2025-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`),
    );
    const incoming = [makeNews('new-news', '2025-02-01T00:00:00Z')];
    const merged = mergeNews(existing, incoming);
    expect(merged).toHaveLength(cap);
    expect(merged.some((n) => n.id === 'new-news')).toBe(true);
    expect(merged.some((n) => n.id === 'existing-0')).toBe(false);
  });

  it('keeps under-cap input unchanged', () => {
    const existing = [makeNews('a', '2025-01-01T00:00:00Z')];
    const incoming = [makeNews('b', '2025-01-02T00:00:00Z')];
    const merged = mergeNews(existing, incoming);
    expect(merged).toHaveLength(2);
  });
});

// ── mergeMarkets cap ──────────────────────────────────────────────

describe('mergeMarkets cap (PERF-03, D-01)', () => {
  it('caps merged markets to maxMarkets, evicting oldest', () => {
    const cap = CONFIG.storageBudget.maxMarkets;
    const existing = Array.from({ length: cap }, (_, i) => makeMarket(`existing-${i}`, i));
    const incoming = [makeMarket('new-market', cap + 1)];
    const merged = mergeMarkets(existing, incoming);
    expect(merged).toHaveLength(cap);
    expect(merged.some((m) => m.id === 'new-market')).toBe(true);
    expect(merged.some((m) => m.id === 'existing-0')).toBe(false);
  });

  it('keeps the newest version of a duplicate market', () => {
    const existing = [makeMarket('dup', 100)];
    const incoming = [makeMarket('dup', 200)];
    const merged = mergeMarkets(existing, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0].lastUpdated).toBe(200);
  });
});
