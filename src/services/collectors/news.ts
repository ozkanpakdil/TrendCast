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

import type { NewsItem, NewsSource } from '@/types';
import { CONFIG } from '@/config';
import { extractKeywords } from '@/utils/keywords';

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
 * Collect news headlines from BBC and CNN via rss2json.com.
 * Returns a combined array of NewsItems.
 */
export async function collectNews(
  sources: NewsSource[] = ['bbc', 'cnn'],
): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    sources.map((source) => collectFromSource(source)),
  );

  const items = results.flatMap((result, i) => {
    if (result.status !== 'fulfilled') {
      console.warn(`[TrendCast] Failed to collect news from ${sources[i]}:`, result.reason);
      return [];
    }
    return result.value;
  });

  console.log(`[TrendCast] News: ${items.length} items collected`);
  return items;
}

/** Collect news from a single source via rss2json.com. */
async function collectFromSource(source: NewsSource): Promise<NewsItem[]> {
  const apiUrl = source === 'bbc' ? CONFIG.scrape.bbc.rssUrl : CONFIG.scrape.cnn.rssUrl;

  const response = await fetch(apiUrl, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`${source.toUpperCase()} RSS error: ${response.status} ${response.statusText}`);
  }

  const data: Rss2JsonResponse = await response.json();

  if (data.status !== 'ok' || !data.items) {
    throw new Error(`${source.toUpperCase()} RSS feed could not be parsed`);
  }

  return data.items
    .map((item): NewsItem | null => {
      const title = item.title?.trim() ?? '';
      const link = item.link?.trim() ?? '';

      if (!title || !link) return null;

      // Clean description — Google News wraps it in anchor tags.
      const description = item.description
        ?.replace(/<[^>]*>/g, '')
        .trim() || undefined;

      // For CNN via Google News, the title includes " - CNN" suffix.
      const headline = source === 'cnn' && title.endsWith(' - CNN')
        ? title.slice(0, -6).trim()
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
      } satisfies NewsItem;
    })
    .filter((item): item is NewsItem => item !== null);
}