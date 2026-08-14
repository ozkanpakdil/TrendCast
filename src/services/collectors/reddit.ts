/**
 * Reddit data collector.
 *
 * Uses Reddit's public .json endpoints — no OAuth, no API key required.
 * The background worker fetches popular/hot posts directly via `fetch()`.
 * The user's browser session cookies are sent automatically, so if the
 * user is logged in to Reddit, their personalised feed is used.
 *
 * If the user is browsing reddit.com, the content script can also scrape
 * post titles and scores from the DOM and report via REPORT_SOCIAL_DATA.
 */

import type { SocialSignal } from '@/types';
import { CONFIG } from '@/config';
import { extractKeywords } from '@/utils/keywords';
import { analyzeSentiment } from '@/utils/sentiment';

/** Raw Reddit .json post shape (subset). */
interface RedditPost {
  id: string;
  title: string;
  selftext?: string;
  author: string;
  subreddit: string;
  ups: number;
  num_comments: number;
  upvote_ratio: number;
  created_utc: number;
  view_count?: number;
}

interface RedditListingResponse {
  data?: {
    children: { data: RedditPost | null }[];
  };
}

/**
 * Collect trending Reddit posts from the public .json endpoint.
 * No authentication required — the browser sends cookies automatically.
 */
export async function collectRedditSignals(limit = 50): Promise<SocialSignal[]> {
  const url = `${CONFIG.scrape.reddit.jsonUrl}&limit=${limit}`;

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Reddit .json error: ${response.status} ${response.statusText}`);
  }

  const data: RedditListingResponse = await response.json();

  const results = (data?.data?.children ?? [])
    .map((child) => child.data)
    .filter((post): post is RedditPost => post != null)
    .map(normaliseRedditPost);

  console.log(`[TrendCast] Reddit: ${results.length} items collected`);
  return results;
}

/** Convert a Reddit post into our normalised `SocialSignal`. */
function normaliseRedditPost(post: RedditPost): SocialSignal {
  const text = `${post.title} ${post.selftext ?? ''}`;
  // Phase 3: Use lexicon-based NLP sentiment analysis instead of just upvote ratio.
  // Blend text sentiment (70%) with upvote ratio (30%) for a combined score.
  const textSentiment = analyzeSentiment(text).score;
  const ratioSentiment = (post.upvote_ratio - 0.5) * 2;
  const sentiment = textSentiment * 0.7 + ratioSentiment * 0.3;
  // Virality: normalise ups + comments (log scale to compress range).
  const engagement = post.ups + post.num_comments;
  const virality = Math.min(100, Math.log10(engagement + 1) * 25);

  return {
    id: `reddit:${post.id}`,
    platform: 'reddit',
    text: post.title,
    author: `r/${post.subreddit}`,
    metrics: {
      likes: post.ups,
      shares: 0,
      comments: post.num_comments,
      views: post.view_count,
    },
    timestamp: new Date(post.created_utc * 1000).toISOString(),
    keywords: extractKeywords(text),
    sentiment,
    virality,
  };
}