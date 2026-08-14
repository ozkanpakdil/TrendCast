/**
 * Centralised configuration constants.
 *
 * ── Client-side architecture ──────────────────────────────────────
 * No API keys. The extension scrapes data using the user's own browser
 * sessions. The background worker opens background tabs to collect
 * data hourly, and content scripts scrape the DOM on active visits.
 *
 * Keeping URLs, collection intervals, and storage keys in one place
 * makes it easy to tune the extension without hunting through the codebase.
 */

export const CONFIG = {
  // ── Scraping targets ───────────────────────────────────────────
  // These are the URLs the background worker opens in background tabs
  // to collect data. Content scripts matching these domains will
  // scrape the DOM and report back via messaging.
  scrape: {
    polymarket: {
      // Polymarket markets page — content script reads market cards
      url: 'https://polymarket.com/markets',
      // Gamma API is public (no key) — we can also fetch directly from
      // the background worker via fetch() since we have host_permissions.
      gammaApi: 'https://gamma-api.polymarket.com/markets?limit=100&active=true&closed=false&order=volume&ascending=false',
    },
    kalshi: {
      // Kalshi markets page
      url: 'https://kalshi.com/markets',
      // Kalshi public market data endpoint (no auth needed for read-only)
      api: 'https://api.kalshi.com/v2/markets?status=open&limit=100',
    },
    reddit: {
      // Reddit popular/hot — content script reads post titles + scores
      url: 'https://www.reddit.com/r/popular/hot/',
      // Reddit also exposes .json endpoints (no auth needed for public data)
      jsonUrl: 'https://www.reddit.com/r/popular/hot.json?limit=50',
    },
    x: {
      // X explore/trending page — content script reads trending topics
      url: 'https://x.com/explore/tabs/trending',
    },
    tiktok: {
      // TikTok discover page — content script reads trend titles
      url: 'https://www.tiktok.com/discover',
    },
    bbc: {
      // BBC news RSS — no login needed, public feed
      rssUrl: 'https://feeds.bbci.co.uk/news/rss.xml',
      // BBC news homepage as fallback for DOM scraping
      url: 'https://www.bbc.com/news',
    },
    cnn: {
      // CNN RSS — no login needed, public feed
      rssUrl: 'http://rss.cnn.com/rss/edition.rss',
      // CNN homepage as fallback for DOM scraping
      url: 'https://www.cnn.com',
    },
  },

  // ── Background collection ─────────────────────────────────────
  collection: {
    alarmName: 'hypemarket-collect',
    defaultIntervalMinutes: 60, // hourly
    // MV3 `chrome.alarms` minimum is 0.5 min (30s) in Chrome.
    minIntervalMinutes: 5,
    // How long to wait for a background tab to load before scraping (ms).
    tabLoadTimeoutMs: 15_000,
    // Max number of background tabs to open simultaneously.
    maxConcurrentTabs: 3,
  },

  // ── Storage keys ──────────────────────────────────────────────
  storage: {
    settings: 'hypemarket:settings',
    latestSnapshot: 'hypemarket:latest-snapshot',
    collectedMarkets: 'hypemarket:collected-markets',
    collectedSignals: 'hypemarket:collected-signals',
    collectedNews: 'hypemarket:collected-news',
    correlations: 'hypemarket:correlations',
    lastCollectionAt: 'hypemarket:last-collection',
    history: 'hypemarket:history',
    watchlist: 'hypemarket:watchlist',
  },

  // ── Overlay injection ─────────────────────────────────────────
  overlay: {
    containerId: 'hypemarket-overlay-root',
    // Debounce DOM mutations before re-scanning for injectable elements.
    mutationDebounceMs: 500,
  },
} as const;