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
