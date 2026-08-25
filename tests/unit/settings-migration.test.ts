/**
 * Unit tests for the settings source-flags migration (NEWS-02).
 *
 * Verifies `migrateEnabledSources` backfills missing news source flags
 * (`seekingalpha`, `investing`, `googleFinance`) into a stored settings object
 * so the deep-merge fix persists across restarts. It must be pure, idempotent,
 * and never overwrite an explicit user preference.
 */

import { describe, it, expect } from 'vitest';
import { migrateEnabledSources } from '@/utils/settings';
import { DEFAULT_SETTINGS } from '@/types';
import type { ExtensionSettings } from '@/types';

/** A stored settings object missing the newer source flags (pre-fix shape). */
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
      // NOTE: googleFinance, seekingalpha, investing intentionally omitted
    } as Partial<ExtensionSettings['enabledSources']> as ExtensionSettings['enabledSources'],
  };
}

describe('migrateEnabledSources (NEWS-02)', () => {
  it('returns null for undefined stored', () => {
    expect(migrateEnabledSources(undefined)).toBeNull();
  });

  it('backfills missing source flags and preserves all other stored keys', () => {
    const stored = staleSettings();
    const out = migrateEnabledSources(stored);
    expect(out).not.toBeNull();
    const enabled = out!.enabledSources!;
    expect(enabled.googleFinance).toBe(true);
    expect(enabled.seekingalpha).toBe(true);
    expect(enabled.investing).toBe(true);
    // All pre-existing stored keys preserved.
    expect(enabled.polymarket).toBe(true);
    expect(enabled.yahoo).toBe(true);
    // Top-level stored fields preserved.
    expect(out!.collectionIntervalMinutes).toBe(60);
    expect(out!.theme).toBe('dark');
  });

  it('preserves an explicit seekingalpha:false preference (never flips to true)', () => {
    const stored = staleSettings();
    stored.enabledSources = { ...stored.enabledSources!, seekingalpha: false };
    const out = migrateEnabledSources(stored);
    expect(out).not.toBeNull();
    expect(out!.enabledSources!.seekingalpha).toBe(false);
    // Other missing flags still backfilled.
    expect(out!.enabledSources!.investing).toBe(true);
    expect(out!.enabledSources!.googleFinance).toBe(true);
  });

  it('returns null for a fully-populated enabledSources (idempotent)', () => {
    const stored = staleSettings();
    stored.enabledSources = { ...DEFAULT_SETTINGS.enabledSources };
    expect(migrateEnabledSources(stored)).toBeNull();
  });

  it('returns null for a non-object enabledSources without throwing', () => {
    const stored = staleSettings();
    stored.enabledSources = 'corrupted' as unknown as ExtensionSettings['enabledSources'];
    expect(migrateEnabledSources(stored)).toBeNull();
  });

  it('preserves ALL stored keys and only adds the missing source flags', () => {
    const stored = staleSettings();
    stored.redditSubreddits = ['r/technology', 'r/worldnews'];
    const out = migrateEnabledSources(stored);
    expect(out).not.toBeNull();
    expect(out!.collectionIntervalMinutes).toBe(60);
    expect(out!.theme).toBe('dark');
    expect(out!.redditSubreddits).toEqual(['r/technology', 'r/worldnews']);
    // Only the missing source flags were added.
    expect(out!.enabledSources!.googleFinance).toBe(true);
    expect(out!.enabledSources!.seekingalpha).toBe(true);
    expect(out!.enabledSources!.investing).toBe(true);
  });

  it('is idempotent — a second run on the migrated result returns null', () => {
    const stored = staleSettings();
    const first = migrateEnabledSources(stored);
    expect(first).not.toBeNull();
    expect(migrateEnabledSources(first!)).toBeNull();
  });

  it('backfills only googleFinance when seekingalpha/investing are already present', () => {
    const stored = staleSettings();
    stored.enabledSources = {
      ...stored.enabledSources!,
      seekingalpha: true,
      investing: true,
      // googleFinance still missing
    };
    const out = migrateEnabledSources(stored);
    expect(out).not.toBeNull();
    expect(out!.enabledSources!.googleFinance).toBe(true);
    expect(out!.enabledSources!.seekingalpha).toBe(true);
    expect(out!.enabledSources!.investing).toBe(true);
  });

  it('returns a NEW reference and does not mutate stored', () => {
    const stored = staleSettings();
    const out = migrateEnabledSources(stored);
    expect(out).not.toBeNull();
    expect(out).not.toBe(stored);
    expect(out!.enabledSources).not.toBe(stored.enabledSources);
    // stored untouched — still missing the newer flags.
    expect(stored.enabledSources!.googleFinance).toBeUndefined();
    expect(stored.enabledSources!.seekingalpha).toBeUndefined();
    expect(stored.enabledSources!.investing).toBeUndefined();
  });

  it('backfills the three stock-indicator flags to true when absent', () => {
    const stored = staleSettings();
    const out = migrateEnabledSources(stored);
    expect(out).not.toBeNull();
    expect(out!.enabledSources!.usaStocksIndicator).toBe(true);
    expect(out!.enabledSources!.stockScreener).toBe(true);
    expect(out!.enabledSources!.stockScreener2).toBe(true);
  });

  it('preserves an explicit stockScreener:false while backfilling the other new flags', () => {
    const stored = staleSettings();
    stored.enabledSources = { ...stored.enabledSources!, stockScreener: false };
    const out = migrateEnabledSources(stored);
    expect(out).not.toBeNull();
    expect(out!.enabledSources!.stockScreener).toBe(false);
    expect(out!.enabledSources!.usaStocksIndicator).toBe(true);
    expect(out!.enabledSources!.stockScreener2).toBe(true);
  });
});
