/**
 * Unit tests for the source-health projection helpers (REL-02).
 *
 * Verifies `computeHealth` derives the correct semantic state from a
 * persisted entry, and `computeCorrelatedCounts` groups news matches by
 * their typed source.
 */

import { describe, it, expect } from 'vitest';
import {
  computeHealth,
  computeCorrelatedCounts,
  computeFetchedCounts,
  computeBridgingCoverage,
} from '@/utils/source-health';
import type { NewsCorrelationMatch, NewsItem, NewsSource, SourceHealthEntry } from '@/types';

const STALE_MS = 2 * 60 * 60 * 1000; // 2h
const NOW = 1_000_000_000_000;

function entry(partial: Partial<SourceHealthEntry>): SourceHealthEntry {
  return {
    lastFetchedAt: NOW,
    itemCount: 5,
    consecutiveFailures: 0,
    ...partial,
  };
}

describe('computeHealth', () => {
  it('returns no-data for an undefined entry', () => {
    expect(computeHealth(undefined, STALE_MS, NOW)).toBe('no-data');
  });

  it('returns healthy for a fresh, populated entry', () => {
    expect(computeHealth(entry({}), STALE_MS, NOW)).toBe('healthy');
  });

  it('returns degraded when consecutiveFailures > 0', () => {
    expect(
      computeHealth(entry({ consecutiveFailures: 1, itemCount: 5 }), STALE_MS, NOW),
    ).toBe('degraded');
  });

  it('returns healthy when the source has fetched data despite a stale failure counter', () => {
    // A recovered source with accumulated news must not stay red "Degraded"
    // just because a prior cycle left consecutiveFailures > 0.
    expect(
      computeHealth(
        entry({ consecutiveFailures: 3, itemCount: 0 }),
        STALE_MS,
        NOW,
        8, // fetchedCount from the accumulated feed
      ),
    ).toBe('healthy');
  });

  it('returns stale when a source with fetched data exceeds the threshold', () => {
    expect(
      computeHealth(
        entry({ consecutiveFailures: 3, lastFetchedAt: NOW - STALE_MS - 1 }),
        STALE_MS,
        NOW,
        8,
      ),
    ).toBe('stale');
  });

  it('returns degraded when itemCount is 0', () => {
    expect(computeHealth(entry({ itemCount: 0 }), STALE_MS, NOW)).toBe('degraded');
  });

  it('returns healthy when itemCount is 0 but lastUnchanged is true', () => {
    expect(
      computeHealth(entry({ itemCount: 0, lastUnchanged: true }), STALE_MS, NOW),
    ).toBe('healthy');
  });

  it('returns degraded when lastUnchanged is true but consecutiveFailures > 0', () => {
    expect(
      computeHealth(
        entry({ itemCount: 0, lastUnchanged: true, consecutiveFailures: 1 }),
        STALE_MS,
        NOW,
      ),
    ).toBe('degraded');
  });

  it('returns stale when an unchanged source exceeds the threshold', () => {
    expect(
      computeHealth(
        entry({ itemCount: 0, lastUnchanged: true, lastFetchedAt: NOW - STALE_MS - 1 }),
        STALE_MS,
        NOW,
      ),
    ).toBe('stale');
  });

  it('returns stale when lastFetchedAt exceeds the threshold', () => {
    const staleEntry = entry({ lastFetchedAt: NOW - STALE_MS - 1 });
    expect(computeHealth(staleEntry, STALE_MS, NOW)).toBe('stale');
  });

  it('returns healthy exactly at the threshold boundary', () => {
    const boundary = entry({ lastFetchedAt: NOW - STALE_MS });
    expect(computeHealth(boundary, STALE_MS, NOW)).toBe('healthy');
  });
});

describe('computeCorrelatedCounts', () => {
  function match(source: NewsSource): NewsCorrelationMatch {
    return {
      contract: {
        id: 'c',
        platform: 'polymarket',
        question: 'q',
        outcomes: [],
        endDate: new Date(NOW + 86_400_000).toISOString(),
        keywords: ['btc'],
        lastUpdated: NOW,
      },
      news: {
        id: `${source}:1`,
        source,
        headline: 'h',
        url: `https://example.com/${source}/1`,
        publishedAt: new Date(NOW).toISOString(),
        keywords: [],
      },
      confidence: 0.8,
      matchedKeywords: ['btc'],
      correlatedAt: NOW,
    };
  }

  it('returns an empty map for no matches', () => {
    expect(computeCorrelatedCounts([])).toEqual({});
  });

  it('groups matches by source', () => {
    const counts = computeCorrelatedCounts([
      match('bbc'),
      match('bbc'),
      match('seekingalpha'),
    ]);
    expect(counts.bbc).toBe(2);
    expect(counts.seekingalpha).toBe(1);
    expect(counts.cnn).toBeUndefined();
  });
});

describe('computeFetchedCounts', () => {
  function item(source: NewsSource, id: string): NewsItem {
    return {
      id,
      source,
      headline: 'h',
      url: `https://example.com/${source}/${id}`,
      publishedAt: new Date(NOW).toISOString(),
      keywords: [],
    };
  }

  it('returns an empty map for no news', () => {
    expect(computeFetchedCounts([])).toEqual({});
  });

  it('counts accumulated news per source', () => {
    const counts = computeFetchedCounts([
      item('bbc', '1'),
      item('bbc', '2'),
      item('seekingalpha', '3'),
    ]);
    expect(counts.bbc).toBe(2);
    expect(counts.seekingalpha).toBe(1);
    expect(counts.cnn).toBeUndefined();
  });
});

describe('computeBridgingCoverage', () => {
  function item(source: NewsSource, id: string): NewsItem {
    return {
      id,
      source,
      headline: 'h',
      url: `https://example.com/${source}/${id}`,
      publishedAt: new Date(NOW).toISOString(),
      keywords: [],
    };
  }

  function match(source: NewsSource, newsId: string): NewsCorrelationMatch {
    return {
      contract: {
        id: 'c',
        platform: 'polymarket',
        question: 'q',
        outcomes: [],
        endDate: new Date(NOW + 86_400_000).toISOString(),
        keywords: ['btc'],
        lastUpdated: NOW,
      },
      news: {
        id: newsId,
        source,
        headline: 'h',
        url: `https://example.com/${source}/${newsId}`,
        publishedAt: new Date(NOW).toISOString(),
        keywords: [],
      },
      confidence: 0.8,
      matchedKeywords: ['btc'],
      correlatedAt: NOW,
    };
  }

  it('returns an empty object for empty news and empty matches', () => {
    expect(computeBridgingCoverage([], [])).toEqual({});
  });

  it('yields { total: N, bridged: 0 } per source when nothing matched', () => {
    const coverage = computeBridgingCoverage(
      [item('bbc', 'bbc:1'), item('bbc', 'bbc:2'), item('cnn', 'cnn:1')],
      [],
    );
    expect(coverage.bbc).toEqual({ total: 2, bridged: 0 });
    expect(coverage.cnn).toEqual({ total: 1, bridged: 0 });
  });

  it('counts bridged and unbridged items per source correctly', () => {
    const coverage = computeBridgingCoverage(
      [item('bbc', 'bbc:1'), item('bbc', 'bbc:2'), item('cnn', 'cnn:1')],
      [match('bbc', 'bbc:1')],
    );
    expect(coverage.bbc).toEqual({ total: 2, bridged: 1 });
    expect(coverage.cnn).toEqual({ total: 1, bridged: 0 });
  });

  it('ignores matches whose news id is not in the news array (no phantom entries)', () => {
    const coverage = computeBridgingCoverage(
      [item('bbc', 'bbc:1')],
      [match('cnn', 'cnn:phantom')],
    );
    expect(coverage.bbc).toEqual({ total: 1, bridged: 0 });
    expect(coverage.cnn).toBeUndefined();
  });

  it('counts duplicate matches for one item once (Set semantics)', () => {
    const coverage = computeBridgingCoverage(
      [item('bbc', 'bbc:1')],
      [match('bbc', 'bbc:1'), match('bbc', 'bbc:1'), match('bbc', 'bbc:1')],
    );
    expect(coverage.bbc).toEqual({ total: 1, bridged: 1 });
  });

  it('handles the single-element boundary: one item bridged', () => {
    const coverage = computeBridgingCoverage(
      [item('seekingalpha', 'sa:1')],
      [match('seekingalpha', 'sa:1')],
    );
    expect(coverage.seekingalpha).toEqual({ total: 1, bridged: 1 });
  });
});
