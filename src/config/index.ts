/**
 * Centralised configuration constants.
 *
 * Keeping URLs, rate limits, and polling intervals in one place makes
 * it easy to tune the extension without hunting through the codebase.
 */

export const CONFIG = {
  // ── API endpoints ──────────────────────────────────────────────
  apis: {
    polymarket: {
      clob: 'https://clob.polymarket.com',
      gamma: 'https://gamma-api.polymarket.com',
      // Polymarket CLOB is public — no API key needed for read-only market data.
    },
    kalshi: {
      rest: 'https://api.kalshi.com/v2',
      // Kalshi requires a session token for authenticated endpoints,
      // but public market data is accessible without auth.
    },
    reddit: {
      oauth: 'https://www.reddit.com/api/v1/access_token',
      api: 'https://oauth.reddit.com',
      // Reddit API: use app-only OAuth (client credentials) for read-only access.
      // Rate limit: 600 requests / 10 min (authenticated).
    },
    x: {
      api: 'https://api.twitter.com/2',
      // X API v2 requires a bearer token. Free tier: very limited.
      // We fall back to DOM scraping of the active tab when no API key is set.
    },
    tiktok: {
      // TikTok has no official public trend API. We scrape the
      // "Discover" page DOM or use unofficial endpoints at the user's risk.
      discover: 'https://www.tiktok.com/discover',
    },
  },

  // ── Rate limits (requests per window) ──────────────────────────
  rateLimits: {
    polymarket: { requests: 60, windowMs: 60_000 },
    kalshi: { requests: 60, windowMs: 60_000 },
    reddit: { requests: 60, windowMs: 60_000 },
    x: { requests: 15, windowMs: 15 * 60_000 }, // free tier
    tiktok: { requests: 10, windowMs: 60_000 },
  },

  // ── Background polling ────────────────────────────────────────
  polling: {
    alarmName: 'hypemarket-poll',
    defaultIntervalMinutes: 5,
    // MV3 `chrome.alarms` minimum is 0.5 min (30s) in Chrome.
    // Firefox allows 1s minimum but we keep it conservative.
    minIntervalMinutes: 1,
  },

  // ── Storage keys ──────────────────────────────────────────────
  storage: {
    settings: 'hypemarket:settings',
    cachedMarkets: 'hypemarket:cached-markets',
    cachedSignals: 'hypemarket:cached-signals',
    correlations: 'hypemarket:correlations',
  },

  // ── Overlay injection ─────────────────────────────────────────
  overlay: {
    containerId: 'hypemarket-overlay-root',
    // Debounce DOM mutations before re-scanning for injectable elements.
    mutationDebounceMs: 500,
  },
} as const;