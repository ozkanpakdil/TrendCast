/**
 * Unit tests for the watchlist schema migration (D-08).
 *
 * Verifies `backfillWatchlist` upgrades old-format records (no `version` field)
 * to the current schema version on read, without crashing, and is idempotent
 * (never overwrites a present value, never downgrades a future version).
 */

import { describe, it, expect } from 'vitest';
import { WATCHLIST_VERSION, backfillWatchlist } from '@/utils/watchlist';
import type { WatchlistEntry } from '@/types';

/** An old-format entry (pre-version field). */
function oldEntry(overrides: Partial<WatchlistEntry> = {}): WatchlistEntry {
  return {
    contractId: 'btc-100k',
    platform: 'polymarket',
    question: 'Will Bitcoin close above $100k on Dec 31?',
    addedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('backfillWatchlist (D-08)', () => {
  it('returns [] for empty input', () => {
    expect(backfillWatchlist([])).toEqual([]);
  });

  it('backfills an old-format entry (no version) to WATCHLIST_VERSION', () => {
    const entry = oldEntry();
    const out = backfillWatchlist([entry]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ ...entry, version: WATCHLIST_VERSION });
    expect(out[0].version).toBe(1);
  });

  it('leaves an entry that already has the current version unchanged (idempotent)', () => {
    const entry = oldEntry({ version: 1 });
    const out = backfillWatchlist([entry]);
    expect(out[0]).toEqual(entry);
  });

  it('never downgrades a future version', () => {
    const entry = oldEntry({ version: 2 });
    const out = backfillWatchlist([entry]);
    expect(out[0]).toEqual(entry);
    expect(out[0].version).toBe(2);
  });

  it('WATCHLIST_VERSION equals 1', () => {
    expect(WATCHLIST_VERSION).toBe(1);
  });
});
