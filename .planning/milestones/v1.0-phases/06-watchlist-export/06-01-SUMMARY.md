# 06-01 SUMMARY — Watchlist schema migration (D-08)

**Status:** Complete
**Plan:** 06-01 (wave 1)
**Requirement:** DASH-01

## What was done

Added a `version` field to `WatchlistEntry` and a pure, idempotent `backfillWatchlist` helper so old stored records (which lack the field) load without crashing after the schema change.

### Files changed
- `src/types/index.ts` — added optional `version?: number` to `WatchlistEntry` with a doc comment describing the backfill contract.
- `src/utils/watchlist.ts` — **new**: `WATCHLIST_VERSION = 1` + pure `backfillWatchlist(entries)` (idempotent, never downgrades).
- `src/background/index.ts` — `getWatchlist()` now returns `backfillWatchlist(...)`; added import.
- `src/dashboard/components/Watchlist.tsx` — storage-fallback read path now backfills; added import.
- `src/dashboard/components/MarketOdds.tsx` — new watchlist entries set `version: WATCHLIST_VERSION`; added import.
- `tests/unit/watchlist-migration.test.ts` — **new**: 5 tests (empty, old-format backfill, idempotent, no-downgrade, version constant).

## Verification
- `bun run test -- tests/unit/watchlist-migration.test.ts` — **5/5 pass**
- `bun run typecheck` — **clean**

## Decisions honored
- **D-08**: `version: 1`, optional field, read-time backfill in `getWatchlist()` + dashboard fallback, new entries set `version` at creation.

## Reversibility
- Task 1 (schema field + helper): one-way — needs the backfill migration for old data.
- Task 2 (wiring): reversible — read-time transform + creation-site field.
