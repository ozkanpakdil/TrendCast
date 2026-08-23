/**
 * deepMergeSettings unit tests (Phase 9, NEWS-01).
 *
 * Verifies the deep-merge backfills newer source flags (`seekingalpha`,
 * `investing`, `googleFinance`) to `true` for existing users with partial saved
 * settings, while preserving explicit user preferences.
 */

import { describe, it, expect } from 'vitest';
import { deepMergeSettings } from '@/utils/settings';
import { DEFAULT_SETTINGS } from '@/types';

describe('deepMergeSettings', () => {
  it('returns defaults unchanged when stored is undefined', () => {
    const result = deepMergeSettings(DEFAULT_SETTINGS, undefined);
    expect(result).toBe(DEFAULT_SETTINGS);
  });

  it('backfills missing source flags to true for a partial enabledSources', () => {
    const stored = {
      enabledSources: {
        polymarket: true,
        kalshi: true,
        x: true,
        reddit: true,
        tiktok: true,
        bbc: true,
        cnn: true,
        yahoo: true,
        // googleFinance, seekingalpha, investing missing (older saved settings)
      },
    } as Partial<typeof DEFAULT_SETTINGS>;
    const result = deepMergeSettings(DEFAULT_SETTINGS, stored);
    expect(result.enabledSources.googleFinance).toBe(true);
    expect(result.enabledSources.seekingalpha).toBe(true);
    expect(result.enabledSources.investing).toBe(true);
  });

  it('preserves an explicit seekingalpha: false preference', () => {
    const stored = {
      enabledSources: {
        ...DEFAULT_SETTINGS.enabledSources,
        seekingalpha: false,
      },
    };
    const result = deepMergeSettings(DEFAULT_SETTINGS, stored);
    expect(result.enabledSources.seekingalpha).toBe(false);
  });

  it('lets a top-level stored field override the default', () => {
    const stored = { collectionIntervalMinutes: 30 };
    const result = deepMergeSettings(DEFAULT_SETTINGS, stored);
    expect(result.collectionIntervalMinutes).toBe(30);
  });

  it('falls back to defaults.enabledSources for a non-object enabledSources', () => {
    const stored = { enabledSources: 'corrupted' as unknown as typeof DEFAULT_SETTINGS.enabledSources };
    const result = deepMergeSettings(DEFAULT_SETTINGS, stored);
    expect(result.enabledSources).toEqual(DEFAULT_SETTINGS.enabledSources);
  });

  it('preserves an explicit bbc:false while backfilling all other missing flags (mixed explicit-off + default-on)', () => {
    const stored = {
      enabledSources: { bbc: false },
    } as Partial<typeof DEFAULT_SETTINGS>;
    const result = deepMergeSettings(DEFAULT_SETTINGS, stored);
    expect(result.enabledSources.bbc).toBe(false);
    expect(result.enabledSources.seekingalpha).toBe(true);
    expect(result.enabledSources.investing).toBe(true);
    expect(result.enabledSources.googleFinance).toBe(true);
    expect(result.enabledSources.cnn).toBe(true);
    expect(result.enabledSources.yahoo).toBe(true);
  });

  it('returns a NEW reference and does not mutate defaults or stored', () => {
    const stored = {
      enabledSources: { bbc: false },
    } as Partial<typeof DEFAULT_SETTINGS>;
    const result = deepMergeSettings(DEFAULT_SETTINGS, stored);
    expect(result).not.toBe(DEFAULT_SETTINGS);
    expect(result.enabledSources).not.toBe(DEFAULT_SETTINGS.enabledSources);
    // defaults untouched
    expect(DEFAULT_SETTINGS.enabledSources.bbc).toBe(true);
    // stored untouched
    expect(stored.enabledSources).toEqual({ bbc: false });
  });

  it('preserves multiple explicit false preferences (seekingalpha + investing)', () => {
    const stored = {
      enabledSources: {
        ...DEFAULT_SETTINGS.enabledSources,
        seekingalpha: false,
        investing: false,
      },
    };
    const result = deepMergeSettings(DEFAULT_SETTINGS, stored);
    expect(result.enabledSources.seekingalpha).toBe(false);
    expect(result.enabledSources.investing).toBe(false);
  });

  it('lets stored top-level scalars override defaults while unspecified fields keep defaults', () => {
    const stored = {
      collectionIntervalMinutes: 30,
      theme: 'light',
    } as Partial<typeof DEFAULT_SETTINGS>;
    const result = deepMergeSettings(DEFAULT_SETTINGS, stored);
    expect(result.collectionIntervalMinutes).toBe(30);
    expect(result.theme).toBe('light');
    // Unspecified top-level field keeps the default.
    expect(result.maxHistoryEntries).toBe(DEFAULT_SETTINGS.maxHistoryEntries);
  });
});
