/**
 * TikTok trends collector (background fetch — no tab).
 *
 * TikTok has no free public API for trends/discover content. However, the
 * discover page embeds its trending data as SSR JSON inside a
 * `__UNIVERSAL_DATA_FOR_REHYDRATION__` script tag. Because the manifest
 * declares `https://*.tiktok.com/*` in `host_permissions`, the MV3
 * background worker can `fetch()` this page directly — extension workers
 * with host permissions are NOT subject to CORS. This means we collect
 * TikTok the same way as Reddit/X/news: a pure background `fetch()`, no
 * visible tab.
 *
 * This is inherently best-effort: TikTok's SSR payload shape changes
 * frequently. We use broad defensive parsing and gracefully return []
 * when the expected structure is absent, so a TikTok change never breaks
 * the collection pipeline (SRC-01 graceful degradation).
 */

import type { SocialSignal } from '@/types';
import { CONFIG } from '@/config';
import { extractKeywords } from '@/utils/keywords';
import { analyzeSentiment } from '@/utils/sentiment';
import { conditionalFetch } from '@/utils/conditional-fetch';

/** Max trends to collect per cycle. */
const MAX_TRENDS = 30;

/**
 * Collect trending TikTok hashtags by fetching the discover page and
 * parsing its embedded SSR JSON. Returns normalised SocialSignals.
 *
 * @returns SocialSignal[] — empty array when nothing parseable (graceful).
 */
export async function collectTikTokTrends(): Promise<SocialSignal[]> {
  const url = CONFIG.scrape.tiktok.url;

  const response = await conditionalFetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    },
  });

  if (response === null) {
    // 304 Not Modified — no new trends.
    console.log('[TrendCast] TikTok: unchanged (304), skipping');
    return [];
  }

  if (!response.ok) {
    throw new Error(`TikTok fetch error: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const titles = parseTrendTitles(html);

  const results = titles
    .map((title, idx) => normaliseTikTokTrend(title, idx))
    .filter((s) => s.text.length > 0);

  console.log(`[TrendCast] TikTok: ${results.length} items collected`);
  return results;
}

/**
 * Parse trending hashtag titles from the TikTok discover page HTML.
 *
 * TikTok embeds SSR state in a `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">`
 * tag containing JSON. Trending hashtags appear under a `challengeList` /
 * `challengeInfoList` path with a `title` field. We defensively scan the
 * JSON for objects that look like trending challenges (have a `title` and
 * a `challengeId`/`id`), dedup, and cap at MAX_TRENDS.
 *
 * Falls back to scanning raw HTML for `#hashtag` patterns if the SSR JSON
 * shape changes. Returns [] when nothing is found.
 */
export function parseTrendTitles(html: string): string[] {
  const titles = new Set<string>();

  // 1) Try the SSR JSON blob.
  const json = extractSsrJson(html);
  if (json) {
    collectChallengeTitles(json, titles);
  }

  // 2) Fallback: scan raw HTML for #hashtag tokens.
  if (titles.size === 0) {
    const hashtagRe = /#([A-Za-z0-9_]{2,40})/g;
    let m: RegExpExecArray | null;
    while ((m = hashtagRe.exec(html)) !== null && titles.size < MAX_TRENDS) {
      titles.add(m[1]);
    }
  }

  return [...titles].slice(0, MAX_TRENDS);
}

/** Extract the SSR JSON object from the rehydration script tag. */
function extractSsrJson(html: string): unknown {
  const re = /<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/i;
  const m = html.match(re);
  if (!m || !m[1]) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/**
 * Recursively walk the SSR JSON looking for objects that look like
 * trending challenges (have a string `title` and a `challengeId`/`id`).
 * Collects their titles, deduped, capped at MAX_TRENDS.
 */
function collectChallengeTitles(node: unknown, out: Set<string>): void {
  if (out.size >= MAX_TRENDS) return;

  if (Array.isArray(node)) {
    for (const item of node) collectChallengeTitles(item, out);
    return;
  }

  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;

    // Heuristic: an object with a title + challenge-ish id is a trend.
    const title = obj.title;
    const hasId = typeof obj.challengeId === 'string' || typeof obj.id === 'string';
    if (typeof title === 'string' && title.trim().length >= 2 && hasId) {
      out.add(title.trim());
      if (out.size >= MAX_TRENDS) return;
    }

    for (const value of Object.values(obj)) {
      collectChallengeTitles(value, out);
      if (out.size >= MAX_TRENDS) return;
    }
  }
}

/**
 * Convert a TikTok trend title into a SocialSignal.
 * Trends are ranked by position (first = most trending).
 * Virality is derived from rank position — top trends get higher scores.
 */
function normaliseTikTokTrend(title: string, idx: number): SocialSignal {
  const text = title;
  const sentimentResult = analyzeSentiment(text);

  // Virality: rank-based — #1 trend gets ~98, #10 gets ~55.
  // Formula: 98 - (idx * 4.5), clamped to [50, 98].
  const virality = Math.max(50, Math.min(98, 98 - idx * 4.5));

  return {
    id: `tiktok:${text.toLowerCase().replace(/\s+/g, '-')}`,
    platform: 'tiktok',
    text,
    author: 'Trending',
    metrics: {
      likes: 0,
      shares: 0,
      comments: 0,
    },
    timestamp: new Date().toISOString(),
    keywords: extractKeywords(text),
    sentiment: sentimentResult.score,
    virality,
    url: `https://www.tiktok.com/search?q=${encodeURIComponent(text)}`,
  };
}
