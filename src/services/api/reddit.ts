/**
 * Reddit API client (app-only OAuth).
 *
 * Reddit requires OAuth for API access. For read-only public data, we use
 * "application-only" OAuth with client credentials (no user login needed).
 *
 * Flow:
 *   1. POST to /api/v1/access_token with client_id:client_secret (Basic auth)
 *   2. Receive a bearer token (valid ~1 hour)
 *   3. Use the token to access oauth.reddit.com endpoints
 *
 * Docs: https://github.com/reddit-archive/reddit/wiki/OAuth2-App-Types
 *
 * ⚠️ Pitfall: Reddit rate limits are 600 req/10min for authenticated apps.
 *    The API returns `x-ratelimit-remaining` and `x-ratelimit-reset` headers.
 *    We use our token-bucket limiter as a safety net.
 *
 * ⚠️ Pitfall: If no client credentials are configured, we fall back to
 *    scraping the old.reddit.com JSON endpoints (append .json to any URL).
 *    This is less reliable but requires no auth.
 */

import type { SocialSignal } from '@/types';
import { CONFIG } from '@/config';
import { RateLimiter } from '@/utils/rate-limiter';
import { extractKeywords } from '@/utils/keywords';

const limiter = new RateLimiter(CONFIG.rateLimits.reddit);

let cachedToken: { token: string; expiresAt: number } | null = null;

/** Obtain or reuse an app-only OAuth token. */
async function getRedditToken(clientId?: string, clientSecret?: string): Promise<string | null> {
  // Return cached token if still valid (with 60s buffer).
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  if (!clientId || !clientSecret) return null;

  await limiter.waitForToken();

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const response = await fetch(CONFIG.apis.reddit.oauth, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) return null;

  const data: { access_token: string; expires_in: number } = await response.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.token;
}

/** Search Reddit for posts matching keywords. */
export async function searchReddit(
  keywords: string[],
  credentials?: { clientId: string; clientSecret: string },
): Promise<SocialSignal[]> {
  const query = keywords.join(' ');
  if (!query) return [];

  const token = await getRedditToken(credentials?.clientId, credentials?.clientSecret);

  await limiter.waitForToken();

  // If we have a token, use the OAuth endpoint. Otherwise, fall back to
  // the public JSON endpoint (no auth, less reliable, may get rate-limited).
  const baseUrl = token ? CONFIG.apis.reddit.api : 'https://www.reddit.com';
  const url = `${baseUrl}/search?q=${encodeURIComponent(query)}&sort=hot&limit=25&type=link`;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, { headers });
  if (!response.ok) return [];

  const data: RedditSearchResponse = await response.json();

  return (data?.data?.children ?? [])
    .map((child) => child.data)
    .filter((post): post is RedditPost => post != null)
    .map(normaliseRedditPost);
}

interface RedditSearchResponse {
  data?: {
    children: { data: RedditPost | null }[];
  };
}

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

function normaliseRedditPost(post: RedditPost): SocialSignal {
  const text = `${post.title} ${post.selftext ?? ''}`;
  // Rough sentiment proxy: upvote_ratio (0–1 → -1 to +1).
  const sentiment = (post.upvote_ratio - 0.5) * 2;
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