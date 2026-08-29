/**
 * News data collector (BBC + CNN).
 *
 * Fetches news headlines via rss2json.com — a CORS-friendly JSON proxy
 * that converts RSS feeds into JSON. This is necessary because Firefox
 * MV3 background workers enforce CORS even with matching host_permissions,
 * and RSS feeds don't send CORS headers.
 *
 * If the user is browsing bbc.com or cnn.com, the content script can also
 * scrape headlines from the DOM and report via REPORT_NEWS_DATA.
 *
 * Feed URLs (configured in CONFIG):
 *   BBC: feeds.bbci.co.uk/news/rss.xml via rss2json
 *   CNN: Google News RSS filtered to CNN via rss2json
 */

import type { NewsItem, NewsSource, SourceHealth } from '@/types';
import { CONFIG } from '@/config';
import { classifyCategory } from '@/config/taxonomy';
import { extractKeywords } from '@/utils/keywords';
import { conditionalFetchJson } from '@/utils/conditional-fetch';

/** rss2json.com API response shape (subset). */
interface Rss2JsonResponse {
  status: string;
  items?: Array<{
    title: string;
    link: string;
    pubDate: string;
    description?: string;
    thumbnail?: string;
    enclosure?: {
      link?: string;
    };
    /** Feed item GUID. Used to derive dedup-safe ids for feeds whose items share a single `link`. */
    guid?: string;
  }>;
}

/**
 * Sources whose feed items all share a single `link` (e.g. a screener feed
 * where every hit points to the same page). For these, the item `id` must be
 * derived from the feed `guid` (falling back to `link`) so `mergeNews`'s
 * Map-dedup (keyed by `id`) does not collapse every item into one.
 */
const GUID_BASED_SOURCES: ReadonlySet<NewsSource> = new Set(['stockScreener', 'stockScreener2']);

/**
 * The three "stock indicator" sources. Unlike BBC/CNN-style news feeds, each
 * RSS `<item>` here is a daily screener/report whose `<description>` is an
 * HTML `<table>` listing many individual stocks. We surface each stock as its
 * own NewsItem (instead of one post per day) so the news tab lists the actual
 * tickers and the correlation engine can match them against social signals,
 * Seeking Alpha, Investing.com, and Yahoo Finance.
 */
const STOCK_INDICATOR_SOURCES: ReadonlySet<NewsSource> = new Set([
  'usaStocksIndicator',
  'stockScreener',
  'stockScreener2',
]);

/** Human-readable label used in per-stock headlines. */
const STOCK_SOURCE_LABELS: Record<NewsSource, string> = {
  bbc: 'BBC',
  cnn: 'CNN',
  yahoo: 'Yahoo',
  googleFinance: 'Google Finance',
  seekingalpha: 'Seeking Alpha',
  investing: 'Investing.com',
  usaStocksIndicator: 'Stock Indicator',
  stockScreener: 'Breakout',
  stockScreener2: 'VCP',
};

/**
 * Parse the HTML `<table>` in a stock-indicator feed item's description and
 * return the distinct stock symbols it lists.
 *
 *   - Screener feeds (stockScreener, stockScreener2): each data row's first
 *     cell is `<td ...><b>SYMBOL</b></td>` (the score cells are `<b>5.00</b>`
 *     and are excluded because they don't start with a letter).
 *   - Stock Indicator (usaStocksIndicator): each row links to a Seeking Alpha
 *     symbol page: `https://seekingalpha.com/symbol/SYMBOL`.
 */
function extractStockSymbols(source: NewsSource, description: string): string[] {
  const symbols = new Set<string>();
  if (source === 'usaStocksIndicator') {
    const re = /seekingalpha\.com\/symbol\/([A-Z][A-Z0-9.-]{0,9})/gi;
    for (const m of description.matchAll(re)) {
      const sym = m[1].toUpperCase();
      if (sym) symbols.add(sym);
    }
  } else {
    const re = /<td[^>]*>\s*<b>([A-Z][A-Z0-9]{0,9})<\/b>/g;
    for (const m of description.matchAll(re)) {
      const sym = m[1].toUpperCase();
      if (sym) symbols.add(sym);
    }
  }
  return Array.from(symbols);
}

/** Extract a `YYYY-MM-DD` date from a feed title, or '' if none. */
function dateFromTitle(title: string): string {
  return title.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '';
}

/**
 * Extract Seeking Alpha tickers from a headline/summary/link (CORR-06).
 *
 * SA feed items link to `seekingalpha.com/symbol/PEN/...` pages; their
 * headlines are often generic ("More On Earnings Revisions »"), so the ticker
 * must be pulled from the URL and added to the keyword set — otherwise the
 * item can never bridge to a VCP screener item about the same stock.
 *
 * However, the configured SA feed is proxied through Google News RSS, which
 * rewrites every link to a `news.google.com/rss/articles/...` redirect — so
 * the URL carries no ticker. Instead the ticker appears in the title as a
 * parenthetical marker: `(NASDAQ:IREN)`, `(NYSE:CRM)`, `(GLD:NYSEARCA)`,
 * `(TFC:NYSE)`, etc. The format is inconsistent (the exchange may come first
 * or second), so we extract BOTH tokens from the parenthetical; the exchange-
 * name token is harmless noise that never matches a real screener ticker.
 */
function extractSeekingAlphaSymbols(text: string): string[] {
  const symbols: string[] = [];
  const push = (sym: string) => {
    const s = sym.replace(/[.-]+$/, '').toLowerCase();
    if (s && !symbols.includes(s)) symbols.push(s);
  };

  // URL-derived tickers: `seekingalpha.com/symbol/PEN/...`.
  const urlRe = /seekingalpha\.com\/symbol\/([A-Z][A-Z0-9.-]{0,9})/gi;
  for (const m of text.matchAll(urlRe)) push(m[1]);

  // Title-embedded tickers: `(EXCHANGE:TICKER)` or `(TICKER:EXCHANGE)`.
  // Extract both sides so the real ticker is captured regardless of order.
  const parenRe = /\(([A-Z][A-Z0-9.-]{0,9}):([A-Z][A-Z0-9.-]{0,9})\)/g;
  for (const m of text.matchAll(parenRe)) {
    push(m[1]);
    push(m[2]);
  }

  return symbols;
}

/**
 * Collect news headlines from configured sources via rss2json.com.
 * Supports BBC, CNN, Yahoo Finance, and Google News finance/politics.
 * Returns the combined array of NewsItems plus a per-source health map
 * recording fetch outcomes (item count, failures, last error).
 */
export async function collectNews(
  sources: NewsSource[] = ['bbc', 'cnn'],
  previousHealth: SourceHealth = {},
): Promise<{ news: NewsItem[]; health: SourceHealth }> {
  // Fetch sources sequentially with a stagger delay instead of firing all in
  // parallel. rss2json.com's free tier rate-limits to ~1 req/sec, so a
  // parallel burst of 6 causes several to be rejected (429) and drift
  // healthy-but-quiet sources to Degraded. Sequential + stagger keeps each
  // request under the limit while still completing within the collection
  // window (6 sources × ~400ms ≈ 2.4s).
  const results: PromiseSettledResult<CollectResult>[] = [];
  for (const source of sources) {
    results.push(await settleCollect(source));
    if (sources.length > 1) {
      await delay(CONFIG.collection.newsStaggerMs);
    }
  }

  const items: NewsItem[] = [];
  const health: SourceHealth = {};

  results.forEach((result, i) => {
    const source = sources[i];
    const prev = previousHealth[source];

    if (result.status === 'fulfilled') {
      const { items: sourceItems, unchanged } = result.value;
      items.push(...sourceItems);
      // A 304 (unchanged) is a healthy no-op — it must NOT count as a
      // failure, otherwise a healthy-but-quiet source drifts to Degraded.
      // It also RESETS any prior failure counter: a 304 means the server
      // responded successfully (just no new content), so the source is
      // healthy again.
      const consecutiveFailures = unchanged ? 0 : sourceItems.length > 0 ? 0 : (prev?.consecutiveFailures ?? 0) + 1;
      health[source] = {
        lastFetchedAt: Date.now(),
        itemCount: sourceItems.length,
        consecutiveFailures,
        lastUnchanged: unchanged,
      };
    } else {
      // Record the failure into the health map instead of silently dropping it.
      health[source] = {
        lastFetchedAt: Date.now(),
        itemCount: 0,
        consecutiveFailures: (prev?.consecutiveFailures ?? 0) + 1,
        lastError: String(result.reason),
      };
    }
  });

  console.log(`[TrendCast] News: ${items.length} items collected`);

  // Per-source breakdown so it's easy to see how many stocks each source yielded.
  const bySource = new Map<NewsSource, number>();
  for (const n of items) bySource.set(n.source, (bySource.get(n.source) ?? 0) + 1);
  if (bySource.size > 0) {
    const parts = Array.from(bySource.entries())
      .map(([s, c]) => `${s}=${c}`)
      .join(', ');
    console.log(`[TrendCast] News by source: ${parts}`);
  }

  return { news: items, health };
}

/** Wrap a single-source collect in a settled promise (keeps the loop simple). */
async function settleCollect(source: NewsSource): Promise<PromiseSettledResult<CollectResult>> {
  try {
    return { status: 'fulfilled', value: await collectFromSource(source) };
  } catch (reason) {
    return { status: 'rejected', reason };
  }
}

/** Resolve after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Result of collecting from a single source. */
interface CollectResult {
  items: NewsItem[];
  /** True when the server returned 304 Not Modified (no new content). */
  unchanged: boolean;
}

/** Collect news from a single source via rss2json.com. */
async function collectFromSource(source: NewsSource): Promise<CollectResult> {
  const configMap: Record<NewsSource, { rssUrl: string }> = {
    bbc: CONFIG.scrape.bbc,
    cnn: CONFIG.scrape.cnn,
    yahoo: CONFIG.scrape.yahoo,
    googleFinance: CONFIG.scrape.googleFinance,
    seekingalpha: CONFIG.scrape.seekingalpha,
    investing: CONFIG.scrape.investing,
    usaStocksIndicator: CONFIG.scrape.usaStocksIndicator,
    stockScreener: CONFIG.scrape.stockScreener,
    stockScreener2: CONFIG.scrape.stockScreener2,
  };
  const apiUrl = configMap[source].rssUrl;

  // Retry on rate-limit (429) responses. rss2json.com's free tier throttles
  // to ~1 req/sec; a transient 429 should not permanently degrade a source.
  let lastError: unknown;
  for (let attempt = 0; attempt <= CONFIG.collection.newsMaxRetries; attempt++) {
    if (attempt > 0) {
      await delay(CONFIG.collection.newsRetryDelayMs);
    }
    try {
      // Stock-indicator sources change in place (daily screener tables), so
      // bypass the 304 cache and always re-fetch to re-parse the stock list.
      const force = STOCK_INDICATOR_SOURCES.has(source);
      const data = await conditionalFetchJson<Rss2JsonResponse>(apiUrl, force);
      if (data === null) {
        // 304 Not Modified — no new headlines. Signal "unchanged" so the health
        // map does NOT count this as a failure.
        console.log(`[TrendCast] ${source.toUpperCase()}: unchanged (304), skipping`);
        return { items: [], unchanged: true };
      }

      if (data.status !== 'ok' || !data.items) {
        throw new Error(`${source.toUpperCase()} RSS feed could not be parsed`);
      }

      return {
        unchanged: false,
        items: data.items
          .flatMap((item): NewsItem[] => {
            const title = item.title?.trim() ?? '';
            const link = item.link?.trim() ?? '';

            if (!title || !link) return [];

            // Clean description — Google News wraps it in anchor tags.
            const description = item.description
              ?.replace(/<[^>]*>/g, '')
              .trim() || undefined;

            // For Google News sources, the title often includes " - Source Name" suffix.
            // Strip it for cleaner headlines (applies to CNN, googleFinance, and any
            // Google News RSS result).
            const isGoogleNewsSource = source === 'cnn' || source === 'googleFinance' || source === 'seekingalpha' || source === 'investing';
            const headline = isGoogleNewsSource && title.includes(' - ')
              ? title.replace(/\s+-\s+[^-]+$/, '').trim()
              : title;

            const imageUrl = item.thumbnail ?? item.enclosure?.link ?? undefined;

            // The two screener feeds share a single `link` across all items, so
            // derive the id from the feed `guid` (falling back to `link`) to keep
            // each item distinct through mergeNews's Map-dedup. Existing sources
            // keep their `link`-based ids to avoid re-dedup churn on stored items.
            const id = GUID_BASED_SOURCES.has(source)
              ? (item.guid?.trim() || link)
              : link;

            const publishedAt = item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString();

            // ── Stock-indicator sources ──────────────────────────────────────
            // Each feed item is a daily screener/report whose description is an
            // HTML table of stocks. Surface each stock as its own NewsItem so the
            // news tab lists the actual tickers and correlation can match them
            // against social / Seeking Alpha / Investing.com / Yahoo Finance.
            if (STOCK_INDICATOR_SOURCES.has(source)) {
              const rawDescription = item.description ?? '';
              const symbols = extractStockSymbols(source, rawDescription);
              const date = dateFromTitle(title);
              const label = STOCK_SOURCE_LABELS[source];

              // Diagnostic: report how many stocks each feed item yielded so we
              // can confirm the table parsing is working end-to-end.
              console.log(
                `[TrendCast] ${label} (${source}): item "${title}" → ${symbols.length} stocks` +
                (symbols.length > 0 ? ` [${symbols.slice(0, 8).join(', ')}${symbols.length > 8 ? ', …' : ''}]` : ''),
              );

              if (symbols.length > 0) {
                return symbols.map((symbol) => {
                  const stockHeadline = date
                    ? `${symbol} — ${label} ${date}`
                    : `${symbol} — ${label}`;
                  return {
                    id: `${source}:${id}:${symbol}`,
                    source,
                    headline: stockHeadline,
                    // Omit the large HTML table from storage (headline only).
                    summary: undefined,
                    url: link,
                    publishedAt,
                    // Keywords are curated to the bare lowercase ticker only
                    // (CORR-03): screener-label tokens (stock/indicator/breakout/
                    // vcp) and date tokens would dilute keyword Jaccard against
                    // signals whose keyword set is ticker-centric. Org-name
                    // bridging is handled by the unified entity space (Phase 14).
                    keywords: [symbol.toLowerCase()],
                    imageUrl: imageUrl ?? undefined,
                    category: classifyCategory(stockHeadline),
                  } satisfies NewsItem;
                });
              }
            }

            const fullText = description ? `${headline} ${description}` : headline;

            // The screener feeds carry large HTML <table> CDATA descriptions that
            // would bloat storage, so omit `summary` for them (headline only).
            const summary = GUID_BASED_SOURCES.has(source) ? undefined : description;

            // CORR-06: Seeking Alpha items often have generic headlines ("More On
            // Earnings Revisions »") while the ticker only appears in the symbol-
            // page URL. Pull it into the keyword set so the item can bridge to a
            // VCP screener item about the same stock in the news↔news pass.
            const saSymbols = source === 'seekingalpha'
              ? extractSeekingAlphaSymbols(`${link} ${fullText}`)
              : [];
            const keywords = [...new Set([...extractKeywords(fullText), ...saSymbols])];

            return [{
              id: `${source}:${id}`,
              source,
              headline,
              summary,
              url: link,
              publishedAt,
              keywords,
              imageUrl: imageUrl ?? undefined,
              // Category assigned at collection time (Phase 5, D-02) so the
              // market-driven news view and export read a consistent category.
              category: classifyCategory(headline),
            } satisfies NewsItem];
          }),
      };
    } catch (err) {
      // Only retry rate-limit (429) responses; other errors fail fast.
      if (isRateLimitError(err)) {
        lastError = err;
        console.warn(
          `[TrendCast] ${source.toUpperCase()}: rate-limited (attempt ${attempt + 1}/${CONFIG.collection.newsMaxRetries + 1}), retrying…`,
        );
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/** True when the error is a rate-limit (429) response. */
function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|rate.?limit|too many requests/i.test(msg);
}