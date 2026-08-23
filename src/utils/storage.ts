/**
 * Storage budget monitoring and pruning utilities.
 *
 * Phase 4: Performance optimisation — keeps chrome.storage.local usage
 * within a safe budget by pruning oldest data when the soft limit is
 * exceeded. chrome.storage.local has a ~10 MB quota in MV3; we target
 * a 7 MB soft budget to leave headroom and avoid QUOTA errors.
 *
 * Strategy:
 *   1. After each collection cycle, measure total bytes used by TrendCast keys.
 *   2. If over budget, prune oldest entries from history, then signals,
 *      then news, then markets — in that order — until under the target.
 *   3. Log a warning so the user can see pruning happened.
 */

import { browser } from '@/messaging/browser';
import { CONFIG } from '@/config';

/** TrendCast-owned storage keys to include in the budget calculation. */
export const BUDGET_KEYS = [
  CONFIG.storage.latestSnapshot,
  CONFIG.storage.collectedMarkets,
  CONFIG.storage.collectedSignals,
  CONFIG.storage.collectedNews,
  CONFIG.storage.correlations,
  CONFIG.storage.history,
  CONFIG.storage.watchlist,
  CONFIG.storage.settings,
  CONFIG.storage.lastCollectionAt,
  CONFIG.storage.alertState,
  CONFIG.storage.alertHistory,
  CONFIG.storage.marketNewsView,
] as const;

/**
 * Estimate the byte size of a value stored in chrome.storage.local.
 * chrome.storage.local serialises values as JSON, so we use JSON.stringify
 * to approximate the on-disk size (UTF-16 in Chrome, but this is a good
 * relative measure for budgeting).
 */
export function estimateBytes(value: unknown): number {
  try {
    return new Blob([JSON.stringify(value)]).size;
  } catch {
    return 0;
  }
}

/**
 * Measure the total bytes used by all TrendCast-owned storage keys.
 */
export async function measureStorageUsage(): Promise<{ totalBytes: number; perKey: Record<string, number> }> {
  const result = await browser.storage.local.get([...BUDGET_KEYS]);
  const perKey: Record<string, number> = {};
  let totalBytes = 0;

  for (const key of BUDGET_KEYS) {
    const size = estimateBytes(result[key]);
    perKey[key] = size;
    totalBytes += size;
  }

  return { totalBytes, perKey };
}

/**
 * Prune oldest data to bring storage usage under the budget target.
 * Pruning order (most expendable first):
 *   1. History entries (oldest first)
 *   2. Collected signals (oldest first)
 *   3. Collected news (oldest first)
 *   4. Collected markets (oldest first)
 *
 * @returns true if any pruning occurred.
 */
export async function pruneStorageIfNeeded(): Promise<boolean> {
  const { totalBytes } = await measureStorageUsage();
  const budget = CONFIG.storageBudget.budgetBytes;
  if (totalBytes <= budget) return false;

  const target = Math.floor(budget * CONFIG.storageBudget.pruneTargetFraction);
  console.warn(
    `[TrendCast] Storage over budget: ${(totalBytes / 1024 / 1024).toFixed(2)} MB > ${(budget / 1024 / 1024).toFixed(2)} MB — pruning to ${(target / 1024 / 1024).toFixed(2)} MB`,
  );

  let currentBytes = totalBytes;
  let pruned = false;

  // 1. Prune history (oldest first)
  if (currentBytes > target) {
    const result = await browser.storage.local.get(CONFIG.storage.history);
    const history = (result[CONFIG.storage.history] as unknown[]) ?? [];
    if (history.length > 0) {
      // Remove oldest entries until under target or only 24 remain.
      const minKeep = 24;
      while (history.length > minKeep && currentBytes > target) {
        const removed = history.shift();
        currentBytes -= estimateBytes(removed);
        pruned = true;
      }
      await browser.storage.local.set({ [CONFIG.storage.history]: history });
    }
  }

  // 2. Prune signals (oldest first by timestamp)
  if (currentBytes > target) {
    const result = await browser.storage.local.get(CONFIG.storage.collectedSignals);
    const signals = (result[CONFIG.storage.collectedSignals] as Array<{ timestamp?: string }>) ?? [];
    if (signals.length > 0) {
      signals.sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''));
      const minKeep = 100;
      while (signals.length > minKeep && currentBytes > target) {
        const removed = signals.shift();
        currentBytes -= estimateBytes(removed);
        pruned = true;
      }
      await browser.storage.local.set({ [CONFIG.storage.collectedSignals]: signals });
    }
  }

  // 3. Prune news (oldest first by publishedAt)
  if (currentBytes > target) {
    const result = await browser.storage.local.get(CONFIG.storage.collectedNews);
    const news = (result[CONFIG.storage.collectedNews] as Array<{ publishedAt?: string }>) ?? [];
    if (news.length > 0) {
      news.sort((a, b) => (a.publishedAt ?? '').localeCompare(b.publishedAt ?? ''));
      const minKeep = 50;
      while (news.length > minKeep && currentBytes > target) {
        const removed = news.shift();
        currentBytes -= estimateBytes(removed);
        pruned = true;
      }
      await browser.storage.local.set({ [CONFIG.storage.collectedNews]: news });
    }
  }

  // 4. Prune markets (oldest first by lastUpdated)
  if (currentBytes > target) {
    const result = await browser.storage.local.get(CONFIG.storage.collectedMarkets);
    const markets = (result[CONFIG.storage.collectedMarkets] as Array<{ lastUpdated?: number }>) ?? [];
    if (markets.length > 0) {
      markets.sort((a, b) => (a.lastUpdated ?? 0) - (b.lastUpdated ?? 0));
      const minKeep = 100;
      while (markets.length > minKeep && currentBytes > target) {
        const removed = markets.shift();
        currentBytes -= estimateBytes(removed);
        pruned = true;
      }
      await browser.storage.local.set({ [CONFIG.storage.collectedMarkets]: markets });
    }
  }

  if (pruned) {
    const { totalBytes: after } = await measureStorageUsage();
    console.warn(
      `[TrendCast] Pruning complete: ${(after / 1024 / 1024).toFixed(2)} MB now in use`,
    );
  }

  return pruned;
}