# 06-02 SUMMARY — Watchlist sort/filter + correlation badge (D-04, D-05, D-06, D-07)

**Status:** Complete
**Plan:** 06-02 (wave 2, depends 06-01)
**Requirement:** DASH-01

## What was done

Added sort controls (`addedAt` default, `volume24h`), filter controls (`platform`), and a per-market correlation-status badge to the watchlist, reusing the alert direction color contract.

### Files changed
- `src/dashboard/utils/watchlistView.ts` — **new**: pure, unit-testable module exporting `WatchlistSort`, `WatchlistPlatformFilter`, `CorrelationStatus`, `CorrelationDirection`, `sortWatchlist`, `filterWatchlist`, `correlationStatusFor`, `correlationDirectionFor`.
- `src/dashboard/components/Watchlist.tsx` — added sort/filter `<select>` controls, a `view` memo (filter → sort), and a per-entry correlation-status badge (none / bull / bear / neutral) using the `correlationBadges` color contract.
- `src/dashboard/App.tsx` — passes `correlations` (from `useCorrelations`) to `<Watchlist>`.
- `tests/unit/watchlist-sort-filter.test.ts` — **new**: 13 tests (addedAt sort, volume24h sort, no-live-market-last, platform filter, correlation status, direction).

## Verification
- `bun run test -- tests/unit/watchlist-sort-filter.test.ts` — **13/13 pass**
- `bun run typecheck` — **clean**

## Decisions honored
- **D-04**: sort by `addedAt` (default) or `volume24h`.
- **D-05**: filter by `platform` (polymarket / kalshi).
- **D-06**: minimal sort/filter set — no price-delta/confidence sort, no has-correlation filter.
- **D-07**: correlation-status badge (none / has-correlation with direction bull/bear/neutral).

## Reversibility
- Task 1 (pure module): reversible — new module, no contract.
- Task 2 (UI): reversible — controls and badge can be adjusted without contract impact.
