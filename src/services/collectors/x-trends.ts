/**
 * X (Twitter) trends collector.
 *
 * Fetches trending topics from Google Trends RSS (which reflects what's
 * trending on social media including Twitter/X) via the rss2json.com
 * CORS proxy. This is the same approach used for news — Google Trends
 * RSS doesn't send CORS headers, so we route through rss2json.
 *
 * X/Twitter does not offer a free public API for trends. The official
 * v2 API requires a paid Basic tier ($100/mo+). Nitter instances are
 * unreliable. Google Trends RSS is the best free, public, no-auth
 * source for "what's trending right now" — it tracks search spikes
 * that closely mirror Twitter trending topics.
 *
 * If the user is browsing x.com, the content script can also scrape
 * trending topics from the DOM and report via REPORT_SOCIAL_DATA.
 */

import type { SocialSignal } from '@/types';
import { CONFIG } from '@/config';
import { extractKeywords } from '@/utils/keywords';
import { analyzeSentiment } from '@/utils/sentiment';
import { conditionalFetchJson } from '@/utils/conditional-fetch';

/** rss2json.com API response shape (subset). */
interface Rss2JsonResponse {
  status: string;
  items?: Array<{
    title: string;
    link: string;
    pubDate: string;
    description?: string;
  }>;
}

/** Google Trends RSS item with approximate traffic. */
interface GoogleTrendItem {
  title: string;
  pubDate: string;
  approxTraffic?: string;
}

/**
 * Collect trending topics from Google Trends RSS via rss2json.com.
 * Maps them to SocialSignal with platform 'x' so they appear in the
 * HypeFeed alongside Reddit signals.
 */
export async function collectXTrends(): Promise<SocialSignal[]> {
  const apiUrl = CONFIG.scrape.x.trendsRssUrl;

  const data = await conditionalFetchJson<Rss2JsonResponse>(apiUrl);
  if (data === null) {
    // 304 Not Modified — no new trends.
    console.log('[TrendCast] X/Trends: unchanged (304), skipping');
    return [];
  }

  if (data.status !== 'ok' || !data.items) {
    throw new Error('Google Trends RSS feed could not be parsed');
  }

  const trends: GoogleTrendItem[] = data.items.map((item) => ({
    title: item.title?.trim() ?? '',
    pubDate: item.pubDate ?? '',
    approxTraffic: undefined, // rss2json strips custom XML namespaces
  }));

  const results = trends
    .filter((t) => t.title.length > 0)
    .map((trend, idx) => normaliseTrend(trend, idx));

  console.log(`[TrendCast] X/Trends: ${results.length} items collected`);
  return results;
}

/**
 * Convert a Google Trends item into a SocialSignal.
 * Trends are ranked by position (first = most trending).
 * Virality is derived from rank position — top trends get higher scores.
 */
function normaliseTrend(trend: GoogleTrendItem, idx: number): SocialSignal {
  const text = trend.title;
  const sentimentResult = analyzeSentiment(text);

  // Virality: rank-based — #1 trend gets ~98, #10 gets ~55.
  // Google Trends items are already sorted by trending volume, so
  // rank position is a good proxy for virality.
  // Formula: 98 - (idx * 4.5), clamped to [50, 98].
  const virality = Math.max(50, Math.min(98, 98 - idx * 4.5));

  // Timestamp: parse pubDate or use now.
  const timestamp = trend.pubDate ? new Date(trend.pubDate).toISOString() : new Date().toISOString();

  return {
    id: `x-trend:${text.toLowerCase().replace(/\s+/g, '-')}`,
    platform: 'x',
    text,
    author: 'Trending',
    metrics: {
      likes: 0,
      shares: 0,
      comments: 0,
    },
    timestamp,
    keywords: extractKeywords(text),
    sentiment: sentimentResult.score,
    virality,
    url: `https://x.com/search?q=${encodeURIComponent(text)}&f=live`,
  };
}