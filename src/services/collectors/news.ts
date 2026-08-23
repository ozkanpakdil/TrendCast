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
  }>;
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
      const data = await conditionalFetchJson<Rss2JsonResponse>(apiUrl);
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
          .map((item): NewsItem | null => {
            const title = item.title?.trim() ?? '';
            const link = item.link?.trim() ?? '';

            if (!title || !link) return null;

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

            const fullText = description ? `${headline} ${description}` : headline;
            const imageUrl = item.thumbnail ?? item.enclosure?.link ?? undefined;

            return {
              id: `${source}:${link}`,
              source,
              headline,
              summary: description,
              url: link,
              publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
              keywords: extractKeywords(fullText),
              imageUrl: imageUrl ?? undefined,
              // Category assigned at collection time (Phase 5, D-02) so the
              // market-driven news view and export read a consistent category.
              category: classifyCategory(headline),
            } satisfies NewsItem;
          })
          .filter((item): item is NewsItem => item !== null),
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