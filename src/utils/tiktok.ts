/**
 * TikTok trend normalizer.
 *
 * Pure functions that map raw scraped TikTok discover-page trends to
 * SocialSignal with platform 'tiktok'. TikTok has no public API, so the
 * content script scrapes the DOM and passes raw trend data here for
 * normalization. Kept pure (no DOM, no storage, no messaging) so it is
 * unit-testable in isolation.
 */

import type { SocialSignal } from '@/types';
import { extractKeywords } from '@/utils/keywords';
import { analyzeSentiment } from '@/utils/sentiment';

/** Raw scraped TikTok trend shape (from the discover page DOM). */
export interface RawTikTokTrend {
  title: string;
  rank: number;
}

/**
 * Convert a raw scraped TikTok trend into a SocialSignal.
 * Trends are ranked by position (first = most trending).
 * Virality is derived from rank position — top trends get higher scores.
 */
export function normaliseTikTokTrend(trend: RawTikTokTrend): SocialSignal {
  const text = trend.title;
  const sentimentResult = analyzeSentiment(text);

  // Virality: rank-based — #1 trend gets ~98, #10 gets ~55.
  // Formula: 98 - (rank * 4.5), clamped to [50, 98].
  const virality = Math.max(50, Math.min(98, 98 - trend.rank * 4.5));

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
