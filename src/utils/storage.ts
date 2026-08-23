/**
 * Storage budget monitoring and pruning utilities.
 *
 * Phase 4: Performance optimisation — keeps chrome.storage.local usage
 * within a safe budget by pruning oldest data when the soft limit is
 * exceeded. chrome.storage.local has a ~10 MB quota in MV3; we target
 * a 7 MB soft budget to leave headroom and avoid QUOTA errors.
 *
 * Phase 8 (PERF-03): `getBytesInUse()` is now the authoritative budget
 * measure (it reflects Chrome's real UTF-16 serialization), and per-key
 * byte deltas are tracked incrementally so pruning no longer re-serializes
 * the whole dataset on every cycle.
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
 *
 * NOTE (Phase 8): this is a per-item RELATIVE heuristic for pruning deltas
 * only — NOT the budget authority. The authoritative total comes from
 * `browser.storage.local.getBytesInUse()`.
 */
export function estimateBytes(value: unknown): number {
  try {
    return new Blob([JSON.stringify(value)]).size;
  } catch {
    return 0;
  }
}

/**
 * Incremental per-key byte tracking (Phase 8, PERF-03, D-03).
 *
 * A module-level map of key → estimated bytes, updated on write/prune so we
 * avoid re-serializing the whole dataset on every budget check. Reconciled
 * against `getBytesInUse()` periodically (see `reconcileByteEstimates`).
 */
const incrementalBytes = new Map<string, number>();

/** Record the estimated byte delta for a key (positive = added, negative = removed). */
export function trackBytes(key: string, delta: number): void {
  const current = incrementalBytes.get(key) ?? 0;
  incrementalBytes.set(key, Math.max(0, current + delta));
}

/** Reset the incremental estimate for a key to a known value. */
export function setTrackedBytes(key: string, bytes: number): void {
  incrementalBytes.set(key, Math.max(0, bytes));
}

/** Get the current incremental estimate for a key (0 if untracked). */
export function getTrackedBytes(key: string): number {
  return incrementalBytes.get(key) ?? 0;
}

/** Clear all incremental byte tracking (e.g., after a full reconcile). */
export function resetTrackedBytes(): void {
  incrementalBytes.clear();
}

/**
 * Measure the total bytes used by all TrendCast-owned storage keys.
 *
 * Phase 8: uses `getBytesInUse()` as the authoritative total (D-02). Per-key
 * estimates come from the incremental tracker when available, falling back to
 * `estimateBytes` on the stored value.
 */
export async function measureStorageUsage(): Promise<{ totalBytes: number; perKey: Record<string, number> }> {
  const result = await browser.storage.local.get([...BUDGET_KEYS]);
  const perKey: Record<string, number> = {};
  let totalBytes = 0;

  for (const key of BUDGET_KEYS) {
    const tracked = getTrackedBytes(key);
    const size = tracked > 0 ? tracked : estimateBytes(result[key]);
    perKey[key] = size;
    totalBytes += size;
  }

  // Reconcile the incremental estimate against the authoritative total.
  // If they diverge significantly, trust getBytesInUse() and resync.
  const authoritative = await getBytesInUse();
  if (authoritative > 0 && Math.abs(authoritative - totalBytes) > authoritative * 0.2) {
    totalBytes = authoritative;
    resetTrackedBytes();
  }

  return { totalBytes, perKey };
}

/** Authoritative total bytes used by chrome.storage.local (Phase 8, D-02). */
export async function getBytesInUse(): Promise<number> {
  try {
    const bytes = await browser.storage.local.getBytesInUse();
    return typeof bytes === 'number' ? bytes : 0;
  } catch {
    return 0;
  }
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
      let removedBytes = 0;
      while (history.length > minKeep && currentBytes > target) {
        const removed = history.shift();
        const bytes = estimateBytes(removed);
        removedBytes += bytes;
        currentBytes -= bytes;
        pruned = true;
      }
      await browser.storage.local.set({ [CONFIG.storage.history]: history });
      trackBytes(CONFIG.storage.history, -removedBytes);
    }
  }

  // 2. Prune signals (oldest first by timestamp)
  if (currentBytes > target) {
    const result = await browser.storage.local.get(CONFIG.storage.collectedSignals);
    const signals = (result[CONFIG.storage.collectedSignals] as Array<{ timestamp?: string }>) ?? [];
    if (signals.length > 0) {
      signals.sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''));
      const minKeep = 100;
      let removedBytes = 0;
      while (signals.length > minKeep && currentBytes > target) {
        const removed = signals.shift();
        const bytes = estimateBytes(removed);
        removedBytes += bytes;
        currentBytes -= bytes;
        pruned = true;
      }
      await browser.storage.local.set({ [CONFIG.storage.collectedSignals]: signals });
      trackBytes(CONFIG.storage.collectedSignals, -removedBytes);
    }
  }

  // 3. Prune news (oldest first by publishedAt)
  if (currentBytes > target) {
    const result = await browser.storage.local.get(CONFIG.storage.collectedNews);
    const news = (result[CONFIG.storage.collectedNews] as Array<{ publishedAt?: string }>) ?? [];
    if (news.length > 0) {
      news.sort((a, b) => (a.publishedAt ?? '').localeCompare(b.publishedAt ?? ''));
      const minKeep = 50;
      let removedBytes = 0;
      while (news.length > minKeep && currentBytes > target) {
        const removed = news.shift();
        const bytes = estimateBytes(removed);
        removedBytes += bytes;
        currentBytes -= bytes;
        pruned = true;
      }
      await browser.storage.local.set({ [CONFIG.storage.collectedNews]: news });
      trackBytes(CONFIG.storage.collectedNews, -removedBytes);
    }
  }

  // 4. Prune markets (oldest first by lastUpdated)
  if (currentBytes > target) {
    const result = await browser.storage.local.get(CONFIG.storage.collectedMarkets);
    const markets = (result[CONFIG.storage.collectedMarkets] as Array<{ lastUpdated?: number }>) ?? [];
    if (markets.length > 0) {
      markets.sort((a, b) => (a.lastUpdated ?? 0) - (b.lastUpdated ?? 0));
      const minKeep = 100;
      let removedBytes = 0;
      while (markets.length > minKeep && currentBytes > target) {
        const removed = markets.shift();
        const bytes = estimateBytes(removed);
        removedBytes += bytes;
        currentBytes -= bytes;
        pruned = true;
      }
      await browser.storage.local.set({ [CONFIG.storage.collectedMarkets]: markets });
      trackBytes(CONFIG.storage.collectedMarkets, -removedBytes);
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