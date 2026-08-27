/**
 * Integration tests for the settings storage I/O wiring (SRC-05).
 *
 * The pure-function helpers (`deepMergeSettings`, `migrateEnabledSources`) and
 * their unit tests already cover the three new stock-indicator flags
 * (`usaStocksIndicator`, `stockScreener`, `stockScreener2`). These tests close
 * the gap on the storage I/O layer that the background worker uses — proving
 * the real read → deep-merge → migrate → conditional-write path end-to-end.
 *
 * The functions take a `SettingsStorage` parameter (structurally satisfied by
 * `browser.storage.local`), so we drive them with an in-memory mock — no
 * `vi.mock` of the messaging layer required.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CONFIG } from '@/config';
import { getSettingsFromStorage, migrateEnabledSourcesFromStorage } from '@/utils/settings';
import { DEFAULT_SETTINGS } from '@/types';
import type { ExtensionSettings } from '@/types';

// ── In-memory SettingsStorage mock ───────────────────────────────
function makeStorage() {
  const store = new Map<string, unknown>();
  const get = vi.fn(async (keys: string) => {
    const out: Record<string, unknown> = {};
    out[keys] = store.get(keys);
    return out;
  });
  const set = vi.fn(async (items: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(items)) store.set(k, v);
  });
  return { store, get, set };
}

/** A stored settings object missing the three stock-indicator flags. */
function staleSettings(): Partial<ExtensionSettings> {
  return {
    collectionIntervalMinutes: 60,
    theme: 'dark',
    enabledSources: {
      polymarket: true,
      kalshi: true,
      x: true,
      reddit: true,
      tiktok: true,
      bbc: true,
      cnn: true,
      yahoo: true,
      googleFinance: true,
      seekingalpha: true,
      investing: true,
      // NOTE: usaStocksIndicator, stockScreener, stockScreener2 intentionally omitted
    } as ExtensionSettings['enabledSources'],
  };
}

describe('getSettingsFromStorage (SRC-05)', () => {
  let storage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    storage = makeStorage();
  });

  it('backfills the three new source flags to true when absent', async () => {
    storage.store.set(CONFIG.storage.settings, staleSettings());
    const result = await getSettingsFromStorage(storage);
    expect(result.enabledSources.usaStocksIndicator).toBe(true);
    expect(result.enabledSources.stockScreener).toBe(true);
    expect(result.enabledSources.stockScreener2).toBe(true);
    // Pre-existing stored keys preserved.
    expect(result.enabledSources.polymarket).toBe(true);
    expect(result.enabledSources.yahoo).toBe(true);
    // Top-level stored fields preserved.
    expect(result.collectionIntervalMinutes).toBe(60);
    expect(result.theme).toBe('dark');
  });

  it('preserves an explicit stockScreener:false while backfilling the other new flags', async () => {
    const stored = staleSettings();
    stored.enabledSources = { ...stored.enabledSources!, stockScreener: false };
    storage.store.set(CONFIG.storage.settings, stored);
    const result = await getSettingsFromStorage(storage);
    expect(result.enabledSources.stockScreener).toBe(false);
    expect(result.enabledSources.usaStocksIndicator).toBe(true);
    expect(result.enabledSources.stockScreener2).toBe(true);
  });

  it('returns defaults when no settings are stored', async () => {
    const result = await getSettingsFromStorage(storage);
    expect(result).toEqual(DEFAULT_SETTINGS);
  });
});

describe('migrateEnabledSourcesFromStorage (SRC-05)', () => {
  let storage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    storage = makeStorage();
  });

  it('writes the backfilled settings to storage', async () => {
    storage.store.set(CONFIG.storage.settings, staleSettings());
    await migrateEnabledSourcesFromStorage(storage);
    expect(storage.set).toHaveBeenCalledTimes(1);
    const stored = storage.store.get(CONFIG.storage.settings) as ExtensionSettings;
    expect(stored.enabledSources.usaStocksIndicator).toBe(true);
    expect(stored.enabledSources.stockScreener).toBe(true);
    expect(stored.enabledSources.stockScreener2).toBe(true);
  });

  it('is idempotent — no write when nothing to migrate', async () => {
    storage.store.set(CONFIG.storage.settings, {
      enabledSources: { ...DEFAULT_SETTINGS.enabledSources },
    });
    await migrateEnabledSourcesFromStorage(storage);
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('preserves an explicit stockScreener:false in storage while backfilling the other new flags', async () => {
    const stored = staleSettings();
    stored.enabledSources = { ...stored.enabledSources!, stockScreener: false };
    storage.store.set(CONFIG.storage.settings, stored);
    await migrateEnabledSourcesFromStorage(storage);
    const persisted = storage.store.get(CONFIG.storage.settings) as ExtensionSettings;
    expect(persisted.enabledSources.stockScreener).toBe(false);
    expect(persisted.enabledSources.usaStocksIndicator).toBe(true);
    expect(persisted.enabledSources.stockScreener2).toBe(true);
  });
});
