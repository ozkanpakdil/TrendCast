/**
 * Browser API mock fixtures for Playwright E2E tests.
 *
 * TrendCast's dashboard and popup use `webextension-polyfill`, which wraps
 * `chrome.*` into a promise-based `browser` global. In a real extension
 * context these are provided by the browser. In Playwright we load the
 * built pages via `file://`, so we inject a mock before any app code runs.
 *
 * The mock provides:
 *   - browser.storage.local.get / set / remove (in-memory)
 *   - browser.storage.onChanged.addListener / removeListener
 *   - browser.runtime.sendMessage (returns canned responses)
 *   - browser.runtime.onMessage.addListener
 *   - browser.tabs.create
 *   - browser.alarms.create / clear
 *
 * Test data (snapshot, settings, history, watchlist, correlations) is
 * pre-seeded into the in-memory store so the UI renders with content.
 */

import type { Page } from '@playwright/test';

// ── Test data ─────────────────────────────────────────────────────

export const MOCK_SETTINGS = {
  collectionIntervalMinutes: 60,
  enabledSources: {
    polymarket: true,
    kalshi: true,
    x: true,
    reddit: true,
    tiktok: false,
    bbc: true,
    cnn: true,
    yahoo: true,
    googleFinance: true,
  },
  highlightThreshold: 60,
  overrideNewTab: true,
  theme: 'dark',
  maxHistoryEntries: 168,
  correlationEngine: 'heuristic',
  embeddingModel: 'Xenova/all-MiniLM-L6-v2',
  sentimentModel: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
  zeroShotModel: 'Xenova/distilbert-base-uncased-mnli',
  nerModel: 'Xenova/bert-base-NER-uncased',
  redditSubreddits: ['investing', 'stocks', 'wallstreetbets', 'UKInvesting'],
};

export const MOCK_SNAPSHOT = {
  collectedAt: Date.now(),
  sourceHealth: {
    bbc: { lastFetchedAt: Date.now(), itemCount: 2, consecutiveFailures: 0 },
    cnn: { lastFetchedAt: Date.now(), itemCount: 2, consecutiveFailures: 0 },
    seekingalpha: { lastFetchedAt: Date.now(), itemCount: 10, consecutiveFailures: 0 },
    investing: { lastFetchedAt: Date.now(), itemCount: 0, consecutiveFailures: 1 },
  },
  markets: [
    {
      id: 'market-1',
      platform: 'polymarket',
      question: 'Will BTC close above $100k on Dec 31?',
      outcomes: [
        { label: 'Yes', price: 0.65 },
        { label: 'No', price: 0.35 },
      ],
      endDate: '2026-12-31T23:59:59Z',
      volume24h: 1_500_000,
      liquidity: 500_000,
      slug: 'btc-100k-dec-31',
      url: 'https://polymarket.com/event/btc-100k-dec-31',
      keywords: ['btc', 'bitcoin', '100k', 'price'],
      lastUpdated: Date.now(),
    },
    {
      id: 'market-2',
      platform: 'kalshi',
      question: 'Will the Fed cut rates in Q1 2026?',
      outcomes: [
        { label: 'Yes', price: 0.42 },
        { label: 'No', price: 0.58 },
      ],
      endDate: '2026-03-31T23:59:59Z',
      volume24h: 800_000,
      liquidity: 300_000,
      slug: 'fed-rate-cut-q1',
      url: 'https://kalshi.com/markets/fed-rate-cut-q1',
      keywords: ['fed', 'rate', 'cut', 'interest'],
      lastUpdated: Date.now(),
    },
  ],
  signals: [
    {
      id: 'signal-1',
      platform: 'x',
      text: '$BTC to the moon! Bitcoin hitting new highs 🚀',
      author: 'crypto_whale',
      metrics: { likes: 1200, shares: 340, comments: 89, views: 45_000 },
      timestamp: new Date(Date.now() - 3_600_000).toISOString(),
      keywords: ['btc', 'bitcoin', 'moon', 'highs'],
      sentiment: 0.8,
      virality: 85,
      url: 'https://x.com/crypto_whale/status/123',
    },
    {
      id: 'signal-2',
      platform: 'reddit',
      text: 'Fed signals possible rate cut — what does this mean for stocks?',
      author: 'u/investor_joe',
      metrics: { likes: 560, shares: 12, comments: 120, views: 12_000 },
      timestamp: new Date(Date.now() - 7_200_000).toISOString(),
      keywords: ['fed', 'rate', 'cut', 'stocks'],
      sentiment: 0.3,
      virality: 55,
      url: 'https://reddit.com/r/investing/comments/abc',
    },
    {
      id: 'signal-3',
      platform: 'tiktok',
      text: 'Bitcoin explained in 60 seconds #crypto #btc',
      author: '@crypto_edu',
      metrics: { likes: 8900, shares: 1200, comments: 400, views: 200_000 },
      timestamp: new Date(Date.now() - 10_800_000).toISOString(),
      keywords: ['bitcoin', 'crypto', 'btc'],
      sentiment: 0.5,
      virality: 92,
      url: 'https://tiktok.com/@crypto_edu/video/123',
    },
  ],
  news: [
    {
      id: 'news-1',
      source: 'bbc',
      headline: 'Bitcoin surges past $98,000 amid renewed investor optimism',
      summary: 'The cryptocurrency market sees strong gains as institutional investors return.',
      url: 'https://bbc.com/news/business-123',
      publishedAt: new Date(Date.now() - 1_800_000).toISOString(),
      keywords: ['bitcoin', 'crypto', 'investor', 'surge'],
      imageUrl: 'https://example.com/btc.jpg',
    },
    {
      id: 'news-2',
      source: 'cnn',
      headline: 'Federal Reserve hints at potential rate cut in early 2026',
      summary: 'Markets react to dovish Fed comments on inflation and employment.',
      url: 'https://cnn.com/business/fed-rate-cut',
      publishedAt: new Date(Date.now() - 3_600_000).toISOString(),
      keywords: ['fed', 'rate', 'cut', 'inflation'],
    },
    // 10 seekingalpha items so the health badge shows "fetched 10" (matches
    // MOCK_SNAPSHOT.sourceHealth.seekingalpha.itemCount = 10).
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `news-sa-${i}`,
      source: 'seekingalpha' as const,
      headline: `Seeking Alpha market analysis ${i + 1}`,
      summary: 'Analyst breakdown of the latest market moves.',
      url: `https://seekingalpha.com/article/${i + 1}`,
      publishedAt: new Date(Date.now() - (i + 1) * 60_000).toISOString(),
      keywords: ['market', 'analysis'],
    })),
  ],
};

export const MOCK_HISTORY = Array.from({ length: 24 }, (_, i) => ({
  timestamp: Date.now() - (24 - i) * 3_600_000,
  marketCount: 2 + (i % 5),
  signalCount: 3 + (i % 7),
  newsCount: 2 + (i % 4),
  correlationCount: 1 + (i % 6),
  topVirality: [85, 70, 55, 40, 30],
  avgSentiment: 0.2 + (i % 10) * 0.05,
  topMarkets: [
    {
      id: 'market-1',
      platform: 'polymarket',
      question: 'Will BTC close above $100k?',
      yesPrice: 0.65,
      volume24h: 1_500_000,
      url: 'https://polymarket.com/event/btc-100k',
    },
  ],
  topSignals: [
    {
      id: 'signal-1',
      platform: 'x',
      text: '$BTC to the moon!',
      author: 'crypto_whale',
      virality: 85,
      sentiment: 0.8,
      url: 'https://x.com/crypto_whale/status/123',
    },
  ],
  topNews: [
    {
      id: 'news-1',
      source: 'bbc',
      headline: 'Bitcoin surges past $98,000',
      url: 'https://bbc.com/news/business-123',
      publishedAt: new Date(Date.now() - 1_800_000).toISOString(),
    },
  ],
}));

export const MOCK_WATCHLIST = [
  {
    contractId: 'market-1',
    platform: 'polymarket',
    question: 'Will BTC close above $100k on Dec 31?',
    addedAt: Date.now() - 86_400_000,
  },
];

export const MOCK_CORRELATIONS = {
  matches: [
    {
      contract: MOCK_SNAPSHOT.markets[0],
      signal: MOCK_SNAPSHOT.signals[0],
      confidence: 0.82,
      matchedKeywords: ['btc', 'bitcoin'],
      correlatedAt: Date.now(),
    },
    {
      contract: MOCK_SNAPSHOT.markets[1],
      signal: MOCK_SNAPSHOT.signals[1],
      confidence: 0.71,
      matchedKeywords: ['fed', 'rate', 'cut'],
      correlatedAt: Date.now(),
    },
  ],
  newsMatches: [
    {
      contract: MOCK_SNAPSHOT.markets[0],
      news: MOCK_SNAPSHOT.news[0],
      confidence: 0.76,
      matchedKeywords: ['bitcoin', 'crypto'],
      correlatedAt: Date.now(),
    },
    {
      contract: MOCK_SNAPSHOT.markets[1],
      news: MOCK_SNAPSHOT.news[1],
      confidence: 0.69,
      matchedKeywords: ['fed', 'rate', 'cut'],
      correlatedAt: Date.now(),
    },
  ],
  newsSocialMatches: [
    {
      news: MOCK_SNAPSHOT.news[0],
      signal: MOCK_SNAPSHOT.signals[0],
      confidence: 0.65,
      matchedKeywords: ['bitcoin', 'btc'],
      correlatedAt: Date.now(),
    },
  ],
  engine: 'heuristic',
};

// ── Mock injection ────────────────────────────────────────────────

/**
 * Inject a mock WebExtension `browser` / `chrome` API into the page
 * before any app scripts run. The mock uses an in-memory store seeded
 * with the provided test data.
 *
 * Call this in `page.addInitScript()` or via `context.addInitScript()`.
 */
export function mockBrowserApiScript(
  overrides: Record<string, unknown> = {},
): string {
  const data = {
    'trendcast:settings': MOCK_SETTINGS,
    'trendcast:latest-snapshot': MOCK_SNAPSHOT,
    'trendcast:last-collection': Date.now() - 1_800_000,
    'trendcast:correlations': MOCK_CORRELATIONS,
    'trendcast:history': MOCK_HISTORY,
    'trendcast:watchlist': MOCK_WATCHLIST,
    ...overrides,
  };

  return `
(function() {
  // In-memory storage backing store
  var __store = ${JSON.stringify(data)};
  var __changeListeners = [];

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function notifyChange(key, oldValue, newValue) {
    var changes = {};
    changes[key] = { oldValue: oldValue, newValue: newValue };
    __changeListeners.forEach(function(fn) {
      try { fn(changes, 'local'); } catch(e) {}
    });
  }

  // ── storage.local ──────────────────────────────────────────
  var storageLocal = {
    get: function(keys) {
      return new Promise(function(resolve) {
        var result = {};
        if (keys === undefined || keys === null) {
          Object.keys(__store).forEach(function(k) {
            result[k] = deepClone(__store[k]);
          });
        } else if (typeof keys === 'string') {
          if (__store[keys] !== undefined) {
            result[keys] = deepClone(__store[keys]);
          }
        } else if (Array.isArray(keys)) {
          keys.forEach(function(k) {
            if (__store[k] !== undefined) {
              result[k] = deepClone(__store[k]);
            }
          });
        } else if (typeof keys === 'object') {
          Object.keys(keys).forEach(function(k) {
            if (__store[k] !== undefined) {
              result[k] = deepClone(__store[k]);
            } else {
              result[k] = deepClone(keys[k]);
            }
          });
        }
        resolve(result);
      });
    },
    set: function(items) {
      return new Promise(function(resolve) {
        Object.keys(items).forEach(function(k) {
          var oldValue = __store[k];
          __store[k] = deepClone(items[k]);
          notifyChange(k, oldValue, __store[k]);
        });
        resolve();
      });
    },
    remove: function(keys) {
      return new Promise(function(resolve) {
        var arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach(function(k) {
          var oldValue = __store[k];
          delete __store[k];
          notifyChange(k, oldValue, undefined);
        });
        resolve();
      });
    },
    getBytesInUse: function() {
      return new Promise(function(resolve) {
        var bytes = JSON.stringify(__store).length;
        resolve(bytes);
      });
    },
  };

  var storageOnChanged = {
    addListener: function(fn) { __changeListeners.push(fn); },
    removeListener: function(fn) {
      __changeListeners = __changeListeners.filter(function(f) { return f !== fn; });
    },
    hasListener: function(fn) { return __changeListeners.indexOf(fn) >= 0; },
  };

  // ── Message handlers ───────────────────────────────────────
  // Canned responses for known message types.
  var __messageHandlers = [];

  var cannedResponses = {
    'TRIGGER_COLLECTION': { ok: true, data: { snapshot: ${JSON.stringify(MOCK_SNAPSHOT)} } },
    'GET_LATEST_SNAPSHOT': { ok: true, data: { snapshot: ${JSON.stringify(MOCK_SNAPSHOT)} } },
    'GET_HISTORY': { ok: true, data: { history: __store['trendcast:history'] || [] } },
    'GET_WATCHLIST': { ok: true, data: { watchlist: __store['trendcast:watchlist'] || [] } },
    'ADD_TO_WATCHLIST': { ok: true },
    'REMOVE_FROM_WATCHLIST': { ok: true },
    'EXPORT_DATA': { ok: true, data: { data: 'collectedAt,markets,signals\\n' + Date.now() + ',2,3', filename: 'trendcast-export.csv' } },
    'GET_STORAGE_USAGE': { ok: true, data: { usage: { totalBytes: 1048576, perKey: { 'trendcast:latest-snapshot': 512000 } } } },
    'CORRELATE_ALL': { ok: true, data: ${JSON.stringify(MOCK_CORRELATIONS)} },
    'CANCEL_CORRELATION': { ok: true, data: { cancelled: true } },
  };

  var runtimeSendMessage = function(msg) {
    return new Promise(function(resolve, reject) {
      var type = msg && msg.type;
      // Check custom handlers first
      for (var i = 0; i < __messageHandlers.length; i++) {
        var handler = __messageHandlers[i];
        var result = handler(msg);
        if (result !== undefined) {
          resolve(result);
          return;
        }
      }
      // Fall back to canned responses
      if (cannedResponses[type]) {
        resolve(deepClone(cannedResponses[type]));
      } else {
        resolve({ ok: true });
      }
    });
  };

  var runtimeOnMessage = {
    addListener: function(fn) { __messageHandlers.push(fn); },
    removeListener: function(fn) {
      __messageHandlers = __messageHandlers.filter(function(f) { return f !== fn; });
    },
  };

  // ── tabs ───────────────────────────────────────────────────
  var tabs = {
    create: function(props) {
      return new Promise(function(resolve) {
        resolve({ id: 999, url: props && props.url });
      });
    },
    query: function() {
      return new Promise(function(resolve) { resolve([]); });
    },
    sendMessage: function() {
      return new Promise(function(resolve) { resolve({}); });
    },
  };

  // ── alarms ─────────────────────────────────────────────────
  var alarms = {
    create: function() {},
    clear: function() { return new Promise(function(r) { r(true); }); },
    onAlarm: { addListener: function() {}, removeListener: function() {} },
  };

  // ── Build the browser object ───────────────────────────────
  var browser = {
    storage: {
      local: storageLocal,
      onChanged: storageOnChanged,
    },
    runtime: {
      sendMessage: runtimeSendMessage,
      onMessage: runtimeOnMessage,
      getURL: function(path) { return 'chrome-extension://fake-id/' + path; },
      id: 'fake-extension-id',
      lastError: null,
    },
    tabs: tabs,
    alarms: alarms,
  };

  // webextension-polyfill exports default; we need to make it available
  // as both a default export and a named export.
  // The polyfill checks for globalThis.browser or globalThis.chrome.
  // We set both so the polyfill picks it up.
  globalThis.browser = browser;
  globalThis.chrome = browser;

  // Also intercept the ES module import of 'webextension-polyfill'.
  // Since the app is bundled by Vite, the polyfill is inlined.
  // The polyfill does: if (typeof chrome !== 'undefined') { use chrome }
  // So setting globalThis.chrome is sufficient.
})();`;
}

/**
 * Inject the mock browser API into a Playwright page before app scripts.
 */
export async function injectBrowserMock(
  page: Page,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await page.addInitScript(mockBrowserApiScript(overrides));
}