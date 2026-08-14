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
      // Kalshi public events endpoint with nested markets.
      // We use /events instead of /markets because the /markets endpoint
      // returns dead quarter-by-quarter sports spreads with no trades.
      // The /events endpoint returns real markets with actual prices/volume.
      // mve_filter=exclude filters out multivariate event combos.
      api: 'https://external-api.kalshi.com/trade-api/v2/events?status=open&limit=100&mve_filter=exclude&with_nested_markets=true',
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
      // Google Trends RSS (reflects Twitter/social trends) via rss2json CORS proxy.
      // X has no free public API for trends; Google Trends is the best free source.
      trendsRssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent('https://trends.google.com/trending/rss?geo=US'),
    },
    tiktok: {
      // TikTok discover page — content script reads trend titles
      url: 'https://www.tiktok.com/discover',
    },
    bbc: {
      // BBC news RSS via rss2json.com (CORS-friendly JSON proxy).
      // Direct RSS fetch is CORS-blocked in Firefox MV3 background workers.
      rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent('https://feeds.bbci.co.uk/news/rss.xml'),
      // BBC news homepage as fallback for DOM scraping
      url: 'https://www.bbc.com/news',
    },
    cnn: {
      // CNN news via Google News RSS filtered to CNN, through rss2json.com.
      // CNN's own RSS feed (rss.cnn.com) is unreliable and CORS-blocked.
      rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent('https://news.google.com/rss/search?q=site:cnn.com+when:1d&hl=en-US&gl=US&ceid=US:en'),
      // CNN homepage as fallback for DOM scraping
      url: 'https://www.cnn.com',
    },
    yahoo: {
      // Yahoo Finance RSS — financial news (stocks, Fed, crypto, earnings).
      rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent('https://finance.yahoo.com/news/rssindex'),
      url: 'https://finance.yahoo.com',
    },
    googleFinance: {
      // Google News filtered to finance/politics keywords — overlaps with
      // prediction market topics (elections, Fed rates, Bitcoin, stocks).
      rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent('https://news.google.com/rss/search?q=election+2026+OR+fed+rate+OR+bitcoin+OR+stock+market+when:1d&hl=en-US&gl=US&ceid=US:en'),
      url: 'https://news.google.com',
    },
  },

  // ── Background collection ─────────────────────────────────────
  collection: {
    alarmName: 'trendcast-collect',
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
    settings: 'trendcast:settings',
    latestSnapshot: 'trendcast:latest-snapshot',
    collectedMarkets: 'trendcast:collected-markets',
    collectedSignals: 'trendcast:collected-signals',
    collectedNews: 'trendcast:collected-news',
    correlations: 'trendcast:correlations',
    lastCollectionAt: 'trendcast:last-collection',
    history: 'trendcast:history',
    watchlist: 'trendcast:watchlist',
  },

  // ── Overlay injection ─────────────────────────────────────────
  overlay: {
    containerId: 'trendcast-overlay-root',
    // Debounce DOM mutations before re-scanning for injectable elements.
    mutationDebounceMs: 500,
  },
  // ── Storage budget (Phase 4: performance optimisation) ───────
  // chrome.storage.local has a 10 MB quota in MV3. We keep a safety
  // margin and prune oldest data when the budget is exceeded.
  storageBudget: {
    // Soft budget in bytes for all TrendCast keys combined.
    // chrome.storage.local allows ~10 MB; we target 7 MB to leave headroom.
    budgetBytes: 7 * 1024 * 1024,
    // When over budget, prune these keys (oldest first) down to this fraction.
    pruneTargetFraction: 0.7,
    // Max items retained per collection type (defensive caps).
    maxMarkets: 500,
    maxSignals: 500,
    maxNews: 200,
  },

  // ── Conditional fetch (Phase 4: collection efficiency) ───────
  // Stores ETag/Last-Modified per source so unchanged responses are
  // skipped, saving bandwidth and CPU on the hourly collection cycle.
  fetch: {
    // Storage key for the ETag/Last-Modified cache.
    cacheKey: 'trendcast:fetch-cache',
    // Default request timeout in ms.
    timeoutMs: 15_000,
  },} as const;