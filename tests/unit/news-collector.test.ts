/**
 * Unit tests for the news collector's source-health telemetry (REL-01).
 *
 * Verifies that `collectNews` returns a per-source health map recording
 * item counts, consecutive-failure accumulation, and last errors — so a
 * source that failed or returned zero items is distinguishable from one
 * that simply had no correlated items.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collectNews } from '@/services/collectors/news';
import type { NewsSource, SourceHealth } from '@/types';

// Mock the collector's only external dependency (rss2json fetch).
vi.mock('@/utils/conditional-fetch', () => ({
  conditionalFetchJson: vi.fn(),
}));

import { conditionalFetchJson } from '@/utils/conditional-fetch';

const mockedFetch = vi.mocked(conditionalFetchJson);

function okItems(source: NewsSource, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    title: `${source} headline ${i}`,
    link: `https://example.com/${source}/${i}`,
    pubDate: new Date().toISOString(),
  }));
}

beforeEach(() => {
  mockedFetch.mockReset();
});

describe('collectNews health map', () => {
  it('records itemCount and resets consecutiveFailures on success', async () => {
    mockedFetch.mockResolvedValue({ status: 'ok', items: okItems('bbc', 3) });

    const { news, health } = await collectNews(['bbc']);

    expect(news).toHaveLength(3);
    expect(health.bbc).toMatchObject({
      itemCount: 3,
      consecutiveFailures: 0,
    });
    expect(health.bbc?.lastError).toBeUndefined();
  });

  it('increments consecutiveFailures and sets lastError on a rejected source', async () => {
    mockedFetch.mockRejectedValue(new Error('network down'));

    const { news, health } = await collectNews(['cnn']);

    expect(news).toHaveLength(0);
    expect(health.cnn?.itemCount).toBe(0);
    expect(health.cnn?.consecutiveFailures).toBe(1);
    expect(health.cnn?.lastError).toContain('network down');
  });

  it('accumulates consecutiveFailures across cycles via previousHealth', async () => {
    mockedFetch.mockRejectedValue(new Error('still down'));

    const previousHealth: SourceHealth = {
      cnn: { lastFetchedAt: Date.now(), itemCount: 0, consecutiveFailures: 2 },
    };

    const { health } = await collectNews(['cnn'], previousHealth);

    expect(health.cnn?.consecutiveFailures).toBe(3);
  });

  it('treats an empty (304/empty) fetch as a failure increment', async () => {
    mockedFetch.mockResolvedValue(null); // 304 Not Modified

    const { news, health } = await collectNews(['yahoo']);

    expect(news).toHaveLength(0);
    expect(health.yahoo?.itemCount).toBe(0);
    expect(health.yahoo?.consecutiveFailures).toBe(1);
  });

  it('records lastFetchedAt for every source', async () => {
    mockedFetch.mockResolvedValue({ status: 'ok', items: okItems('investing', 1) });

    const before = Date.now();
    const { health } = await collectNews(['investing']);
    const after = Date.now();

    expect(health.investing?.lastFetchedAt).toBeGreaterThanOrEqual(before);
    expect(health.investing?.lastFetchedAt).toBeLessThanOrEqual(after);
  });
});
