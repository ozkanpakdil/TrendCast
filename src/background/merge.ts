/**
 * Storage merge helpers (Phase 8, PERF-03).
 *
 * Deduplicate incoming collection data by ID (keeping newest) and enforce
 * per-key storage caps at write time so no single collection key can grow
 * unboundedly. Extracted from `src/background/index.ts` into a pure module
 * so the cap logic is unit-testable without the full background worker.
 *
 * Design decisions (see 08-CONTEXT.md):
 *   - D-01: Enforce `CONFIG.storageBudget.maxSignals/maxNews/maxMarkets` at
 *           write time, evicting oldest-first by the item's date field.
 */

import { CONFIG } from '@/config';
import type { MarketContract, NewsItem, SocialSignal } from '@/types';

/**
 * Cap an array to `cap` items, evicting oldest-first by the given date field.
 * The date field may be an ISO string (`timestamp`, `publishedAt`) or a
 * numeric epoch ms (`lastUpdated`). Items without a parseable date are
 * treated as oldest (evicted first).
 */
export function capByOldest<T>(items: T[], cap: number, dateKey: keyof T): T[] {
  if (items.length <= cap) return items;
  const sorted = [...items].sort((a, b) => {
    const va = a[dateKey];
    const vb = b[dateKey];
    const da = typeof va === 'number' ? va : new Date(String(va ?? '')).getTime();
    const db = typeof vb === 'number' ? vb : new Date(String(vb ?? '')).getTime();
    return (Number.isNaN(da) ? 0 : da) - (Number.isNaN(db) ? 0 : db);
  });
  return sorted.slice(-cap);
}

export function mergeMarkets(existing: MarketContract[], incoming: MarketContract[]): MarketContract[] {
  const map = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) {
    const prev = map.get(m.id);
    if (!prev || m.lastUpdated > prev.lastUpdated) {
      map.set(m.id, m);
    }
  }
  return capByOldest(Array.from(map.values()), CONFIG.storageBudget.maxMarkets, 'lastUpdated');
}

export function mergeSignals(existing: SocialSignal[], incoming: SocialSignal[]): SocialSignal[] {
  const map = new Map(existing.map((s) => [s.id, s]));
  for (const s of incoming) {
    map.set(s.id, s); // always overwrite signals (newer = more recent)
  }
  // Enforce the per-key cap (PERF-03, D-01): evict oldest-first by timestamp.
  return capByOldest(Array.from(map.values()), CONFIG.storageBudget.maxSignals, 'timestamp');
}

export function mergeNews(existing: NewsItem[], incoming: NewsItem[]): NewsItem[] {
  const map = new Map(existing.map((n) => [n.id, n]));
  for (const n of incoming) {
    map.set(n.id, n);
  }
  // Enforce the per-key cap (PERF-03, D-01): evict oldest-first by publishedAt.
  // The cap is a defensive ceiling; the byte-budget pruner still protects the
  // chrome.storage.local quota by evicting oldest items when over budget.
  return capByOldest(Array.from(map.values()), CONFIG.storageBudget.maxNews, 'publishedAt');
}
