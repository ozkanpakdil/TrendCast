/**
 * Correlation Alert Engine (Phase 4).
 *
 * Pure, storage-backed alert detection that runs after correlation
 * completes. It turns a `CorrelationResult` for watchlisted markets into
 * deduped, throttled, direction-aware `AlertRecord`s persisted to a capped
 * `alertHistory`.
 *
 * Design decisions (see 04-CONTEXT.md):
 *   - D-01: Alert only on NEW or direction-changed correlations — never
 *           sustained matches (anti-fatigue).
 *   - D-02: No numeric confidence threshold gates an alert.
 *   - D-03: "New" is defined at the market level (aggregate of its signals).
 *   - D-04: Direction = aggregate signal sentiment + Yes-price delta.
 *   - D-05: Prior Yes-price comes from `alertState.priorYesPrice`.
 *   - D-06: A direction change only alerts when it crosses a meaningful band.
 *
 * State survives the ephemeral MV3 service worker via chrome.storage.local.
 */

import { browser } from '@/messaging/browser';
import { CONFIG } from '@/config';
import type {
  AlertRecord,
  AlertState,
  CorrelationResult,
  ExtensionSettings,
  MarketContract,
  NewsItem,
  SocialSignal,
  WatchlistEntry,
} from '@/types';

/** Empty alert state used when nothing is persisted yet. */
export function emptyAlertState(): AlertState {
  return {
    lastNotified: {},
    priorYesPrice: {},
    lastGlobalAlertAt: 0,
  };
}

/** Read the persisted alert state (or a fresh one if absent). */
async function readAlertState(): Promise<AlertState> {
  const result = await browser.storage.local.get(CONFIG.storage.alertState);
  const state = result[CONFIG.storage.alertState] as AlertState | undefined;
  return state ?? emptyAlertState();
}

/** Read the persisted alert history (capped). */
async function readAlertHistory(): Promise<AlertRecord[]> {
  const result = await browser.storage.local.get(CONFIG.storage.alertHistory);
  return (result[CONFIG.storage.alertHistory] as AlertRecord[]) ?? [];
}

/** Best Yes price (0–1) for a contract, or undefined if none. */
function yesPriceOf(contract: MarketContract): number | undefined {
  return contract.outcomes.find((o) => o.label.toLowerCase() === 'yes')?.price;
}

/**
 * Derive a market-level direction from aggregate signal sentiment and the
 * Yes-price delta vs a prior snapshot.
 *
 *   - bullish  = positive mean sentiment AND rising Yes price
 *   - bearish  = negative mean sentiment AND falling Yes price
 *   - mixed    = otherwise (conflicting signals / no price move)
 */
export function deriveDirection(
  contract: MarketContract,
  signals: SocialSignal[],
  _news: NewsItem[],
  priorYesPrice: number | undefined,
): 'bullish' | 'bearish' | 'mixed' {
  const currentYes = yesPriceOf(contract);

  // Aggregate signal sentiment (mean of correlated signals).
  let sentiment = 0;
  if (signals.length > 0) {
    sentiment = signals.reduce((sum, s) => sum + s.sentiment, 0) / signals.length;
  }

  // Yes-price delta vs prior snapshot (if we have both).
  let priceDelta = 0;
  if (currentYes !== undefined && priorYesPrice !== undefined) {
    priceDelta = currentYes - priorYesPrice;
  }

  const bullishSentiment = sentiment > 0;
  const bearishSentiment = sentiment < 0;
  const risingPrice = priceDelta > 0;
  const fallingPrice = priceDelta < 0;

  if (bullishSentiment && risingPrice) return 'bullish';
  if (bearishSentiment && fallingPrice) return 'bearish';
  return 'mixed';
}

/**
 * Evaluate a correlation result and produce new alert records for
 * watchlisted markets whose direction is new or meaningfully changed.
 *
 * @returns the newly created `AlertRecord[]` (already persisted).
 */
export async function evaluateAlerts(
  result: CorrelationResult,
  watchlist: WatchlistEntry[],
  settings: ExtensionSettings,
  now: number = Date.now(),
): Promise<AlertRecord[]> {
  if (!settings.alertsEnabled) return [];

  const watchlisted = new Set(watchlist.map((w) => w.contractId));
  if (watchlisted.size === 0) return [];

  const [state, history] = await Promise.all([readAlertState(), readAlertHistory()]);

  // Group correlated signals + news by contract id.
  const signalsByContract = new Map<string, SocialSignal[]>();
  const newsByContract = new Map<string, NewsItem[]>();
  const confidenceByContract = new Map<string, number>();
  const contractById = new Map<string, MarketContract>();

  for (const m of result.matches) {
    if (!watchlisted.has(m.contract.id)) continue;
    contractById.set(m.contract.id, m.contract);
    const list = signalsByContract.get(m.contract.id) ?? [];
    list.push(m.signal);
    signalsByContract.set(m.contract.id, list);
    const prev = confidenceByContract.get(m.contract.id) ?? 0;
    if (m.confidence > prev) confidenceByContract.set(m.contract.id, m.confidence);
  }
  for (const m of result.newsMatches) {
    if (!watchlisted.has(m.contract.id)) continue;
    contractById.set(m.contract.id, m.contract);
    const list = newsByContract.get(m.contract.id) ?? [];
    list.push(m.news);
    newsByContract.set(m.contract.id, list);
    const prev = confidenceByContract.get(m.contract.id) ?? 0;
    if (m.confidence > prev) confidenceByContract.set(m.contract.id, m.confidence);
  }

  const newAlerts: AlertRecord[] = [];

  const globalCooldownMs = CONFIG.alerts.globalCooldownMinutes * 60_000;
  const perMarketCooldownMs =
    (settings.alertCooldownMinutes ?? CONFIG.alerts.perMarketCooldownMinutes) * 60_000;

  for (const contractId of contractById.keys()) {
    const contract = contractById.get(contractId)!;
    const signals = signalsByContract.get(contractId) ?? [];
    const news = newsByContract.get(contractId) ?? [];
    const priorYes = state.priorYesPrice[contractId];
    const currentYes = yesPriceOf(contract);

    const direction = deriveDirection(contract, signals, news, priorYes);

    // D-01: only alert on NEW or direction-changed correlations.
    // A brand-new signal for a market with no prior state counts as new.
    const isNew = state.priorYesPrice[contractId] === undefined;

    // D-06: meaningful-band flip — only alert if sentiment or price moved
    // enough, OR this is a brand-new market (no prior snapshot).
    const sentiment = signals.length > 0
      ? signals.reduce((sum, s) => sum + s.sentiment, 0) / signals.length
      : 0;
    const priceDelta = currentYes !== undefined && priorYes !== undefined
      ? currentYes - priorYes
      : 0;
    const meaningful =
      isNew ||
      Math.abs(sentiment) >= CONFIG.alerts.sentimentBand ||
      Math.abs(priceDelta) > CONFIG.alerts.yesPriceBand;

    if (!meaningful) continue;

    // Global throttle.
    if (now - state.lastGlobalAlertAt < globalCooldownMs) continue;

    // Per-market cooldown.
    const lastNotified = state.lastNotified[contractId] ?? 0;
    if (now - lastNotified < perMarketCooldownMs) continue;

    // Build the alert record.
    const topSignal = signals[0];
    const topNews = news[0];
    const record: AlertRecord = {
      id: `${contractId}:${now}`,
      contractId,
      platform: contract.platform,
      question: contract.question,
      direction,
      sentiment,
      yesPrice: currentYes ?? 0,
      topSignalText: topSignal?.text,
      topNewsHeadline: topNews?.headline,
      confidence: confidenceByContract.get(contractId) ?? 0,
      alertedAt: now,
    };

    newAlerts.push(record);
    state.lastNotified[contractId] = now;
    state.lastGlobalAlertAt = now;
    if (currentYes !== undefined) state.priorYesPrice[contractId] = currentYes;
  }

  if (newAlerts.length === 0) return [];

  // Persist updated state + capped history (Task 2: slice(-N) ring buffer).
  const updatedHistory = [...history, ...newAlerts].slice(-CONFIG.alerts.historyCap);
  await browser.storage.local.set({
    [CONFIG.storage.alertState]: state,
    [CONFIG.storage.alertHistory]: updatedHistory,
  });

  return newAlerts;
}

// ── Notification dispatch + badge fallback (D-07, D-09, D-10) ────

/** Read the full persisted alert history (capped). */
export async function getAlertHistory(): Promise<AlertRecord[]> {
  return readAlertHistory();
}

/**
 * Broadcast the current alert list to any listening dashboard/popup tabs.
 * Mirrors the CORRELATION_RESULT broadcast pattern (fire-and-forget).
 */
export async function broadcastAlerts(records: AlertRecord[]): Promise<void> {
  browser.runtime.sendMessage({
    type: 'ALERTS_UPDATED',
    payload: { alerts: records },
  }).catch((err) => {
    console.error('[TrendCast] ALERTS_UPDATED sendMessage failed:', err);
  });
}

/**
 * Update the toolbar badge with the count of alerts in the last N hours.
 * Time-based auto-clear (D-09): the badge reflects only recent alerts and
 * naturally clears as they age out of the window.
 */
export async function updateBadge(now: number = Date.now()): Promise<void> {
  const history = await readAlertHistory();
  const windowMs = CONFIG.alerts.badgeWindowHours * 60 * 60 * 1000;
  const cutoff = now - windowMs;
  const recent = history.filter((a) => a.alertedAt >= cutoff).length;
  const text = recent > 0 ? String(recent) : '';
  await browser.action.setBadgeText({ text });
}

/**
 * Clear all alert records, reset alert state, clear the badge, and
 * broadcast the empty list (D-10).
 */
export async function clearAlerts(): Promise<void> {
  await browser.storage.local.set({
    [CONFIG.storage.alertHistory]: [],
    [CONFIG.storage.alertState]: emptyAlertState(),
  });
  await browser.action.setBadgeText({ text: '' });
  await broadcastAlerts([]);
}

/**
 * Dispatch notifications for new alert records.
 * Only fires `chrome.notifications.create` when permission is 'granted'
 * (D-07). On 'denied', falls back to the toolbar badge via `updateBadge()`.
 * Always uses a packaged iconUrl (never a remote URL — blocked in MV3).
 */
export async function dispatchAlerts(records: AlertRecord[]): Promise<void> {
  if (records.length === 0) return;

  // `getPermissionLevel` is a real browser API but is missing from the
  // @types/webextension-polyfill definitions — feature-detect + cast.
  const notifications = browser.notifications as typeof browser.notifications & {
    getPermissionLevel?: () => Promise<'granted' | 'denied'>;
  };

  let permission: string;
  try {
    permission = notifications.getPermissionLevel
      ? await notifications.getPermissionLevel()
      : 'granted';
  } catch {
    // If notifications API is unavailable, fall back to the badge.
    await updateBadge();
    return;
  }

  if (permission !== 'granted') {
    await updateBadge();
    return;
  }

  for (const record of records) {
    const id = `trendcast-alert-${record.contractId}-${record.alertedAt}`;
    const message = record.topSignalText ?? record.topNewsHeadline ?? '';
    try {
      await browser.notifications.create(id, {
        type: 'basic',
        iconUrl: browser.runtime.getURL('icons/icon-128.png'),
        title: `${record.direction} — ${record.question}`,
        message,
      });
    } catch (err) {
      console.error('[Alert] notification create failed:', err);
    }
  }
}
