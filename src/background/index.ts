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
  ExtensionSettings,
  HistoryEntry,
  MarketContract,
  NewsCorrelationMatch,
  NewsItem,
  SocialSignal,
  WatchlistEntry,
} from '@/types';
import { DEFAULT_SETTINGS } from '@/types';
import { collectPolymarketMarkets, collectKalshiMarkets, collectRedditSignals, collectXTrends, collectNews } from '@/services/collectors';
import { correlate, correlateNews, correlateNewsSocial } from '@/services/engine/correlation';
import { exportToCsv, exportToJson } from '@/utils/export';

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

// ── Alarm setup ──────────────────────────────────────────────────

function setupAlarms(): void {
  browser.alarms.create(CONFIG.collection.alarmName, {
    periodInMinutes: CONFIG.collection.defaultIntervalMinutes,
  });

  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== CONFIG.collection.alarmName) return;
    console.log('[TrendCast] Alarm fired — starting hourly collection');
    await runCollection();
  });
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
  onMessage('CORRELATE_ALL', async () => {
    const markets = await getCollectedMarkets();
    const signals = await getCollectedSignals();
    const news = await getCollectedNews();

    const matches = correlate(signals, markets);
    const newsMatches = correlateNews(news, markets);
    const newsSocialMatches = correlateNewsSocial(news, signals);

    const result = { matches, newsMatches, newsSocialMatches };
    await browser.storage.local.set({ [CONFIG.storage.correlations]: result });
    console.log(
      `[TrendCast] Correlated ${matches.length} signal→market, ${newsMatches.length} news→market, ${newsSocialMatches.length} news→social`,
    );

    return result;
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
}

// ── Install / update handler ─────────────────────────────────────

function setupInstallHandler(): void {
  browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
      console.log('[TrendCast] First install — seeding default settings');
      await browser.storage.local.set({
        [CONFIG.storage.settings]: DEFAULT_SETTINGS,
      });
    }

    // Always re-register alarms on install/update.
    browser.alarms.create(CONFIG.collection.alarmName, {
      periodInMinutes: CONFIG.collection.defaultIntervalMinutes,
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
      collectRedditSignals()
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

  // News (BBC, CNN, Yahoo Finance, Google News finance)
  const newsSources: Array<'bbc' | 'cnn' | 'yahoo' | 'googleFinance'> = [];
  if (enabled.bbc) newsSources.push('bbc');
  if (enabled.cnn) newsSources.push('cnn');
  if (enabled.yahoo) newsSources.push('yahoo');
  if (enabled.googleFinance) newsSources.push('googleFinance');
  if (newsSources.length > 0) {
    tasks.push(
      collectNews(newsSources)
        .then((news) => storeNews(news))
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
  };

  await browser.storage.local.set({
    [CONFIG.storage.latestSnapshot]: snapshot,
    [CONFIG.storage.lastCollectionAt]: snapshot.collectedAt,
  });

  // Save a compact history entry for charting.
  await appendHistoryEntry(snapshot, settings.maxHistoryEntries);

  console.log(
    `[TrendCast] ━━ Collection complete: ${markets.length} markets, ${signals.length} signals, ${news.length} news ━━`,
  );

  // Pre-compute correlations in the background so the dashboard
  // can display them instantly when the user opens the Correlations tab.
  // This runs after collection completes, leveraging the time before the
  // user navigates to the correlations tab.
  runCorrelationPrecompute(markets, signals, news).catch((err) =>
    console.error('[TrendCast] Pre-compute correlations failed:', err),
  );

  return snapshot;
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
): Promise<void> {
  const matches = correlate(signals, markets);
  const newsMatches = correlateNews(news, markets);
  const newsSocialMatches = correlateNewsSocial(news, signals);

  const result = { matches, newsMatches, newsSocialMatches };
  await browser.storage.local.set({ [CONFIG.storage.correlations]: result });
  console.log(
    `[TrendCast] Pre-computed ${matches.length} signal→market, ${newsMatches.length} news→market, ${newsSocialMatches.length} news→social`,
  );
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

/** Get extension settings (with defaults). */
async function getSettings(): Promise<ExtensionSettings> {
  const result = await browser.storage.local.get(CONFIG.storage.settings);
  return (result[CONFIG.storage.settings] as ExtensionSettings) ?? DEFAULT_SETTINGS;
}

// ── Merge helpers (deduplicate by ID, keep newest) ───────────────

function mergeMarkets(existing: MarketContract[], incoming: MarketContract[]): MarketContract[] {
  const map = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) {
    const prev = map.get(m.id);
    if (!prev || m.lastUpdated > prev.lastUpdated) {
      map.set(m.id, m);
    }
  }
  return Array.from(map.values());
}

function mergeSignals(existing: SocialSignal[], incoming: SocialSignal[]): SocialSignal[] {
  const map = new Map(existing.map((s) => [s.id, s]));
  for (const s of incoming) {
    map.set(s.id, s); // always overwrite signals (newer = more recent)
  }
  // Keep only the latest 500 signals to prevent unbounded growth.
  return Array.from(map.values()).slice(-500);
}

function mergeNews(existing: NewsItem[], incoming: NewsItem[]): NewsItem[] {
  const map = new Map(existing.map((n) => [n.id, n]));
  for (const n of incoming) {
    map.set(n.id, n);
  }
  // Keep only the latest 200 news items.
  return Array.from(map.values()).slice(-200);
}

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
    // All signals sorted by virality (for detail panel with links, capped at 50)
    topSignals: [...snapshot.signals]
      .sort((a, b) => b.virality - a.virality)
      .slice(0, 50)
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
  return (result[CONFIG.storage.watchlist] as WatchlistEntry[]) ?? [];
}