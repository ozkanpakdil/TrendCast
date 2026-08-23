/**
 * Unit tests for the background-fetch TikTok trends collector (Phase 7).
 *
 * Verifies `collectTikTokTrends` fetches the discover page via a pure
 * background `fetch()` (no tab), parses trending titles from the embedded
 * SSR JSON, handles 304 Not Modified, and degrades gracefully to [] when
 * the page shape changes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the browser polyfill before importing the module under test.
const fetchCache: Record<string, { etag?: string; lastModified?: string }> = {};
vi.mock('@/messaging/browser', () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
      },
    },
  },
}));

import { collectTikTokTrends, parseTrendTitles } from '@/services/collectors/tiktok';
import { CONFIG } from '@/config';

/** Build a minimal discover-page HTML with an SSR rehydration blob. */
function buildHtml(challenges: Array<{ title: string; id: string }>): string {
  const ssr = {
    __DEFAULT_SCOPE__: {
      'webapp.discover': {
        challengeList: challenges.map((c) => ({
          challengeId: c.id,
          title: c.title,
        })),
      },
    },
  };
  return `<!doctype html><html><head><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify(
    ssr,
  )}</script></head><body></body></html>`;
}

describe('parseTrendTitles', () => {
  it('extracts challenge titles from the SSR JSON blob', () => {
    const html = buildHtml([
      { title: 'finance', id: '1' },
      { title: 'stocks', id: '2' },
    ]);
    expect(parseTrendTitles(html)).toEqual(['finance', 'stocks']);
  });

  it('dedups repeated titles', () => {
    const html = buildHtml([
      { title: 'finance', id: '1' },
      { title: 'finance', id: '2' },
    ]);
    expect(parseTrendTitles(html)).toEqual(['finance']);
  });

  it('falls back to #hashtag scanning when SSR JSON is absent', () => {
    const html = '<html><body>#finance #stocks #crypto</body></html>';
    expect(parseTrendTitles(html)).toEqual(['finance', 'stocks', 'crypto']);
  });

  it('returns [] when nothing parseable', () => {
    expect(parseTrendTitles('<html><body>no trends here</body></html>')).toEqual([]);
  });

  it('caps at MAX_TRENDS', () => {
    const challenges = Array.from({ length: 100 }, (_, i) => ({
      title: `trend${i}`,
      id: String(i),
    }));
    const titles = parseTrendTitles(buildHtml(challenges));
    expect(titles.length).toBeLessThanOrEqual(30);
  });
});

describe('collectTikTokTrends', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset the in-memory fetch cache between tests.
    for (const key of Object.keys(fetchCache)) delete fetchCache[key];
  });

  it('fetches the discover page and returns normalised signals', async () => {
    const html = buildHtml([
      { title: 'finance', id: '1' },
      { title: 'stocks', id: '2' },
    ]);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(html, { status: 200 }));

    const signals = await collectTikTokTrends();

    expect(fetchMock).toHaveBeenCalledWith(
      CONFIG.scrape.tiktok.url,
      expect.objectContaining({ headers: expect.anything() }),
    );
    expect(signals.length).toBe(2);
    expect(signals[0].platform).toBe('tiktok');
    expect(signals[0].text).toBe('finance');
    expect(signals[0].url).toContain('finance');
  });

  it('returns [] on 304 Not Modified', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 304 }));
    const signals = await collectTikTokTrends();
    expect(signals).toEqual([]);
  });

  it('throws on non-ok, non-304 responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('blocked', { status: 403 }));
    await expect(collectTikTokTrends()).rejects.toThrow(/403/);
  });

  it('returns [] gracefully when the page has no parseable trends', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><body>no trends</body></html>', { status: 200 }),
    );
    const signals = await collectTikTokTrends();
    expect(signals).toEqual([]);
  });
});
