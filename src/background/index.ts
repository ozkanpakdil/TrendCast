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
  ExtensionSettings,
  MarketContract,
  NewsItem,
  SocialSignal,
} from '@/types';
import { DEFAULT_SETTINGS } from '@/types';
import { collectPolymarketMarkets, collectKalshiMarkets, collectRedditSignals, collectNews } from '@/services/collectors';
import { correlate, correlateNews } from '@/services/engine/correlation';

// ── Register all listeners synchronously at top level ────────────
setupAlarms();
setupMessageHandlers();
setupInstallHandler();

console.log('[HypeMarket] Background worker initialised at', new Date().toISOString());

// ── Alarm setup ──────────────────────────────────────────────────

function setupAlarms(): void {
  browser.alarms.create(CONFIG.collection.alarmName, {
    periodInMinutes: CONFIG.collection.defaultIntervalMinutes,
  });

  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== CONFIG.collection.alarmName) return;
    console.log('[HypeMarket] Alarm fired — starting hourly collection');
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
    console.log(`[HypeMarket] Stored ${payload.markets.length} markets from content script`);
  });

  // Content script → Background: report scraped social signals from DOM
  onMessage('REPORT_SOCIAL_DATA', async (payload) => {
    const existing = await getCollectedSignals();
    const merged = mergeSignals(existing, payload.signals);
    await browser.storage.local.set({ [CONFIG.storage.collectedSignals]: merged });
    console.log(`[HypeMarket] Stored ${payload.signals.length} social signals from content script`);
  });

  // Content script → Background: report scraped news headlines from DOM
  onMessage('REPORT_NEWS_DATA', async (payload) => {
    const existing = await getCollectedNews();
    const merged = mergeNews(existing, payload.news);
    await browser.storage.local.set({ [CONFIG.storage.collectedNews]: merged });
    console.log(`[HypeMarket] Stored ${payload.news.length} news items from content script`);
  });

  // Popup / Dashboard → Background: trigger manual collection
  onMessage('TRIGGER_COLLECTION', async () => {
    console.log('[HypeMarket] Manual collection triggered');
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

    await browser.storage.local.set({ [CONFIG.storage.correlations]: { matches, newsMatches } });
    console.log(`[HypeMarket] Correlated ${matches.length} signal matches, ${newsMatches.length} news matches`);

    return { matches, newsMatches };
  });
}

// ── Install / update handler ─────────────────────────────────────

function setupInstallHandler(): void {
  browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
      console.log('[HypeMarket] First install — seeding default settings');
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

  const tasks: Promise<unknown>[] = [];

  // Markets
  if (enabled.polymarket) {
    tasks.push(
      collectPolymarketMarkets()
        .then((markets) => storeMarkets(markets))
        .catch((err) => console.error('[HypeMarket] Polymarket collection failed:', err)),
    );
  }

  if (enabled.kalshi) {
    tasks.push(
      collectKalshiMarkets()
        .then((markets) => storeMarkets(markets))
        .catch((err) => console.error('[HypeMarket] Kalshi collection failed:', err)),
    );
  }

  // Social signals
  if (enabled.reddit) {
    tasks.push(
      collectRedditSignals()
        .then((signals) => storeSignals(signals))
        .catch((err) => console.error('[HypeMarket] Reddit collection failed:', err)),
    );
  }

  // News (BBC + CNN)
  const newsSources: Array<'bbc' | 'cnn'> = [];
  if (enabled.bbc) newsSources.push('bbc');
  if (enabled.cnn) newsSources.push('cnn');
  if (newsSources.length > 0) {
    tasks.push(
      collectNews(newsSources)
        .then((news) => storeNews(news))
        .catch((err) => console.error('[HypeMarket] News collection failed:', err)),
    );
  }

  // X and TikTok require content script scraping (no public fetch endpoint).
  // They will report data via REPORT_SOCIAL_DATA when the user visits those sites.

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

  console.log(`[HypeMarket] Collection complete: ${markets.length} markets, ${signals.length} signals, ${news.length} news items`);
  return snapshot;
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