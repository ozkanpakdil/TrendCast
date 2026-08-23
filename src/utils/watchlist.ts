/**
 * Watchlist schema helpers.
 *
 * The `WatchlistEntry` type carries an optional `version` field so old stored
 * records (which lack it) load without crashing. `backfillWatchlist` upgrades
 * old records to the current schema version on read — lazily and idempotently.
 */

import type { WatchlistEntry } from '@/types';

/** The current watchlist schema version. */
export const WATCHLIST_VERSION = 1;

/**
 * Backfill old watchlist records to the current schema version.
 *
 * Pure function (no storage I/O) so it is unit-testable. Idempotent: an entry
 * that already has a `version` is left unchanged — never overwrite a present
 * value, never downgrade a future version.
 */
export function backfillWatchlist(entries: WatchlistEntry[]): WatchlistEntry[] {
  return entries.map((entry) => ({
    ...entry,
    version: entry.version ?? WATCHLIST_VERSION,
  }));
}
