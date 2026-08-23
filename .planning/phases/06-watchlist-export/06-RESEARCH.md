# Phase 6: Watchlist & Export - Research

**Researched:** 2026-08-23
**Status:** Ready for planning

## Overview

Phase 6 delivers watchlist organization (sort/filter/correlation-status badges) and export coverage for new sources (market-driven categories), all backward-compatible with existing stored data and the existing export format. The research confirms this is LOW-complexity, well-understood work on the established React dashboard + storage stack — no new runtime dependencies, no backend.

## Key Findings

### 1. Export Format (D-01, D-02, D-03)

**Current state:** `src/utils/export.ts` exports 5 CSV sections (`# Markets`, `# Social Signals`, `# News`, `# Correlations (Social → Market)`, `# Correlations (News → Market)`) plus a JSON export. The `# News` section currently has columns: `id, source, headline, summary, url, publishedAt, keywords`.

**Decision:** Add `category` as a **trailing column** on the existing `# News` section (D-02). Existing columns stay in the same order/position; only a trailing column is appended. This is backward-compatible for positional CSV readers. The `NewsItem` type already has a `category?: NewsCategory` field (added in Phase 5), so the export just needs to read it.

**JSON export:** Add `category` to the news objects in `exportToJson`. The `ExportData` interface's `news: NewsItem[]` already carries the field.

**Deferred:** No separate `# Market-Driven News` section (D-03). TikTok signals export deferred to Phase 7.

### 2. Watchlist Sort & Filter (D-04, D-05, D-06)

**Current state:** `src/dashboard/components/Watchlist.tsx` (`WatchlistImpl`) sorts by `addedAt` (newest first) only, shows odds bar + platform badge + volume. It reads the watchlist via `sendMessage('GET_WATCHLIST')` with a storage fallback, and subscribes to `browser.storage.onChanged`.

**Decision:** Add sort controls (`addedAt` default, `volume24h`) and filter controls (`platform`). Minimal set (D-06) — no price-delta/correlation-confidence sort, no has-correlation filter.

**Implementation notes:**
- Sort/filter are **client-side** in the component (no background changes needed) — the watchlist is small and already loaded in full.
- `volume24h` comes from the live market data (`markets` prop) matched by `contractId` + `platform`.
- Filter by `platform` uses the existing `entry.platform` field.
- Preserve `VirtualizedGrid` for large watchlists (Pitfall 8) — though the current Watchlist uses a simple `.map()`, not VirtualizedGrid. Need to verify whether to convert to VirtualizedGrid or keep the simple list (watchlist is typically small).

### 3. Correlation-Status Badge (D-07)

**Current state:** `src/background/alerts.ts` exports `deriveDirection(contract, signals, news, priorYesPrice)` returning `'bullish' | 'bearish' | 'mixed'`. The dashboard has `useAlerts` hook and `AlertsTab` component with direction badges.

**Decision:** Show a per-market correlation-status badge: `none` (no correlation) or `has-correlation` with direction (bull/bear/neutral). Reuses alert direction logic.

**Implementation notes:**
- The badge needs to know, per watchlist market, whether it has a correlation and its direction.
- Options: (a) derive from the stored `correlations` snapshot in the dashboard, or (b) add a background message handler that returns correlation status per watchlist market.
- The `deriveDirection` function is the reusable logic — but it needs `signals`, `news`, and `priorYesPrice` which may not be readily available in the dashboard. Simpler: derive "has correlation" from the stored `correlations` snapshot (check if the contract appears in `matches` or `newsMatches`), and direction from the alert state or a simple sentiment/price check.

### 4. Schema Migration (D-08)

**Current state:** `WatchlistEntry` in `src/types/index.ts` has `{ contractId, platform, question, addedAt }`. Stored in `chrome.storage.local` under `CONFIG.storage.watchlist`.

**Decision:** Add a **version field** to `WatchlistEntry` and **backfill on read** — old stored data without the new field loads without crashing (default missing fields).

**Implementation notes:**
- Add `version?: number` (or a required `version` with backfill) to `WatchlistEntry`.
- Backfill in `getWatchlist()` in `src/background/index.ts` — when reading, map old entries to the new shape (default `version: 1`).
- Also backfill in the dashboard's `fetchWatchlist` fallback path (direct storage read).
- Test against old-format stored data (Pitfall 8) — load a snapshot with old records and verify no `undefined` crash.

## Pitfalls to Avoid (Pitfall 8)

1. **Schema drift** — adding a field to `WatchlistEntry` without migration → old data crashes. Mitigate: version field + backfill on read.
2. **Export format breakage** — changing existing CSV columns breaks consumers. Mitigate: append-only (trailing column).
3. **Dashboard regression** — non-virtualized watchlist rows freeze the dashboard. Mitigate: preserve `VirtualizedGrid` / keep watchlist rendering bounded.
4. **Incomplete export** — new fields (category) missing from export. Mitigate: add `category` to News export.

## Recommended Approach

1. **Plan 06-01:** Schema migration — add `version` to `WatchlistEntry`, backfill in `getWatchlist()` + dashboard fallback, unit tests against old-format data.
2. **Plan 06-02:** Watchlist sort/filter + correlation badge — extend `Watchlist.tsx` with sort/filter controls and correlation-status badge, reuse `deriveDirection`/correlation snapshot.
3. **Plan 06-03:** Export coverage — add `category` trailing column to News CSV + JSON, unit tests for backward compatibility.

## Traps

- The `deriveDirection` function needs `signals`, `news`, `priorYesPrice` — the dashboard may not have these readily. Consider a simpler "has correlation + direction" derivation from the stored `correlations` snapshot + alert state.
- The current Watchlist uses a simple `.map()` (not VirtualizedGrid). Verify whether converting to VirtualizedGrid is needed for large watchlists or if the simple list is fine (watchlist is typically small).
- `NewsItem.category` is optional (`category?`), so export must handle `undefined` (empty string).
