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
  // ── Community links ───────────────────────────────────────────
  // Public Telegram group for user support, announcements, and feedback.
  // Swap the placeholder URL for your real group link after creating it.
  community: {
    telegram: 'https://t.me/trendcast_community',
    githubIssues: 'https://github.com/ozkanpakdil/trendcast/issues',
  },

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

    // ── Reddit subreddit presets ───────────────────────────────
    // Pre-configured subreddit lists per category. Users can pick a
    // category from settings or manually add/remove subreddits.
    // The extension focuses on finance & stock market correlation,
    // so `finance` is the default category.
    redditCategories: {
      finance: {
        label: '💰 Finance & Stock Market',
        subreddits: ['investing', 'stocks', 'wallstreetbets', 'UKInvesting'],
      },
      crypto: {
        label: '🪙 Crypto',
        subreddits: ['CryptoCurrency', 'Bitcoin', 'ethtrader', 'CryptoMarkets'],
      },
      economics: {
        label: '📈 Economics & Macro',
        subreddits: ['economics', 'EconomicsHub', 'AskEconomics', 'econmonitor'],
      },
      sports: {
        label: '⚽ Sports',
        subreddits: ['sports', 'nba', 'nfl', 'soccer'],
      },
      entertainment: {
        label: '🎬 Entertainment',
        subreddits: ['entertainment', 'movies', 'television', 'gaming'],
      },
      technology: {
        label: '💻 Technology',
        subreddits: ['technology', 'gadgets', 'artificial', 'MachineLearning'],
      },
      politics: {
        label: '🏛️ Politics',
        subreddits: ['politics', 'worldnews', 'geopolitics', 'PoliticalDiscussion'],
      },
    } as const,
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
    seekingalpha: {
      // Seeking Alpha — deep financial analysis (stocks, earnings, ETFs).
      // Seeking Alpha has no public RSS feed, so we use Google News RSS
      // filtered to the site (same CORS-friendly rss2json proxy as CNN).
      rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent('https://news.google.com/rss/search?q=site:seekingalpha.com+when:1d&hl=en-US&gl=US&ceid=US:en'),
      // Seeking Alpha homepage as fallback for DOM scraping
      url: 'https://seekingalpha.com',
    },
    investing: {
      // Investing.com — global financial news (markets, forex, crypto, commodities).
      // No public RSS; use Google News RSS filtered to the site.
      rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent('https://news.google.com/rss/search?q=site:investing.com+when:1d&hl=en-US&gl=US&ceid=US:en'),
      // Investing.com homepage as fallback for DOM scraping
      url: 'https://www.investing.com',
    },
    usaStocksIndicator: {
      // Public Company Stocks Indicator — weekly layoff/award stock reports
      // from the user's own Hugo site (PaperMod theme, RSS already enabled).
      rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent('https://ozkanpakdil.github.io/usa-stocks-indicator/index.xml'),
      // Raw feed URL as the DOM fallback
      url: 'https://ozkanpakdil.github.io/usa-stocks-indicator/index.xml',
    },
    stockScreener: {
      // US Stock Breakout Screener — daily breakout hits feed.
      rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent('https://ozkanpakdil.github.io/top-us-stock-tickers/data/screener/rss.xml'),
      // Raw feed URL as the DOM fallback
      url: 'https://ozkanpakdil.github.io/top-us-stock-tickers/data/screener/rss.xml',
    },
    stockScreener2: {
      // VCP Screener-2 — Volatility Contraction Pattern daily feed.
      rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent('https://ozkanpakdil.github.io/top-us-stock-tickers/data/screener2/rss.xml'),
      // Raw feed URL as the DOM fallback
      url: 'https://ozkanpakdil.github.io/top-us-stock-tickers/data/screener2/rss.xml',
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
    // A source is considered "stale" if it hasn't been fetched within this
    // window (2 missed hourly cycles).
    stalenessThresholdMs: 2 * 60 * 60 * 1000,
    // News source fetch tuning. rss2json.com's free tier rate-limits to
    // ~1 request/sec, so firing all 6 sources in parallel causes several to
    // be rejected (429) and drift healthy-but-quiet sources to Degraded.
    // Sources are fetched sequentially with a stagger delay, and a
    // rate-limited (429) fetch is retried after a short backoff.
    newsStaggerMs: 400,
    newsRetryDelayMs: 1_000,
    newsMaxRetries: 2,
  },

  // ── Storage keys ──────────────────────────────────────────────
  storage: {
    settings: 'trendcast:settings',
    latestSnapshot: 'trendcast:latest-snapshot',
    collectedMarkets: 'trendcast:collected-markets',
    collectedSignals: 'trendcast:collected-signals',
    collectedNews: 'trendcast:collected-news',
    correlations: 'trendcast:correlations',
    correlationRunHistory: 'trendcast:corr-run-history',
    lastCollectionAt: 'trendcast:last-collection',
    history: 'trendcast:history',
    watchlist: 'trendcast:watchlist',
    alertState: 'trendcast:alert-state',
    alertHistory: 'trendcast:alert-history',
    marketNewsView: 'trendcast:market-news-view',
    socialSourceHealth: 'trendcast:social-source-health',
  },

  // ── Market-driven news (Phase 5) ─────────────────────────────
  // Tunable constants for the derived "market-driven news" view. The view is
  // a read-only projection over existing markets + news + correlations.
  marketNews: {
    // A market is "notable" when its 24h volume is at or above this (D-06).
    minVolume: 10_000,
    // Cap the number of markets surfaced per category (D-14).
    capPerCategory: 20,
  },

  // ── Correlation alerts (Phase 4) ─────────────────────────────
  // Alert engine tuning. Alerts are deduped, throttled, and scoped to
  // the user's watchlist. Direction is derived from aggregate signal
  // sentiment + Yes-price delta vs a prior snapshot.
  alerts: {
    // Alarm that re-checks the last stored correlation result so alerts
    // still fire if the worker was killed mid-correlation.
    alarmName: 'trendcast-alert-sweep',
    // How often the alert sweep runs (minutes). Respects the MV3
    // chrome.alarms 30-second floor.
    sweepIntervalMinutes: 10,
    // Max alert records retained (ring-buffer cap).
    historyCap: 100,
    // Global throttle: at most one alert per this many minutes.
    globalCooldownMinutes: 5,
    // Per-market cooldown: no repeat alert for the same market within
    // this many minutes (defaults to the settings value).
    perMarketCooldownMinutes: 60,
    // Meaningful-band flip: a direction change only alerts when the
    // sentiment delta crosses ±this, OR the Yes price moves > yesPriceBand.
    sentimentBand: 0.2,
    yesPriceBand: 0.02,
    // Toolbar badge shows total alerts within this window (hours).
    badgeWindowHours: 24,
    // Cross-source consensus (Phase 10, D-01): a topic fires a crossSource
    // alert only when it appears across at least this many distinct source
    // types, AND (when requireSocialAndNews is true) it mixes at least one
    // social platform with at least one news source.
    minConsensusSourceTypes: 3,
    requireSocialAndNews: true,
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
    // Note: news is intentionally uncapped in mergeNews() so all 6 sources
    // survive a full cycle; storage pruning below protects the quota.
    maxMarkets: 1000,
    maxSignals: 1000,
    maxNews: 1000,
  },

  // ── Conditional fetch (Phase 4: collection efficiency) ───────
  // Stores ETag/Last-Modified per source so unchanged responses are
  // skipped, saving bandwidth and CPU on the hourly collection cycle.
  fetch: {
    // Storage key for the ETag/Last-Modified cache.
    cacheKey: 'trendcast:fetch-cache',
    // Default request timeout in ms.
    timeoutMs: 15_000,
  },

  // ── ML correlation models ─────────────────────────────────────
  // Local ML models for the embedding and sentiment correlation engines.
  // All run fully client-side via Transformers.js (ONNX Runtime Web).
  // Models are downloaded from the Hugging Face Hub on first use and
  // cached by the browser. No API keys, no server calls.
  ml: {
    // Embedding models — convert text to vectors for cosine similarity.
    embeddingModels: [
      {
        id: 'Xenova/all-MiniLM-L6-v2' as const,
        label: 'MiniLM L6 v2 (23 MB · fastest)',
        dimensions: 384,
        size: '~23 MB',
      },
      {
        id: 'Xenova/bge-small-en-v1.5' as const,
        label: 'BGE Small v1.5 (33 MB · higher accuracy)',
        dimensions: 384,
        size: '~33 MB',
      },
      {
        id: 'Xenova/gte-small' as const,
        label: 'GTE Small (30 MB · high accuracy)',
        dimensions: 384,
        size: '~30 MB',
      },
    ],
    // Sentiment models — classify text sentiment with a transformer.
    sentimentModels: [
      {
        id: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english' as const,
        label: 'DistilBERT SST-2 (67 MB · general news)',
        size: '~67 MB',
      },
      {
        id: 'Xenova/twitter-roberta-base-sentiment-latest' as const,
        label: 'Twitter RoBERTa (120 MB · social media)',
        size: '~120 MB',
      },
      {
        id: 'Xenova/finbert' as const,
        label: 'FinBERT (110 MB · financial news)',
        size: '~110 MB',
      },
      {
        id: 'Xenova/bert-base-multilingual-uncased-sentiment' as const,
        label: 'Multilingual BERT (110 MB · multi-language)',
        size: '~110 MB',
      },
    ],
    // Zero-shot classification models — NLI-based entailment scoring against
    // arbitrary labels (e.g., contract questions). No fine-tuning needed.
    zeroShotModels: [
      {
        id: 'Xenova/distilbert-base-uncased-mnli' as const,
        label: 'DistilBERT MNLI (67 MB · fastest zero-shot)',
        size: '~67 MB',
      },
      {
        id: 'Xenova/deberta-v3-base-zeroshot' as const,
        label: 'DeBERTa-v3 Zero-Shot (110 MB · higher accuracy)',
        size: '~110 MB',
      },
    ],
    // ML-based NER models — transformer token classification for entity extraction.
    // Replaces the regex-based entity extraction in the heuristic engine.
    nerModels: [
      {
        id: 'Xenova/bert-base-NER-uncased' as const,
        label: 'BERT Base NER (110 MB · standard accuracy)',
        size: '~110 MB',
      },
      {
        id: 'Xenova/bert-large-NER-uncased' as const,
        label: 'BERT Large NER (340 MB · highest accuracy)',
        size: '~340 MB',
      },
    ],
    // Small LLM models — instruction-tuned text generation models that
    // can perform correlation assessment by reasoning about the
    // relationship between text and contract questions.
    // ⚠️ These are much larger than other ML models and benefit from WebGPU.
    llmModels: [
      {
        id: 'HuggingFaceTB/SmolLM2-135M-Instruct' as const,
        label: 'SmolLM2 135M (270 MB · fastest LLM)',
        size: '~270 MB',
      },
      {
        id: 'HuggingFaceTB/SmolLM2-360M-Instruct' as const,
        label: 'SmolLM2 360M (720 MB · better reasoning)',
        size: '~720 MB',
      },
      {
        id: 'onnx-community/Qwen2.5-0.5B-Instruct-ONNX' as const,
        label: 'Qwen2.5 0.5B (500 MB · strong small LLM)',
        size: '~500 MB',
      },
      {
        id: 'onnx-community/Qwen2.5-1.5B-Instruct-ONNX' as const,
        label: 'Qwen2.5 1.5B (1.5 GB · best quality, slow on CPU)',
        size: '~1.5 GB',
      },
      {
        id: 'onnx-community/Phi-3.5-mini-instruct-onnx-web' as const,
        label: 'Phi-3.5 mini (2.3 GB · Microsoft, 128K context)',
        size: '~2.3 GB',
      },
      {
        id: 'onnx-community/DeepSeek-R1-Distill-Qwen-1.5B-ONNX' as const,
        label: 'DeepSeek R1 Distill 1.5B (1.4 GB · reasoning model)',
        size: '~1.4 GB',
      },
      {
        id: 'onnx-community/glm-edge-1.5b-chat-ONNX' as const,
        label: 'GLM-Edge 1.5B (1 GB · Zhipu AI, edge-optimized)',
        size: '~1 GB',
      },
    ],
  },
} as const;