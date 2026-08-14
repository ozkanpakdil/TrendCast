/**
 * Background service worker — the orchestrator.
 *
 * Responsibilities:
 *   1. Listen for messages from popup and content scripts.
 *   2. Poll prediction market APIs on a schedule (via chrome.alarms).
 *   3. Fetch social signals on demand.
 *   4. Run the correlation engine and cache results.
 *   5. Send notifications on high-sentiment spikes.
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
 *    3. WebSocket connections WILL be dropped when the worker is killed.
 *       Reconnect on `chrome.runtime.onStartup` and in the alarm handler.
 *
 *    4. The worker restarts on any message or event. Register all
 *       listeners synchronously at the top level (not inside async functions).
 *
 * Reference: https://developer.chrome.com/docs/extensions/mv3/service_workers/
 */

import { browser } from '@/messaging/browser';
import { onMessage, sendTabMessage } from '@/messaging';
import { CONFIG } from '@/config';
import type { CorrelationMatch, ExtensionSettings, MarketContract, SocialSignal } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';
import { fetchPolymarketMarkets, fetchPolymarketMarketBySlug } from '@/services/api/polymarket';
import { fetchKalshiMarkets, fetchKalshiMarketByTicker } from '@/services/api/kalshi';
import { searchReddit } from '@/services/api/reddit';
import { correlate } from '@/services/engine/correlation';

// ── Register all listeners synchronously at top level ────────────
// This is critical: if listeners are registered inside async code,
// the worker may be killed before they attach.

setupAlarms();
setupMessageHandlers();
setupInstallHandler();

console.log('[HypeMarket] Background worker initialised at', new Date().toISOString());

// ── Alarm setup ──────────────────────────────────────────────────

function setupAlarms(): void {
  // Re-register the alarm on every worker restart (alarms persist, but
  // re-registering is idempotent and ensures it exists).
  browser.alarms.create(CONFIG.polling.alarmName, {
    periodInMinutes: CONFIG.polling.defaultIntervalMinutes,
  });

  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== CONFIG.polling.alarmName) return;
    console.log('[HypeMarket] Alarm fired — refreshing market data');
    await refreshAllMarkets();
  });
}

// ── Message handlers ─────────────────────────────────────────────

function setupMessageHandlers(): void {
  // Popup → Background: fetch markets for a platform
  onMessage('FETCH_MARKETS', async (payload) => {
    const markets = await fetchMarketsForPlatform(payload.platform);
    return markets;
  });

  // Content script (prediction markets) → Background: resolve contract from URL
  onMessage('GET_CONTRACT_CONTEXT', async (payload) => {
    return resolveContractFromUrl(payload.url);
  });

  // Popup → Background: fetch social signals for keywords
  onMessage('FETCH_SOCIAL_SIGNALS', async (payload) => {
    const settings = await getSettings();
    const signals: SocialSignal[] = [];

    if (payload.platform === 'reddit' && settings.enabledPlatforms.reddit) {
      const redditSignals = await searchReddit(payload.keywords, {
        clientId: settings.apiKeys.redditClientId ?? '',
        clientSecret: settings.apiKeys.redditClientSecret ?? '',
      });
      signals.push(...redditSignals);
    }
    // X and TikTok would be implemented similarly (or via content script scraping).
    // For now, we return what we have.

    return signals;
  });

  // Popup → Background: correlate a contract with social signals
  onMessage('CORRELATE', async (payload) => {
    const cached = await getCachedMarkets();
    const contract = cached.find((m) => m.id === payload.contractId);
    if (!contract) return [];

    const settings = await getSettings();
    const allSignals: SocialSignal[] = [];

    if (settings.enabledPlatforms.reddit) {
      const redditSignals = await searchReddit(contract.keywords, {
        clientId: settings.apiKeys.redditClientId ?? '',
        clientSecret: settings.apiKeys.redditClientSecret ?? '',
      });
      allSignals.push(...redditSignals);
    }

    const matches = correlate(allSignals, [contract]);
    await cacheCorrelations(matches);
    return matches;
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

    // Always re-register alarms on install/update (alarms may be cleared).
    browser.alarms.create(CONFIG.polling.alarmName, {
      periodInMinutes: CONFIG.polling.defaultIntervalMinutes,
    });
  });
}

// ── Helper functions ─────────────────────────────────────────────

/** Fetch markets from a specific platform and cache them. */
async function fetchMarketsForPlatform(platform: 'polymarket' | 'kalshi'): Promise<MarketContract[]> {
  try {
    const markets = platform === 'polymarket'
      ? await fetchPolymarketMarkets()
      : await fetchKalshiMarkets();

    // Merge into cache (don't overwrite the other platform's data).
    const existing = await getCachedMarkets();
    const merged = [...existing.filter((m) => m.platform !== platform), ...markets];
    await browser.storage.local.set({ [CONFIG.storage.cachedMarkets]: merged });

    return markets;
  } catch (err) {
    console.error(`[HypeMarket] Failed to fetch ${platform} markets:`, err);
    return [];
  }
}

/** Refresh markets from all enabled platforms (called by alarm). */
async function refreshAllMarkets(): Promise<void> {
  await fetchMarketsForPlatform('polymarket');
  await fetchMarketsForPlatform('kalshi');
}

/**
 * Resolve a prediction market contract from a URL.
 * Used by content scripts when the user is browsing polymarket.com or kalshi.com.
 */
async function resolveContractFromUrl(url: string): Promise<MarketContract | null> {
  const parsed = new URL(url);
  const hostname = parsed.hostname;

  if (hostname.includes('polymarket.com')) {
    // Polymarket URLs: polymarket.com/event/{slug} or polymarket.com/event/{slug}/{subslug}
    const match = parsed.pathname.match(/\/event\/([^/]+)/);
    if (match) {
      return fetchPolymarketMarketBySlug(match[1]);
    }
  }

  if (hostname.includes('kalshi.com')) {
    // Kalshi URLs: kalshi.com/markets/{ticker}
    const match = parsed.pathname.match(/\/markets\/([^/]+)/);
    if (match) {
      return fetchKalshiMarketByTicker(match[1]);
    }
  }

  return null;
}

/** Get cached markets from storage. */
async function getCachedMarkets(): Promise<MarketContract[]> {
  const result = await browser.storage.local.get(CONFIG.storage.cachedMarkets);
  return (result[CONFIG.storage.cachedMarkets] as MarketContract[]) ?? [];
}

/** Cache correlation results. */
async function cacheCorrelations(matches: CorrelationMatch[]): Promise<void> {
  await browser.storage.local.set({ [CONFIG.storage.correlations]: matches });
}

/** Get extension settings (with defaults). */
async function getSettings(): Promise<ExtensionSettings> {
  const result = await browser.storage.local.get(CONFIG.storage.settings);
  return (result[CONFIG.storage.settings] as ExtensionSettings) ?? DEFAULT_SETTINGS;
}