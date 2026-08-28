/**
 * Background service worker — the orchestrator.
 *
 * ── Client-side architecture ──────────────────────────────────────
 * No API keys. The background worker:
 *   1. Runs hourly collection via `chrome.alarms` (survives worker restarts).
 *   2. Calls public endpoints directly via `fetch()` (Polymarket Gamma,
 *      Kalshi v2, Reddit .json, BBC/CNN RSS) — host_permissions allow this.
 *   3. Receives DOM-scraped data from content scripts via messages.
 *   4. Stores collected data as a CollectionSnapshot in chrome.storage.local.
 *   5. Runs the correlation engine on demand (CORRELATE_ALL).
 *   6. The new tab dashboard reads the snapshot from storage.
 *
 * ── MV3 Service Worker Lifecycle ─────────────────────────────────
 * ⚠️ The service worker is EPHEMERAL. Chrome will terminate it after
 *    ~30 seconds of inactivity. This means:
 *
 *    1. NEVER use `setInterval` for long-running polling — it will be
 *       killed. Use `chrome.alarms` instead (survives worker restarts).
 *
 *    2. NEVER store state in module-level variables and expect it to
 *       persist. Always use `chrome.storage.local` for durable state.
 *
 *    3. The worker restarts on any message or event. Register all
 *       listeners synchronously at the top level (not inside async functions).
 *
 * Reference: https://developer.chrome.com/docs/extensions/mv3/service_workers/
 */

import { browser } from '@/messaging/browser';
import { onMessage } from '@/messaging';
import { CONFIG } from '@/config';
import type {
  CollectionSnapshot,
  CorrelationMatch,
  CorrelationResult,
  ExtensionSettings,
  HistoryEntry,
  MarketContract,
  NewsCorrelationMatch,
  NewsItem,
  SocialSignal,
  SocialSourceHealth,
  SourceHealth,
  WatchlistEntry,
} from '@/types';
import { DEFAULT_SETTINGS } from '@/types';
import { mergeSocialHealth } from '@/utils/source-health';
import { collectPolymarketMarkets, collectKalshiMarkets, collectRedditSignals, collectXTrends, collectTikTokTrends, collectNews } from '@/services/collectors';
import { correlate, correlateNews, correlateNewsSocial, correlateNewsNews } from '@/services/engine/correlation';
import { exportToCsv, exportToJson } from '@/utils/export';
import { pruneStorageIfNeeded, measureStorageUsage } from '@/utils/storage';
import { backfillWatchlist } from '@/utils/watchlist';
import { getSettingsFromStorage, migrateEnabledSourcesFromStorage } from '@/utils/settings';
import { evaluateAlerts, evaluateCrossSourceAlerts, dispatchAlerts, broadcastAlerts, clearAlerts, updateBadge, getAlertHistory } from '@/background/alerts';
import { buildMarketDrivenNews } from '@/background/correlationNews';
import { mergeMarkets, mergeSignals, mergeNews } from '@/background/merge';

// Vite worker import — bundles ml-worker.ts as a separate chunk.
// The `?worker` suffix tells Vite to compile this as a Web Worker.
// At runtime, MLWorker is a Worker constructor.
import MLWorker from '@/workers/ml-worker?worker';

// ── Register all listeners synchronously at top level ────────────
setupAlarms();
setupMessageHandlers();
setupInstallHandler();

// Build-time version stamp injected by Vite's define.
// Format: "0.1.0+2026-08-14T13:21:00Z"
const BUILD_VERSION = import.meta.env.BUILD_VERSION ?? 'dev';

console.log(
  `[TrendCast] Background worker initialised — v${BUILD_VERSION} at ${new Date().toISOString()}`,
);

// ── ML Web Worker manager ─────────────────────────────────────────
// The ML worker runs embedding/sentiment inference off the main thread
// to prevent Firefox's "Stop the script" dialog and keep the extension
// responsive. The worker is created on demand and terminated when idle.

let mlWorker: Worker | null = null;
let mlWorkerRequestId: string | null = null;
let mlWorkerResolvers: {
  resolve: (result: CorrelationResult) => void;
  reject: (error: Error) => void;
  onProgress?: (info: { phase: string; current: number; total: number; engine: string; model: string }) => void;
} | null = null;
let mlWorkerTimeout: ReturnType<typeof setTimeout> | null = null;

const ML_WORKER_IDLE_TIMEOUT_MS = 300_000; // 5 min — LLM inference is very slow on WASM CPU

/**
 * Get or create the ML Web Worker.
 * Uses Vite's `?worker` import which bundles the worker as a separate chunk
 * and provides a Worker constructor at runtime.
 */
function getMLWorker(): Worker | null {
  if (mlWorker) {
    return mlWorker;
  }

  try {
    console.log('[TrendCast] Creating ML Web Worker');
    mlWorker = new MLWorker();

    mlWorker.addEventListener('message', (e: MessageEvent) => {
      const msg = e.data;

      if (!mlWorkerResolvers) {
        console.warn('[TrendCast] ML worker message but no resolver:', msg);
        return;
      }

      if (msg.type === 'progress') {
        // Reset idle timer on progress — LLM inference can take many minutes.
        // Without this, the 60s idle timer kills the worker mid-computation.
        resetWorkerIdleTimer();
        mlWorkerResolvers.onProgress?.({
          phase: msg.phase,
          current: msg.current,
          total: msg.total,
          engine: msg.engine,
          model: msg.model,
        });
      } else if (msg.type === 'result') {
        console.log('[TrendCast] ML worker result received');
        mlWorkerResolvers.resolve(msg.result as CorrelationResult);
        resetWorkerIdleTimer();
      } else if (msg.type === 'error') {
        console.error('[TrendCast] ML worker error:', msg.error);
        mlWorkerResolvers.reject(new Error(msg.error));
        resetWorkerIdleTimer();
      }
    });

    mlWorker.addEventListener('error', (e: ErrorEvent) => {
      console.error('[TrendCast] ML worker error event:', e.message, e);
      if (mlWorkerResolvers) {
        mlWorkerResolvers.reject(new Error(`ML Worker error: ${e.message}`));
      }
      terminateMLWorker();
    });

    return mlWorker;
  } catch (err) {
    console.error('[TrendCast] Failed to create ML Web Worker:', err);
    return null;
  }
}

function terminateMLWorker(): void {
  if (mlWorker) {
    console.log('[TrendCast] Terminating ML Web Worker');
    mlWorker.terminate();
    mlWorker = null;
  }
  if (mlWorkerTimeout) {
    clearTimeout(mlWorkerTimeout);
    mlWorkerTimeout = null;
  }
  mlWorkerResolvers = null;
  mlWorkerRequestId = null;
}

function resetWorkerIdleTimer(): void {
  if (mlWorkerTimeout) clearTimeout(mlWorkerTimeout);
  mlWorkerTimeout = setTimeout(() => {
    console.log('[TrendCast] ML worker idle — terminating');
    terminateMLWorker();
  }, ML_WORKER_IDLE_TIMEOUT_MS);
}

/**
 * Run ML correlation in the Web Worker.
 * Falls back to inline execution if the worker can't be created.
 */
async function runMLCorrelation(
  markets: MarketContract[],
  signals: SocialSignal[],
  news: NewsItem[],
  engine: 'embedding' | 'sentiment' | 'zeroshot' | 'ner' | 'llm',
  model: string,
  requestId: string,
  onProgress?: (info: { phase: string; current: number; total: number; engine: string; model: string }) => void,
): Promise<CorrelationResult> {
  const worker = getMLWorker();

  if (!worker) {
    console.warn('[TrendCast] ML Worker unavailable — falling back to inline execution');
    // Fallback: import and run inline (will block main thread, but at least works)
    const ml = await import('@/services/engine/ml');
    if (engine === 'embedding') {
      const all = await ml.correlateAllEmbedding(signals, markets, news, model as never, onProgress as never);
      return { matches: all.matches, newsMatches: all.newsMatches, newsSocialMatches: all.newsSocialMatches, newsNewsMatches: all.newsNewsMatches, engine };
    } else if (engine === 'sentiment') {
      const all = await ml.correlateAllSentiment(signals, markets, news, model as never, onProgress as never);
      return { matches: all.matches, newsMatches: all.newsMatches, newsSocialMatches: all.newsSocialMatches, newsNewsMatches: [], engine };
    } else if (engine === 'zeroshot') {
      const all = await ml.correlateAllZeroShot(signals, markets, news, model as never, onProgress as never);
      return { matches: all.matches, newsMatches: all.newsMatches, newsSocialMatches: all.newsSocialMatches, newsNewsMatches: [], engine };
    } else if (engine === 'ner') {
      const all = await ml.correlateAllNER(signals, markets, news, model as never, onProgress as never);
      return { matches: all.matches, newsMatches: all.newsMatches, newsSocialMatches: all.newsSocialMatches, newsNewsMatches: [], engine };
    } else {
      // llm
      const matches = await ml.correlateLLM(signals, markets, model as never, onProgress as never);
      const newsMatches = await ml.correlateNewsLLM(news, markets, model as never, onProgress as never);
      const newsSocialMatches = await ml.correlateNewsSocialLLM(news, signals, model as never, onProgress as never);
      return { matches, newsMatches, newsSocialMatches, newsNewsMatches: [], engine };
    }
  }

  return new Promise<CorrelationResult>((resolve, reject) => {
    mlWorkerRequestId = requestId;
    mlWorkerResolvers = { resolve, reject, onProgress };

    worker.postMessage({
      type: 'correlate',
      requestId,
      engine,
      model,
      markets,
      signals,
      news,
    });
  });
}

/**
 * Cancel a running ML correlation.
 */
function cancelMLCorrelation(): void {
  if (mlWorker && mlWorkerRequestId) {
    console.log('[TrendCast] Cancelling ML correlation:', mlWorkerRequestId);
    // Terminate the worker to immediately stop inference
    terminateMLWorker();
  }
}

// ── Alarm setup ──────────────────────────────────────────────────

function setupAlarms(): void {
  browser.alarms.create(CONFIG.collection.alarmName, {
    periodInMinutes: CONFIG.collection.defaultIntervalMinutes,
  });

  // Phase 4: alert-sweep alarm — periodically re-evaluates the last stored
  // correlation result against the watchlist so alerts fire even when no
  // new collection/correlation has run (e.g. price drift on a watchlisted
  // market). Runs on a shorter cadence than the collection alarm.
  browser.alarms.create(CONFIG.alerts.alarmName, {
    periodInMinutes: CONFIG.alerts.sweepIntervalMinutes,
  });

  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === CONFIG.collection.alarmName) {
      console.log('[TrendCast] Alarm fired — starting hourly collection');
      await runCollection();
      return;
    }

    if (alarm.name === CONFIG.alerts.alarmName) {
      console.log('[TrendCast] Alert-sweep alarm fired');
      await runAlertSweep();
    }
  });
}

/**
 * Re-evaluate the last stored correlation result against the watchlist.
 * Used by the alert-sweep alarm and after each correlation completes.
 */
async function runAlertSweep(): Promise<void> {
  try {
    const stored = await browser.storage.local.get(CONFIG.storage.correlations);
    const result = stored[CONFIG.storage.correlations] as CorrelationResult | undefined;
    if (!result) return;

    const [watchlist, settings] = await Promise.all([getWatchlist(), getSettings()]);
    const newAlerts = await evaluateAlerts(result, watchlist, settings);
    const crossSourceAlerts = await evaluateCrossSourceAlerts(result, settings);
    const allAlerts = [...newAlerts, ...crossSourceAlerts];
    if (allAlerts.length > 0) {
      await dispatchAlerts(allAlerts);
      await broadcastAlerts(await getAlertHistory());
    }
    await updateBadge();
  } catch (err) {
    console.error('[TrendCast] Alert sweep failed:', err);
  }
}

/**
 * Rebuild the derived "market-driven news" snapshot (Phase 5) after a
 * correlation completes. Reads existing markets + news + watchlist + the
 * stored correlation result, derives a bounded, category-grouped view, and
 * writes it to `CONFIG.storage.marketNewsView`. Read-only projection — no
 * new collection.
 */
async function rebuildMarketNewsView(): Promise<void> {
  try {
    const stored = await browser.storage.local.get(CONFIG.storage.correlations);
    const result = stored[CONFIG.storage.correlations] as CorrelationResult | undefined;
    if (!result) return;

    const [watchlist] = await Promise.all([getWatchlist()]);
    const view = buildMarketDrivenNews(
      result.newsMatches,
      watchlist,
      CONFIG.marketNews.minVolume,
      CONFIG.marketNews.capPerCategory,
    );
    await browser.storage.local.set({ [CONFIG.storage.marketNewsView]: view });
  } catch (err) {
    console.error('[TrendCast] rebuildMarketNewsView failed:', err);
  }
}

// ── Message handlers ─────────────────────────────────────────────

function setupMessageHandlers(): void {
  // Content script → Background: report scraped market data from DOM
  onMessage('REPORT_MARKET_DATA', async (payload) => {
    const existing = await getCollectedMarkets();
    const merged = mergeMarkets(existing, payload.markets);
    await browser.storage.local.set({ [CONFIG.storage.collectedMarkets]: merged });
    console.log(`[TrendCast] Stored ${payload.markets.length} markets from content script`);
  });

  // Content script → Background: report scraped social signals from DOM
  onMessage('REPORT_SOCIAL_DATA', async (payload) => {
    const existing = await getCollectedSignals();
    const merged = mergeSignals(existing, payload.signals);
    await browser.storage.local.set({ [CONFIG.storage.collectedSignals]: merged });
    console.log(`[TrendCast] Stored ${payload.signals.length} social signals from content script`);
  });

  // Content script → Background: report scraped news headlines from DOM
  onMessage('REPORT_NEWS_DATA', async (payload) => {
    const existing = await getCollectedNews();
    const merged = mergeNews(existing, payload.news);
    await browser.storage.local.set({ [CONFIG.storage.collectedNews]: merged });
    console.log(`[TrendCast] Stored ${payload.news.length} news items from content script`);
  });

  // Content script → Background: report social-source health (Phase 7, D-02)
  onMessage('REPORT_SOCIAL_HEALTH', async (payload) => {
    try {
      const key = CONFIG.storage.socialSourceHealth;
      const stored = await browser.storage.local.get(key);
      const existing = (stored[key] ?? {}) as SocialSourceHealth;
      const merged = mergeSocialHealth(existing, payload.platform, payload.entry);
      await browser.storage.local.set({ [key]: merged });
    } catch (err) {
      // Isolate failures so a health-write error never breaks the handler.
      console.warn('[TrendCast] Failed to store social-source health:', err);
    }
  });

  // Popup / Dashboard → Background: trigger manual collection
  onMessage('TRIGGER_COLLECTION', async () => {
    console.log('[TrendCast] Manual collection triggered');
    const snapshot = await runCollection();
    return snapshot;
  });

  // Popup / Dashboard → Background: get latest snapshot
  onMessage('GET_LATEST_SNAPSHOT', async () => {
    return await getLatestSnapshot();
  });

  // Dashboard → Background: correlate all collected data
  // ⚠️ This handler is fire-and-forget: it starts the correlation in the
  // background and returns immediately with { started: true }. The result
  // is delivered via storage + CORRELATION_RESULT message. This avoids
  // Firefox's "Promised response went out of scope" timeout that kills
  // long-running async handlers (especially LLM model downloads).
  onMessage('CORRELATE_ALL', async (payload) => {
    console.log('[TrendCast] CORRELATE_ALL received:', {
      engine: payload.engine,
      model: payload.model,
      requestId: payload.requestId,
    });

    const settings = await getSettings();
    const engine = payload.engine ?? settings.correlationEngine;
    const model = payload.model ?? (
      engine === 'embedding' ? settings.embeddingModel
      : engine === 'sentiment' ? settings.sentimentModel
      : engine === 'zeroshot' ? settings.zeroShotModel
      : engine === 'ner' ? settings.nerModel
      : engine === 'llm' ? settings.llmModel
      : settings.embeddingModel
    );
    const requestId = payload.requestId ?? `corr-${Date.now()}`;

    console.log(`[TrendCast] CORRELATE_ALL using engine="${engine}", model="${model}", requestId="${requestId}"`);

    // Fire-and-forget: start the correlation without awaiting it.
    // The result will be written to storage and broadcast via
    // CORRELATION_RESULT message when done.
    runCorrelationAsync(engine, model, requestId);

    // Return immediately so Firefox doesn't kill the message channel
    return { started: true, requestId };
  });

  // Dashboard → Background: cancel a running ML correlation
  onMessage('CANCEL_CORRELATION', async () => {
    console.log('[TrendCast] CANCEL_CORRELATION received');
    cancelMLCorrelation();
    return { cancelled: true };
  });

  // Dashboard → Background: get historical snapshots for charting
  onMessage('GET_HISTORY', async (payload) => {
    const limit = payload.limit ?? 168;
    const history = await getHistory(limit);
    return { history };
  });

  // Dashboard → Background: add market to watchlist
  onMessage('ADD_TO_WATCHLIST', async (payload) => {
    const watchlist = await getWatchlist();
    const filtered = watchlist.filter((w) => w.contractId !== payload.entry.contractId);
    filtered.push(payload.entry);
    await browser.storage.local.set({ [CONFIG.storage.watchlist]: filtered });
    console.log(`[TrendCast] Added to watchlist: ${payload.entry.contractId}`);
    return { watchlist: filtered };
  });

  // Dashboard → Background: remove market from watchlist
  onMessage('REMOVE_FROM_WATCHLIST', async (payload) => {
    const watchlist = await getWatchlist();
    const filtered = watchlist.filter((w) => w.contractId !== payload.contractId);
    await browser.storage.local.set({ [CONFIG.storage.watchlist]: filtered });
    console.log(`[TrendCast] Removed from watchlist: ${payload.contractId}`);
    return { watchlist: filtered };
  });

  // Dashboard → Background: get watchlist
  onMessage('GET_WATCHLIST', async () => {
    const watchlist = await getWatchlist();
    return { watchlist };
  });

  // Dashboard → Background: export collected data
  onMessage('EXPORT_DATA', async (payload) => {
    const markets = await getCollectedMarkets();
    const signals = await getCollectedSignals();
    const news = await getCollectedNews();
    const correlationsResult = await browser.storage.local.get(CONFIG.storage.correlations);
    const correlations = (correlationsResult[CONFIG.storage.correlations] as {
      matches: CorrelationMatch[];
      newsMatches: NewsCorrelationMatch[];
    }) ?? { matches: [], newsMatches: [] };

    if (payload.format === 'csv') {
      const data = exportToCsv({ markets, signals, news, correlations });
      return { data, filename: `trendcast-${Date.now()}.csv` };
    } else {
      const data = exportToJson({ markets, signals, news, correlations });
      return { data, filename: `trendcast-${Date.now()}.json` };
    }
  });

  // Dashboard / Popup → Background: get storage usage stats (Phase 4)
  onMessage('GET_STORAGE_USAGE', async () => {
    const usage = await measureStorageUsage();
    return { usage };
  });

  // Dashboard → Background: clear all alerts (Phase 4)
  onMessage('CLEAR_ALERTS', async () => {
    await clearAlerts();
    return { cleared: true };
  });
}

// ── Install / update handler ─────────────────────────────────────

function setupInstallHandler(): void {
  browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
      console.log('[TrendCast] First install — seeding default settings');
      await browser.storage.local.set({
        [CONFIG.storage.settings]: DEFAULT_SETTINGS,
      });
    } else if (details.reason === 'update') {
      // Migration: TikTok is now collected automatically (like Reddit/X) and
      // should be on by default. Existing users who had it disabled (the old
      // opt-in default) get it flipped to true so "Collect now" brings TikTok.
      await migrateTikTokDefault();
      // Migration: backfill any missing news source flags (e.g. seekingalpha/
      // investing/googleFinance) into persisted settings so the deep-merge fix
      // survives restarts. Silent and idempotent — never overwrites a preference.
      await migrateEnabledSourcesDefault();
    }

    // Always re-register alarms on install/update.
    browser.alarms.create(CONFIG.collection.alarmName, {
      periodInMinutes: CONFIG.collection.defaultIntervalMinutes,
    });
  });

  // Phase 4: clicking an alert notification opens the dashboard.
  browser.notifications.onClicked.addListener((notificationId) => {
    if (!notificationId.startsWith('trendcast-alert-')) return;
    browser.tabs.create({ url: browser.runtime.getURL('dashboard/index.html') }).catch((err) => {
      console.error('[TrendCast] Failed to open dashboard from notification:', err);
    });
  });
}

// ── Collection logic ─────────────────────────────────────────────

/**
 * Run a full collection cycle from all enabled sources.
 * Fetches data via public endpoints (no API keys), stores a snapshot,
 * and returns it.
 */
async function runCollection(): Promise<CollectionSnapshot> {
  const settings = await getSettings();
  const enabled = settings.enabledSources;

  console.log('[TrendCast] ━━ Collection started ━━');

  const tasks: Promise<unknown>[] = [];

  // Markets
  if (enabled.polymarket) {
    tasks.push(
      collectPolymarketMarkets()
        .then((markets) => storeMarkets(markets))
        .catch((err) => console.error('[TrendCast] ❌ Polymarket failed:', err)),
    );
  }

  if (enabled.kalshi) {
    tasks.push(
      collectKalshiMarkets()
        .then((markets) => storeMarkets(markets))
        .catch((err) => console.error('[TrendCast] ❌ Kalshi failed:', err)),
    );
  }

  // Social signals
  if (enabled.reddit) {
    tasks.push(
      collectRedditSignals(settings.redditSubreddits)
        .then((signals) => storeSignals(signals))
        .catch((err) => console.error('[TrendCast] ❌ Reddit failed:', err)),
    );
  }

  if (enabled.x) {
    tasks.push(
      collectXTrends()
        .then((signals) => storeSignals(signals))
        .catch((err) => console.error('[TrendCast] ❌ X/Trends failed:', err)),
    );
  }

  // TikTok — background fetch of the discover page's embedded SSR data
  // (host_permissions allow the worker to fetch TikTok directly, no tab).
  // Isolated so a TikTok failure never degrades other sources.
  if (enabled.tiktok) {
    tasks.push(
      collectTikTokTrends()
        .then((signals) => storeSignals(signals))
        .catch((err) => console.error('[TrendCast] ❌ TikTok failed:', err)),
    );
  }

  // News (BBC, CNN, Yahoo Finance, Google News finance, Seeking Alpha, Investing.com,
  // plus the stock-indicator feeds: usaStocksIndicator, stockScreener, stockScreener2)
  const newsSources: Array<'bbc' | 'cnn' | 'yahoo' | 'googleFinance' | 'seekingalpha' | 'investing' | 'usaStocksIndicator' | 'stockScreener' | 'stockScreener2'> = [];
  if (enabled.bbc) newsSources.push('bbc');
  if (enabled.cnn) newsSources.push('cnn');
  if (enabled.yahoo) newsSources.push('yahoo');
  if (enabled.googleFinance) newsSources.push('googleFinance');
  if (enabled.seekingalpha) newsSources.push('seekingalpha');
  if (enabled.investing) newsSources.push('investing');
  if (enabled.usaStocksIndicator) newsSources.push('usaStocksIndicator');
  if (enabled.stockScreener) newsSources.push('stockScreener');
  if (enabled.stockScreener2) newsSources.push('stockScreener2');
  let newsHealth: SourceHealth = {};
  if (newsSources.length > 0) {
    const prevSnapshot = await getLatestSnapshot();
    tasks.push(
      collectNews(newsSources, prevSnapshot?.sourceHealth ?? {})
        .then(({ news, health }) => {
          newsHealth = health;
          return storeNews(news);
        })
        .catch((err) => console.error('[TrendCast] ❌ News failed:', err)),
    );
  }

  // TikTok requires content script scraping (no public fetch endpoint).
  // It will report data via REPORT_SOCIAL_DATA when the user visits the site.

  await Promise.allSettled(tasks);

  // Build and store the snapshot.
  const markets = await getCollectedMarkets();
  const signals = await getCollectedSignals();
  const news = await getCollectedNews();

  const snapshot: CollectionSnapshot = {
    collectedAt: Date.now(),
    markets,
    signals,
    news,
    sourceHealth: newsHealth,
  };

  await browser.storage.local.set({
    [CONFIG.storage.latestSnapshot]: snapshot,
    [CONFIG.storage.lastCollectionAt]: snapshot.collectedAt,
  });

  // Save a compact history entry for charting.
  await appendHistoryEntry(snapshot, settings.maxHistoryEntries);

  // Phase 4: Prune storage if over budget (keeps chrome.storage.local
  // within the ~7 MB soft budget to avoid QUOTA errors).
  await pruneStorageIfNeeded();

  console.log(
    `[TrendCast] ━━ Collection complete: ${markets.length} markets, ${signals.length} signals, ${news.length} news ━━`,
  );

  // Pre-compute correlations in the background so the dashboard
  // can display them instantly when the user opens the Correlations tab.
  // This runs after collection completes, leveraging the time before the
  // user navigates to the correlations tab.
  runCorrelationPrecompute(markets, signals, news, settings).catch((err) =>
    console.error('[TrendCast] Pre-compute correlations failed:', err),
  );

  return snapshot;
}

/**
 * Run correlation with the specified engine and model.
 *
 * If the ML engine fails (e.g., WASM backend unavailable, model download
 * blocked), the result will contain an `error` message and `engine` set
 * to 'heuristic' with empty result arrays — we do NOT silently fall back
 * to heuristic. The UI is responsible for showing the error to the user
 * and suggesting they switch engines.
 */

/**
 * Fire-and-forget correlation runner.
 * Starts the correlation in the background and delivers the result via
 * storage + CORRELATION_RESULT message. This avoids Firefox's message
 * channel timeout for long-running ML operations (especially LLMs).
 */
async function runCorrelationAsync(
  engine: 'heuristic' | 'embedding' | 'sentiment' | 'zeroshot' | 'ner' | 'llm',
  model: string,
  requestId: string,
): Promise<void> {
  try {
    const markets = await getCollectedMarkets();
    const signals = await getCollectedSignals();
    const news = await getCollectedNews();

    console.log('[TrendCast] runCorrelationAsync data:', {
      markets: markets.length,
      signals: signals.length,
      news: news.length,
    });

    const result = await runCorrelationWithEngine(markets, signals, news, engine, model, requestId);

    // Ensure requestId is preserved in the result for the UI
    if (result && !result.requestId) {
      result.requestId = requestId;
    }

    await browser.storage.local.set({ [CONFIG.storage.correlations]: result });

    // Broadcast the result to any listening dashboard/popup tabs
    console.log('[TrendCast] Broadcasting CORRELATION_RESULT:', {
      requestId: result.requestId,
      matches: result.matches.length,
    });
    browser.runtime.sendMessage({
      type: 'CORRELATION_RESULT',
      payload: result,
    }).catch((err) => {
      console.error('[TrendCast] CORRELATION_RESULT sendMessage failed:', err);
    });

    // Phase 4: evaluate the fresh result against the watchlist and dispatch
    // any new alerts (badge fallback if notifications are denied).
    await runAlertSweep();

    // Phase 5: rebuild the derived market-driven news snapshot.
    await rebuildMarketNewsView();

    if (result.error) {
      console.error(
        `[TrendCast] CORRELATE_ALL FAILED — engine="${engine}", model="${model}":`,
        result.error,
      );
    } else {
      console.log(
        `[TrendCast] CORRELATE_ALL OK — engine="${engine}", model="${model}":`,
        `${result.matches.length} signal→market, ${result.newsMatches.length} news→market, ${result.newsSocialMatches.length} news→social, ${result.newsNewsMatches.length} news↔news`,
      );
    }
  } catch (err) {
    console.error(`[TrendCast] runCorrelationAsync FAILED:`, err);
    const errorResult: CorrelationResult = {
      matches: [],
      newsMatches: [],
      newsSocialMatches: [],
      newsNewsMatches: [],
      engine,
      error: err instanceof Error ? err.message : String(err),
    };
    await browser.storage.local.set({ [CONFIG.storage.correlations]: errorResult });
    browser.runtime.sendMessage({
      type: 'CORRELATION_RESULT',
      payload: errorResult,
    }).catch(() => {});
  }
}

/** Wall-clock timestamp (HH:MM:SS.mmm) for log lines. */
function logTime(): string {
  return new Date().toISOString().slice(11, 23);
}

async function runCorrelationWithEngine(
  markets: MarketContract[],
  signals: SocialSignal[],
  news: NewsItem[],
  engine: 'heuristic' | 'embedding' | 'sentiment' | 'zeroshot' | 'ner' | 'llm',
  model: string,
  requestId?: string,
): Promise<CorrelationResult> {
  const runStart = performance.now();
  console.log(
    `[TrendCast ${logTime()}] runCorrelationWithEngine: engine="${engine}", model="${model}",`,
    `inputs: ${markets.length} markets, ${signals.length} signals, ${news.length} news`,
  );

  if (engine === 'embedding' || engine === 'sentiment' || engine === 'zeroshot' || engine === 'ner' || engine === 'llm') {
    try {
      // Progress callback — forwards progress to the dashboard via runtime message
      let lastProgressAt = runStart;
      const onProgress = (info: { phase: string; current: number; total: number; engine: string; model: string }) => {
        const now = performance.now();
        const sinceLast = (now - lastProgressAt) / 1000;
        const elapsed = (now - runStart) / 1000;
        lastProgressAt = now;
        console.debug(
          `[TrendCast ${logTime()}] Progress: ${info.phase} ${info.current}/${info.total} ` +
          `(${info.engine}/${info.model}) +${sinceLast.toFixed(1)}s, elapsed ${elapsed.toFixed(1)}s`,
        );
        // Broadcast progress to any listening dashboard/popup tabs
        browser.runtime.sendMessage({
          type: 'CORRELATION_PROGRESS',
          payload: {
            requestId: requestId ?? 'unknown',
            phase: info.phase,
            current: info.current,
            total: info.total,
            engine: info.engine,
            model: info.model,
          },
        }).catch(() => {
          // No listener — that's fine, progress is optional
        });
      };

      console.log(`[TrendCast] ${engine} engine: delegating to ML Web Worker…`);
      const result = await runMLCorrelation(
        markets, signals, news, engine, model, requestId ?? `corr-${Date.now()}`, onProgress,
      );
      const totalSecs = ((performance.now() - runStart) / 1000).toFixed(1);
      console.log(`[TrendCast ${logTime()}] ${engine}: signal→market = ${result.matches.length} (total ${totalSecs}s)`);
      console.log(`[TrendCast ${logTime()}] ${engine}: news→market = ${result.newsMatches.length} (total ${totalSecs}s)`);
      console.log(`[TrendCast ${logTime()}] ${engine}: news→social = ${result.newsSocialMatches.length} (total ${totalSecs}s)`);
      console.log(`[TrendCast ${logTime()}] ${engine}: news↔news = ${result.newsNewsMatches.length} (total ${totalSecs}s)`);
      return result;
    } catch (err) {
      const errorMsg = formatMLError(err, engine, model);
      console.error(`[TrendCast] ${engine} engine FAILED — model="${model}":`, err);
      console.error(`[TrendCast] ${engine} engine error message:`, errorMsg);
      return { matches: [], newsMatches: [], newsSocialMatches: [], newsNewsMatches: [], engine, error: errorMsg };
    }
  }

  // Heuristic (default) — runs inline (fast, no ML)
  console.log('[TrendCast] Heuristic engine: computing correlations…');
  const matches = correlate(signals, markets);
  console.log(`[TrendCast] Heuristic: signal→market = ${matches.length}`);
  const newsMatches = correlateNews(news, markets);
  console.log(`[TrendCast] Heuristic: news→market = ${newsMatches.length}`);
  const newsSocialMatches = correlateNewsSocial(news, signals);
  console.log(`[TrendCast] Heuristic: news→social = ${newsSocialMatches.length}`);
  const newsNewsMatches = correlateNewsNews(news);
  console.log(`[TrendCast] Heuristic: news↔news = ${newsNewsMatches.length}`);
  return { matches, newsMatches, newsSocialMatches, newsNewsMatches, engine };
}

/**
 * Format an ML engine error into a user-friendly message.
 * Extracts the root cause from common ONNX Runtime / Transformers.js errors.
 */
function formatMLError(err: unknown, engine: string, model: string): string {
  const raw = err instanceof Error ? err.message : String(err);

  // Detect common failure patterns and give actionable advice
  if (raw.includes('no available backend found') || raw.includes('wasm')) {
    return `The ML runtime (ONNX WebAssembly) failed to load. This is usually caused by the browser blocking the WASM backend or a network issue downloading model files. Try switching to the 🧮 Heuristic engine, or try a different ${engine} model.`;
  }

  if (raw.includes('dynamically imported module') || raw.includes('Failed to fetch')) {
    return `Failed to load the ML model "${model}". The browser may have blocked the download from the Hugging Face CDN. Check your network connection, try a different ${engine} model, or switch to the 🧮 Heuristic engine which requires no downloads.`;
  }

  if (raw.includes('network') || raw.includes('CORS') || raw.includes('403') || raw.includes('404')) {
    return `Network error loading ML model "${model}". The Hugging Face CDN may be unreachable or blocked. Try again later, choose a different model, or switch to the 🧮 Heuristic engine.`;
  }

  // Generic fallback — include the raw error for debugging
  return `The ${engine} engine ("${model}") failed: ${raw}. Try a different model or switch to the 🧮 Heuristic engine.`;
}

/**
 * Pre-compute correlations and store the result.
 * Called after collection completes so the dashboard can load
 * cached correlations instantly without waiting for CORRELATE_ALL.
 */
async function runCorrelationPrecompute(
  markets: MarketContract[],
  signals: SocialSignal[],
  news: NewsItem[],
  settings: ExtensionSettings,
): Promise<void> {
  const engine = settings.correlationEngine;
  const model = engine === 'embedding' ? settings.embeddingModel
    : engine === 'sentiment' ? settings.sentimentModel
    : engine === 'zeroshot' ? settings.zeroShotModel
    : engine === 'ner' ? settings.nerModel
    : engine === 'llm' ? settings.llmModel
    : settings.embeddingModel;
  const result = await runCorrelationWithEngine(markets, signals, news, engine, model, `precompute-${Date.now()}`);

  await browser.storage.local.set({ [CONFIG.storage.correlations]: result });

  // Phase 4: evaluate the fresh result against the watchlist and dispatch
  // any new alerts (badge fallback if notifications are denied).
  await runAlertSweep();

  // Phase 5: rebuild the derived market-driven news snapshot.
  await rebuildMarketNewsView();

  if (result.error) {
    console.warn(
      `[TrendCast] Pre-compute (${engine}) failed: ${result.error} — ${result.matches.length} results`,
    );
  } else {
    console.log(
      `[TrendCast] Pre-computed (${engine}) ${result.matches.length} signal→market, ${result.newsMatches.length} news→market, ${result.newsSocialMatches.length} news→social, ${result.newsNewsMatches.length} news↔news`,
    );
  }
}

// ── Storage helpers ───────────────────────────────────────────────

async function storeMarkets(markets: MarketContract[]): Promise<void> {
  const existing = await getCollectedMarkets();
  const merged = mergeMarkets(existing, markets);
  await browser.storage.local.set({ [CONFIG.storage.collectedMarkets]: merged });
}

async function storeSignals(signals: SocialSignal[]): Promise<void> {
  const existing = await getCollectedSignals();
  const merged = mergeSignals(existing, signals);
  await browser.storage.local.set({ [CONFIG.storage.collectedSignals]: merged });
}

async function storeNews(news: NewsItem[]): Promise<void> {
  const existing = await getCollectedNews();
  const merged = mergeNews(existing, news);
  await browser.storage.local.set({ [CONFIG.storage.collectedNews]: merged });
}

async function getCollectedMarkets(): Promise<MarketContract[]> {
  const result = await browser.storage.local.get(CONFIG.storage.collectedMarkets);
  return (result[CONFIG.storage.collectedMarkets] as MarketContract[]) ?? [];
}

async function getCollectedSignals(): Promise<SocialSignal[]> {
  const result = await browser.storage.local.get(CONFIG.storage.collectedSignals);
  return (result[CONFIG.storage.collectedSignals] as SocialSignal[]) ?? [];
}

async function getCollectedNews(): Promise<NewsItem[]> {
  const result = await browser.storage.local.get(CONFIG.storage.collectedNews);
  return (result[CONFIG.storage.collectedNews] as NewsItem[]) ?? [];
}

async function getLatestSnapshot(): Promise<CollectionSnapshot | null> {
  const result = await browser.storage.local.get(CONFIG.storage.latestSnapshot);
  return (result[CONFIG.storage.latestSnapshot] as CollectionSnapshot) ?? null;
}

/** Get extension settings (merged with defaults for forward-compat). */
async function getSettings(): Promise<ExtensionSettings> {
  // Deep-merge so newly-added fields (e.g. seekingalpha/investing source flags)
  // are always present even if the user has older saved settings, while explicit
  // user preferences are preserved.
  return getSettingsFromStorage(browser.storage.local);
}

/**
 * Migration: TikTok is now collected automatically (like Reddit/X) and should
 * be on by default. Existing users who saved the old opt-in default
 * (`tiktok: false`) get it flipped to `true`. Only touches the `tiktok` key —
 * all other user settings are preserved.
 */
async function migrateTikTokDefault(): Promise<void> {
  try {
    const result = await browser.storage.local.get(CONFIG.storage.settings);
    const stored = result[CONFIG.storage.settings] as Partial<ExtensionSettings> | undefined;
    if (!stored) return; // no saved settings — fresh default already applies
    const enabled = stored.enabledSources;
    if (!enabled || enabled.tiktok === true) return; // already on or unset
    await browser.storage.local.set({
      [CONFIG.storage.settings]: {
        ...stored,
        enabledSources: { ...enabled, tiktok: true },
      },
    });
    console.log('[TrendCast] Migration: enabled TikTok by default (automatic collection)');
  } catch (err) {
    console.warn('[TrendCast] TikTok default migration failed (non-fatal):', err);
  }
}

/**
 * Migration: backfill any missing news source flags (e.g. `seekingalpha`,
 * `investing`, `googleFinance`) into persisted settings so the deep-merge fix
 * survives restarts. Silent and idempotent — present keys (explicit user
 * preferences) are never overwritten. Mirrors `migrateTikTokDefault()`.
 */
async function migrateEnabledSourcesDefault(): Promise<void> {
  try {
    await migrateEnabledSourcesFromStorage(browser.storage.local);
    console.log('[TrendCast] Migration: backfilled missing news source flags');
  } catch (err) {
    console.warn('[TrendCast] News source flags migration failed (non-fatal):', err);
  }
}

// ── Merge helpers (deduplicate by ID, keep newest) ───────────────
// Implemented in `src/background/merge.ts` (Phase 8, PERF-03) so the per-key
// cap logic is unit-testable. Imported above as `mergeMarkets`/`mergeSignals`/
// `mergeNews`.

// ── History helpers (Phase 3: historical charts) ─────────────────

/** Append a compact history entry after each collection. */
async function appendHistoryEntry(snapshot: CollectionSnapshot, maxEntries: number): Promise<void> {
  const result = await browser.storage.local.get(CONFIG.storage.history);
  const history = (result[CONFIG.storage.history] as HistoryEntry[]) ?? [];

  // Compute aggregate stats for this snapshot
  const topVirality = [...snapshot.signals]
    .sort((a, b) => b.virality - a.virality)
    .slice(0, 5)
    .map((s) => s.virality);

  const avgSentiment = snapshot.signals.length > 0
    ? snapshot.signals.reduce((sum, s) => sum + s.sentiment, 0) / snapshot.signals.length
    : 0;

  // Count correlations (approximate — use stored correlations if available)
  const corrResult = await browser.storage.local.get(CONFIG.storage.correlations);
  const corrData = corrResult[CONFIG.storage.correlations] as { matches: CorrelationMatch[]; newsMatches: NewsCorrelationMatch[] } | undefined;
  const correlationCount = (corrData?.matches?.length ?? 0) + (corrData?.newsMatches?.length ?? 0);

  const entry: HistoryEntry = {
    timestamp: snapshot.collectedAt,
    marketCount: snapshot.markets.length,
    signalCount: snapshot.signals.length,
    newsCount: snapshot.news.length,
    correlationCount,
    topVirality,
    avgSentiment,
    // All markets sorted by volume (for detail panel with links, capped at 50)
    topMarkets: [...snapshot.markets]
      .sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0))
      .slice(0, 50)
      .map((m) => ({
        id: m.id,
        platform: m.platform,
        question: m.question,
        yesPrice: m.outcomes.find((o) => o.label.toLowerCase() === 'yes')?.price,
        volume24h: m.volume24h,
        url: m.url,
      })),
    // All signals sorted by virality (for detail panel with links)
    topSignals: [...snapshot.signals]
      .sort((a, b) => b.virality - a.virality)
      .map((s) => ({
        id: s.id,
        platform: s.platform,
        text: s.text,
        author: s.author,
        virality: s.virality,
        sentiment: s.sentiment,
        url: s.url,
      })),
    // All news items sorted by recency (for detail panel with links, capped at 50)
    topNews: [...snapshot.news]
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      .slice(0, 50)
      .map((n) => ({
        id: n.id,
        source: n.source,
        headline: n.headline,
        url: n.url,
        publishedAt: n.publishedAt,
      })),
  };

  history.push(entry);

  // Trim to max entries (keep most recent)
  const trimmed = history.slice(-maxEntries);
  await browser.storage.local.set({ [CONFIG.storage.history]: trimmed });
}

/** Get historical entries for charting. */
async function getHistory(limit: number): Promise<HistoryEntry[]> {
  const result = await browser.storage.local.get(CONFIG.storage.history);
  const history = (result[CONFIG.storage.history] as HistoryEntry[]) ?? [];
  return history.slice(-limit);
}

// ── Watchlist helpers (Phase 3: custom watchlists) ───────────────

/** Get the user's watchlist. */
async function getWatchlist(): Promise<WatchlistEntry[]> {
  const result = await browser.storage.local.get(CONFIG.storage.watchlist);
  return backfillWatchlist((result[CONFIG.storage.watchlist] as WatchlistEntry[]) ?? []);
}