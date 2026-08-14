/**
 * News data collector (BBC + CNN).
 *
 * Fetches RSS feeds from BBC and CNN — no login required, public feeds.
 * The background worker fetches and parses the XML directly via `fetch()`.
 *
 * If the user is browsing bbc.com or cnn.com, the content script can also
 * scrape headlines from the DOM and report via REPORT_NEWS_DATA.
 *
 * RSS feeds:
 *   BBC: https://feeds.bbci.co.uk/news/rss.xml
 *   CNN: http://rss.cnn.com/rss/edition.rss
 */

import type { NewsItem, NewsSource } from '@/types';
import { CONFIG } from '@/config';
import { extractKeywords } from '@/utils/keywords';

/** Parsed news item before filtering nulls. */
type MaybeNewsItem = NewsItem | null;

/**
 * Collect news headlines from BBC and CNN RSS feeds.
 * Returns a combined array of NewsItems.
 */
export async function collectNews(
  sources: NewsSource[] = ['bbc', 'cnn'],
): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    sources.map((source) => collectFromSource(source)),
  );

  return results.flatMap((result, i) => {
    if (result.status !== 'fulfilled') {
      console.warn(`[HypeMarket] Failed to collect news from ${sources[i]}:`, result.reason);
      return [];
    }
    return result.value;
  });
}

/** Collect news from a single source's RSS feed. */
async function collectFromSource(source: NewsSource): Promise<NewsItem[]> {
  const rssUrl = source === 'bbc' ? CONFIG.scrape.bbc.rssUrl : CONFIG.scrape.cnn.rssUrl;

  const response = await fetch(rssUrl, {
    headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
  });

  if (!response.ok) {
    throw new Error(`${source.toUpperCase()} RSS error: ${response.status} ${response.statusText}`);
  }

  const xmlText = await response.text();
  return parseRssXml(xmlText, source);
}

/**
 * Parse an RSS XML string into NewsItem[].
 * Uses DOMParser (available in both background workers and content scripts).
 */
function parseRssXml(xml: string, source: NewsSource): NewsItem[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');

  // Check for parse errors.
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    console.warn(`[HypeMarket] RSS XML parse error for ${source}:`, parseError.textContent);
    return [];
  }

  const items = Array.from(doc.querySelectorAll('item'));

  return items
    .map((item): MaybeNewsItem => {
      const title = item.querySelector('title')?.textContent?.trim() ?? '';
      const link = item.querySelector('link')?.textContent?.trim() ?? '';
      const description = item.querySelector('description')?.textContent?.trim() ?? undefined;
      const pubDate = item.querySelector('pubDate')?.textContent?.trim() ?? '';

      // Try to find an image URL from media:content or enclosure.
      const mediaContent = item.querySelector('media\\:content, content');
      const imageUrl =
        mediaContent?.getAttribute('url') ??
        item.querySelector('enclosure')?.getAttribute('url') ??
        undefined;

      if (!title || !link) return null;

      const fullText = description ? `${title} ${description}` : title;

      return {
        id: `${source}:${link}`,
        source,
        headline: title,
        summary: description,
        url: link,
        publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        keywords: extractKeywords(fullText),
        imageUrl: imageUrl ?? undefined,
      } satisfies NewsItem;
    })
    .filter((item): item is NewsItem => item !== null);
}