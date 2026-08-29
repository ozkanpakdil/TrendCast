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
import { extractKeywords } from '@/utils/keywords';
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

  it('does NOT count a 304 (unchanged) fetch as a failure', async () => {
    mockedFetch.mockResolvedValue(null); // 304 Not Modified

    const previousHealth: SourceHealth = {
      yahoo: { lastFetchedAt: Date.now(), itemCount: 3, consecutiveFailures: 0 },
    };

    const { news, health } = await collectNews(['yahoo'], previousHealth);

    expect(news).toHaveLength(0);
    expect(health.yahoo?.itemCount).toBe(0);
    // A healthy-but-unchanged source must NOT drift toward Degraded.
    expect(health.yahoo?.consecutiveFailures).toBe(0);
    expect(health.yahoo?.lastError).toBeUndefined();
  });

  it('resets prior consecutiveFailures across a 304 (unchanged) cycle', async () => {
    mockedFetch.mockResolvedValue(null); // 304 Not Modified

    const previousHealth: SourceHealth = {
      yahoo: { lastFetchedAt: Date.now(), itemCount: 0, consecutiveFailures: 2 },
    };

    const { health } = await collectNews(['yahoo'], previousHealth);

    // A 304 means the server responded successfully (just no new content),
    // so the source is healthy again — prior failures must be cleared.
    expect(health.yahoo?.consecutiveFailures).toBe(0);
  });

  it('records lastFetchedAt for every source', async () => {
    mockedFetch.mockResolvedValue({ status: 'ok', items: okItems('investing', 1) });

    const before = Date.now();
    const { health } = await collectNews(['investing']);
    const after = Date.now();

    expect(health.investing?.lastFetchedAt).toBeGreaterThanOrEqual(before);
    expect(health.investing?.lastFetchedAt).toBeLessThanOrEqual(after);
  });

  it('retries a rate-limited (429) fetch and recovers on the retry', async () => {
    // First call throws a 429 rate-limit error; the retry succeeds.
    mockedFetch
      .mockRejectedValueOnce(new Error('Fetch error: 429 Too Many Requests for https://api.rss2json.com/...'))
      .mockResolvedValueOnce({ status: 'ok', items: okItems('bbc', 2) });

    const { news, health } = await collectNews(['bbc']);

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(news).toHaveLength(2);
    // A recovered source must NOT be recorded as a failure.
    expect(health.bbc?.consecutiveFailures).toBe(0);
    expect(health.bbc?.itemCount).toBe(2);
    expect(health.bbc?.lastError).toBeUndefined();
  });

  it('records a failure when a source stays rate-limited past the retry budget', async () => {
    // Every attempt returns 429 — the source should end up degraded.
    mockedFetch.mockRejectedValue(new Error('Fetch error: 429 Too Many Requests for https://api.rss2json.com/...'));

    const { news, health } = await collectNews(['cnn']);

    expect(news).toHaveLength(0);
    expect(health.cnn?.itemCount).toBe(0);
    expect(health.cnn?.consecutiveFailures).toBe(1);
    expect(health.cnn?.lastError).toContain('429');
  });
});

describe('collectNews stock-indicator sources', () => {
  it('collects usaStocksIndicator items with the correct source and headline', async () => {
    mockedFetch.mockResolvedValue({
      status: 'ok',
      items: [
        {
          title: 'Recent Tech Layoffs Stock Report - 2026-08-23',
          link: 'https://ozkanpakdil.github.io/usa-stocks-indicator/posts/layoffs-2026-08-23/',
          pubDate: new Date().toISOString(),
        },
      ],
    });

    const { news, health } = await collectNews(['usaStocksIndicator']);

    expect(news).toHaveLength(1);
    expect(news[0].source).toBe('usaStocksIndicator');
    expect(news[0].headline).toBe('Recent Tech Layoffs Stock Report - 2026-08-23');
    expect(health.usaStocksIndicator?.itemCount).toBe(1);
    expect(health.usaStocksIndicator?.consecutiveFailures).toBe(0);
  });

  it('yields multiple distinct guid-derived ids for a shared-link screener feed', async () => {
    // Every item shares the same `link`; only `guid` differs.
    const sharedLink = 'https://example.com/screener';
    mockedFetch.mockResolvedValue({
      status: 'ok',
      items: [
        { title: 'US Stock Breakout Screener — 2026-08-25 — 22 hits — top: XPON (155.25)', link: sharedLink, guid: 'screener-2026-08-25-1', pubDate: new Date().toISOString() },
        { title: 'US Stock Breakout Screener — 2026-08-25 — 22 hits — top: XPON (155.25)', link: sharedLink, guid: 'screener-2026-08-25-2', pubDate: new Date().toISOString() },
        { title: 'US Stock Breakout Screener — 2026-08-25 — 22 hits — top: XPON (155.25)', link: sharedLink, guid: 'screener-2026-08-25-3', pubDate: new Date().toISOString() },
      ],
    });

    const { news } = await collectNews(['stockScreener']);

    expect(news).toHaveLength(3);
    const ids = news.map((n) => n.id);
    expect(new Set(ids).size).toBe(3);
    // Ids are derived from the guid, not the shared link.
    expect(ids).toContain('stockScreener:screener-2026-08-25-1');
    expect(ids).toContain('stockScreener:screener-2026-08-25-2');
    expect(ids).toContain('stockScreener:screener-2026-08-25-3');
  });

  it('falls back to link when a screener item has no guid', async () => {
    mockedFetch.mockResolvedValue({
      status: 'ok',
      items: [
        { title: 'VCP Screener-2 — 2026-08-25 — 1478 hits — 4 VCP', link: 'https://example.com/screener2', pubDate: new Date().toISOString() },
      ],
    });

    const { news } = await collectNews(['stockScreener2']);

    expect(news).toHaveLength(1);
    expect(news[0].id).toBe('stockScreener2:https://example.com/screener2');
  });

  it('preserves titles verbatim (not Google-News-stripped) for the new sources', async () => {
    // A title with a " - " date suffix must NOT be stripped for the new sources.
    mockedFetch.mockResolvedValue({
      status: 'ok',
      items: [
        {
          title: 'USA Government Awards Stock Report - 2026-08-23',
          link: 'https://example.com/usa-stocks-indicator/awards-2026-08-23/',
          pubDate: new Date().toISOString(),
        },
      ],
    });

    const { news } = await collectNews(['usaStocksIndicator']);

    expect(news[0].headline).toBe('USA Government Awards Stock Report - 2026-08-23');
  });

  it('omits summary for the screener sources but keeps it for existing sources', async () => {
    mockedFetch
      .mockResolvedValueOnce({
        status: 'ok',
        items: [
          {
            title: 'US Stock Breakout Screener — 2026-08-25 — 22 hits',
            link: 'https://example.com/screener',
            guid: 'screener-1',
            description: '<table><tr><td>XPON</td></tr></table>',
            pubDate: new Date().toISOString(),
          },
        ],
      })
      .mockResolvedValueOnce({
        status: 'ok',
        items: [
          {
            title: 'BBC headline',
            link: 'https://example.com/bbc/1',
            description: '<p>Some BBC summary</p>',
            pubDate: new Date().toISOString(),
          },
        ],
      });

    const { news } = await collectNews(['stockScreener', 'bbc']);

    const screener = news.find((n) => n.source === 'stockScreener');
    const bbc = news.find((n) => n.source === 'bbc');
    expect(screener?.summary).toBeUndefined();
    expect(bbc?.summary).toBe('Some BBC summary');
    // CORR-03 scoping: curation applies ONLY to stock-indicator sources —
    // the BBC item still carries raw extractKeywords output.
    expect(bbc?.keywords).toEqual(extractKeywords('BBC headline Some BBC summary'));
  });

  it('records health for a new source with itemCount and consecutiveFailures', async () => {
    mockedFetch.mockResolvedValue({
      status: 'ok',
      items: [
        { title: 'VCP Screener-2 — 2026-08-25 — 1478 hits — 4 VCP', link: 'https://example.com/screener2', guid: 'vcp-1', pubDate: new Date().toISOString() },
      ],
    });

    const { health } = await collectNews(['stockScreener2']);

    expect(health.stockScreener2?.itemCount).toBe(1);
    expect(health.stockScreener2?.consecutiveFailures).toBe(0);
    expect(health.stockScreener2?.lastError).toBeUndefined();
  });

  it('expands a screener table into one NewsItem per stock with the ticker in headline and keywords', async () => {
    mockedFetch.mockResolvedValue({
      status: 'ok',
      items: [
        {
          title: 'US Stock Breakout Screener — 2026-08-25 — 22 hits — top: XPON (155.25)',
          link: 'https://example.com/screener',
          guid: 'screener-2026-08-25',
          description:
            '<table><tbody>' +
            '<tr><td><b>XPON</b></td><td><b>155.25</b></td></tr>' +
            '<tr><td><b>GENB</b></td><td><b>12.00</b></td></tr>' +
            '<tr><td><b>OABI</b></td><td><b>11.98</b></td></tr>' +
            '</tbody></table>',
          pubDate: new Date().toISOString(),
        },
      ],
    });

    const { news } = await collectNews(['stockScreener']);

    expect(news).toHaveLength(3);
    const symbols = news.map((n) => n.headline);
    expect(symbols).toContain('XPON — Breakout 2026-08-25');
    expect(symbols).toContain('GENB — Breakout 2026-08-25');
    expect(symbols).toContain('OABI — Breakout 2026-08-25');
    // CORR-03: screener items are also curated to the bare ticker.
    const xpon = news.find((n) => n.headline.startsWith('XPON'));
    expect(xpon?.keywords).toEqual(['xpon']);
    // Score cells (e.g. <b>155.25</b>) must NOT be treated as symbols.
    expect(news.some((n) => n.headline.startsWith('155'))).toBe(false);
    // Ids are unique per stock.
    expect(new Set(news.map((n) => n.id)).size).toBe(3);
  });

  it('expands a Stock Indicator report into one NewsItem per Seeking Alpha symbol', async () => {
    mockedFetch.mockResolvedValue({
      status: 'ok',
      items: [
        {
          title: 'Recent Tech Layoffs Stock Report - 2026-08-23',
          link: 'https://ozkanpakdil.github.io/usa-stocks-indicator/posts/layoffs-2026-08-23/',
          description:
            '<table><tbody>' +
            '<tr><td>Amazon</td><td><a href="https://seekingalpha.com/symbol/AMZN">AMZN (NMS)</a></td></tr>' +
            '<tr><td>eBay</td><td><a href="https://seekingalpha.com/symbol/EBAY">EBAY (NMS)</a></td></tr>' +
            '<tr><td>ASML</td><td><a href="https://seekingalpha.com/symbol/ASML">ASML (NMS)</a></td></tr>' +
            '</tbody></table>',
          pubDate: new Date().toISOString(),
        },
      ],
    });

    const { news } = await collectNews(['usaStocksIndicator']);

    expect(news).toHaveLength(3);
    const symbols = news.map((n) => n.headline);
    expect(symbols).toContain('AMZN — Stock Indicator 2026-08-23');
    expect(symbols).toContain('EBAY — Stock Indicator 2026-08-23');
    expect(symbols).toContain('ASML — Stock Indicator 2026-08-23');
    // CORR-03: keywords are curated to the bare lowercase ticker — label
    // tokens (stock/indicator) and the date must not dilute the set.
    const amzn = news.find((n) => n.headline.startsWith('AMZN'));
    expect(amzn?.keywords).toEqual(['amzn']);
    const ebay = news.find((n) => n.headline.startsWith('EBAY'));
    expect(ebay?.keywords).toEqual(['ebay']);
    const asml = news.find((n) => n.headline.startsWith('ASML'));
    expect(asml?.keywords).toEqual(['asml']);
    // No label or date tokens in any stock-indicator item's keywords.
    for (const n of news) {
      expect(n.keywords).not.toContain('stock');
      expect(n.keywords).not.toContain('indicator');
      expect(n.keywords).not.toContain('breakout');
      expect(n.keywords).not.toContain('vcp');
      expect(n.keywords).not.toContain('2026');
    }
    expect(new Set(news.map((n) => n.id)).size).toBe(3);
  });

  it('adds Seeking Alpha URL symbols to keywords at collection time (CORR-06)', async () => {
    mockedFetch.mockResolvedValue({
      status: 'ok',
      items: [
        {
          // Generic headline — the ticker only appears in the symbol-page URL.
          title: 'More On Earnings Revisions »',
          link: 'https://seekingalpha.com/symbol/PEN/earnings-revisions',
          description: 'Earnings estimates revised higher.',
          pubDate: new Date().toISOString(),
        },
      ],
    });

    const { news } = await collectNews(['seekingalpha']);

    expect(news).toHaveLength(1);
    // The URL-derived ticker joins the headline/description keywords so the
    // item can bridge to a VCP screener item about the same stock.
    expect(news[0].keywords).toContain('pen');
    expect(news[0].keywords).toContain('earnings');
    expect(news[0].keywords).toContain('revisions');
  });

  it('extracts title-embedded tickers when the SA link is a Google News redirect (CORR-06)', async () => {
    // The configured SA feed is proxied through Google News RSS, which rewrites
    // every link to a news.google.com/rss/articles/... redirect — so the URL
    // carries no ticker. The ticker instead appears in the title as a
    // parenthetical marker: `(NASDAQ:PEN)`.
    mockedFetch.mockResolvedValue({
      status: 'ok',
      items: [
        {
          title: 'PennyMac Financial: A Deep Dive (NASDAQ:PEN) - Seeking Alpha',
          link: 'https://news.google.com/rss/articles/CBMi...?oc=5',
          description: 'Earnings estimates revised higher.',
          pubDate: new Date().toISOString(),
        },
      ],
    });

    const { news } = await collectNews(['seekingalpha']);

    expect(news).toHaveLength(1);
    // The title-embedded ticker joins the keyword set so the item can bridge
    // to a VCP screener item about the same stock.
    expect(news[0].keywords).toContain('pen');
    expect(news[0].keywords).toContain('earnings');
  });

  it('does not extract URL symbols for non-Seeking-Alpha sources', async () => {
    mockedFetch.mockResolvedValue({
      status: 'ok',
      items: [
        {
          title: 'Market wrap',
          link: 'https://seekingalpha.com/symbol/PEN/earnings-revisions',
          pubDate: new Date().toISOString(),
        },
      ],
    });

    const { news } = await collectNews(['bbc']);

    // URL symbol extraction is SA-source-only: a BBC item linking to an SA
    // symbol page must not gain the ticker keyword.
    expect(news[0].keywords).not.toContain('pen');
  });

  it('falls back to a single item when a stock-indicator feed has no parseable table', async () => {
    mockedFetch.mockResolvedValue({
      status: 'ok',
      items: [
        {
          title: 'US Stock Breakout Screener — 2026-08-25 — 22 hits',
          link: 'https://example.com/screener',
          guid: 'screener-1',
          description: '<p>No table here</p>',
          pubDate: new Date().toISOString(),
        },
      ],
    });

    const { news } = await collectNews(['stockScreener']);

    expect(news).toHaveLength(1);
    expect(news[0].headline).toBe('US Stock Breakout Screener — 2026-08-25 — 22 hits');
  });
});
