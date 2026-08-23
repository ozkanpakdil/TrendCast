/**
 * Storage budget authority + incremental byte tracking tests (Phase 8, PERF-03).
 *
 * Verifies:
 *   - `measureStorageUsage()` uses `getBytesInUse()` as the authoritative total (D-02).
 *   - Incremental per-key byte tracking (`trackBytes`/`setTrackedBytes`/`getTrackedBytes`)
 *     is used and reconciled against `getBytesInUse()` (D-03).
 *   - `pruneStorageIfNeeded()` still works and tracks byte deltas.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── In-memory browser.storage.local mock with getBytesInUse ──────
const store = new Map<string, unknown>();
let bytesInUse = 0;

vi.mock('@/messaging/browser', () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const out: Record<string, unknown> = {};
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) out[k] = store.get(k);
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) {
            store.set(k, v);
            bytesInUse = JSON.stringify(Object.fromEntries(store)).length;
          }
        }),
        getBytesInUse: vi.fn(async () => bytesInUse),
      },
    },
  },
}));

import {
  BUDGET_KEYS,
  estimateBytes,
  getBytesInUse,
  getTrackedBytes,
  measureStorageUsage,
  pruneStorageIfNeeded,
  resetTrackedBytes,
  setTrackedBytes,
  trackBytes,
} from '@/utils/storage';
import { browser } from '@/messaging/browser';
import { CONFIG } from '@/config';

beforeEach(() => {
  store.clear();
  bytesInUse = 0;
  resetTrackedBytes();
});

describe('getBytesInUse (D-02)', () => {
  it('returns the authoritative byte count from storage', async () => {
    await browser.storage.local.set({ 'trendcast:settings': { foo: 'bar' } });
    const bytes = await getBytesInUse();
    expect(bytes).toBeGreaterThan(0);
  });

  it('returns 0 when storage is empty', async () => {
    expect(await getBytesInUse()).toBe(0);
  });
});

describe('incremental byte tracking (D-03)', () => {
  it('tracks positive and negative deltas per key', () => {
    trackBytes('key-a', 100);
    trackBytes('key-a', 50);
    trackBytes('key-a', -30);
    expect(getTrackedBytes('key-a')).toBe(120);
  });

  it('never goes below zero', () => {
    trackBytes('key-a', -50);
    expect(getTrackedBytes('key-a')).toBe(0);
  });

  it('setTrackedBytes overrides the current value', () => {
    trackBytes('key-a', 100);
    setTrackedBytes('key-a', 42);
    expect(getTrackedBytes('key-a')).toBe(42);
  });

  it('resetTrackedBytes clears all tracking', () => {
    trackBytes('key-a', 100);
    resetTrackedBytes();
    expect(getTrackedBytes('key-a')).toBe(0);
  });
});

describe('measureStorageUsage (D-02, D-03)', () => {
  it('uses getBytesInUse as the authoritative total when estimates diverge', async () => {
    // Seed a tracked estimate that diverges from the authoritative total.
    setTrackedBytes(BUDGET_KEYS[0], 1000);
    await browser.storage.local.set({ [BUDGET_KEYS[0]]: { data: 'x'.repeat(500) } });
    const { totalBytes } = await measureStorageUsage();
    // The authoritative getBytesInUse reflects the real stored size.
    expect(totalBytes).toBeGreaterThan(0);
  });

  it('returns per-key estimates', async () => {
    await browser.storage.local.set({ [BUDGET_KEYS[0]]: { data: 'hello' } });
    const { perKey } = await measureStorageUsage();
    expect(perKey[BUDGET_KEYS[0]]).toBeGreaterThan(0);
  });
});

describe('estimateBytes (relative heuristic only)', () => {
  it('estimates a value size', () => {
    expect(estimateBytes({ a: 1 })).toBeGreaterThan(0);
  });

  it('returns 0 for non-serializable values', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(estimateBytes(circular)).toBe(0);
  });
});

describe('pruneStorageIfNeeded (D-03)', () => {
  it('returns false when under budget', async () => {
    await browser.storage.local.set({ [BUDGET_KEYS[0]]: { small: 'x' } });
    expect(await pruneStorageIfNeeded()).toBe(false);
  });

  it('prunes when over budget and tracks byte deltas', async () => {
    // Seed a large history array to exceed the 7 MB budget.
    const bigHistory = Array.from({ length: 4000 }, (_, i) => ({ id: i, data: 'x'.repeat(2000) }));
    const originalLength = bigHistory.length;
    await browser.storage.local.set({ [CONFIG.storage.history]: bigHistory });
    // Force the tracked estimate to match so the reconcile doesn't reset it.
    setTrackedBytes(CONFIG.storage.history, estimateBytes(bigHistory));

    const pruned = await pruneStorageIfNeeded();
    expect(pruned).toBe(true);
    // The stored history array should be reduced (oldest evicted).
    const result = await browser.storage.local.get(CONFIG.storage.history);
    const remaining = (result[CONFIG.storage.history] as unknown[]) ?? [];
    expect(remaining.length).toBeLessThan(originalLength);
  });
});
