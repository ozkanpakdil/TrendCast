# Phase 6: Watchlist & Export - Context

**Gathered:** 2026-08-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver watchlist organization (sort/filter/correlation-status badges) and export coverage for new sources (market-driven categories), all backward-compatible with existing stored data and the existing export format. The watchlist currently only sorts by `addedAt` and shows odds; export currently covers markets/signals/news/correlations but not the new `category` field on news or the market-driven view. This phase adds sort/filter controls, a per-market correlation-status badge, a schema migration for `WatchlistEntry`, and export coverage for the new `category` field.

**In scope:** Watchlist sort (addedAt/volume) + filter (platform); per-market correlation-status badge (none / has-correlation with direction bull/bear/mixed); `WatchlistEntry` schema version + backfill on read; export adds `category` as a trailing column on the existing News section (backward-compatible).

**Out of scope:** TikTok collector (Phase 7), storage caps / ML quantization (Phase 8), market-driven news view (Phase 5 — already done). No new runtime dependencies, no backend.

</domain>

<decisions>
## Implementation Decisions

### Export Format
- **D-01:** Keep the existing CSV/JSON export **backward-compatible** — existing sections and column order unchanged. New data is added as **append-only** so existing consumers (positional CSV readers) are not broken. — **Reversibility:** reversible — additive export sections.
- **D-02:** Add the `category` field as a **trailing column** on the existing `# News` CSV section (and `category` field on news objects in JSON). Existing columns stay in the same order/position; only a trailing column is appended. — **Reversibility:** costly — changes the News section header; existing positional readers that don't expect the extra column are unaffected (trailing), but header-aware readers see a new column.
- **D-03:** Do **not** add a separate `# Market-Driven News` export section in this phase — the market-driven categories surface via the `category` column on news rows. TikTok signals export is deferred to Phase 7 (collector doesn't exist yet). — **Reversibility:** reversible — can add sections later.

### Watchlist Sort & Filter
- **D-04:** Add **sort controls** to the watchlist: `addedAt` (default, current behavior) and `volume24h`. — **Reversibility:** reversible — UI-only.
- **D-05:** Add **filter controls** by `platform` (polymarket / kalshi). — **Reversibility:** reversible — UI-only.
- **D-06:** Keep the sort/filter set **minimal** — no price-delta or correlation-confidence sort, no has-correlation filter in this phase. — **Reversibility:** reversible — can extend later.

### Correlation-Status Badge
- **D-07:** Show a per-market **correlation-status badge** on each watchlist entry: `none` (no correlation) or `has-correlation` with a **direction** (bull/bear/neutral). Reuses the alert direction logic. — **Reversibility:** reversible — UI-only.

### Schema Migration
- **D-08:** Add a **version field** to `WatchlistEntry` and **backfill on read** — old stored data without the new field loads without crashing (default missing fields). — **Reversibility:** one-way — changes the stored `WatchlistEntry` shape; needs a migration for old data.

### the agent's Discretion
The agent has discretion on implementation details not covered above: exact badge styling, sort/filter UI placement, the `WatchlistEntry` version field name/value, and the backfill logic — following the research (ARCHITECTURE.md, PITFALLS.md Pitfall 8, FEATURES.md).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` §DASH-01, §DASH-02 — The requirements this phase delivers: sort/filter watchlist + correlation status; export covering new sources.
- `.planning/ROADMAP.md` §Phase 6 — Goal, success criteria (3 items), depends-on (Phase 4), requirements mapping.

### Research (authoritative on approach)
- `.planning/research/ARCHITECTURE.md` §Pattern 8 (Watchlist/Export) — Schema migration (version field + backfill on read), backward-compatible export (append sections, don't change columns), preserve virtualization (`VirtualizedGrid`).
- `.planning/research/PITFALLS.md` §Pitfall 8 — Watchlist/export improvements break existing data or regress the dashboard: schema migration, backward-compatible export, preserve virtualization.
- `.planning/research/FEATURES.md` §Watchlist sort/filter/correlation status, §Export coverage for new sources — Feature rationale and scope.

### Existing Code
- `src/dashboard/components/Watchlist.tsx` — Current watchlist (sort by addedAt only, odds display, star toggle).
- `src/utils/export.ts` — Current export (markets/signals/news/correlations sections).
- `src/types/index.ts` §WatchlistEntry — Current stored shape (contractId, platform, question, addedAt).
- `src/background/index.ts` §Watchlist helpers — `getWatchlist`, `ADD_TO_WATCHLIST`, `REMOVE_FROM_WATCHLIST`, `GET_WATCHLIST` handlers.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Watchlist.tsx` (`WatchlistImpl`): Existing watchlist component — extend with sort/filter controls and correlation badge.
- `export.ts` (`exportToCsv`, `exportToJson`): Existing export — add `category` trailing column to News section.
- `WatchlistEntry` type: Add version field + backfill.
- `VirtualizedGrid`: Preserve virtualization for watchlist rendering (Pitfall 8).

### Established Patterns
- Storage via `chrome.storage.local` + `browser.storage.onChanged` listener (Watchlist.tsx).
- Messaging via `sendMessage` (`GET_WATCHLIST`, `ADD_TO_WATCHLIST`, `REMOVE_FROM_WATCHLIST`).
- Direction logic from Phase 4 alerts (bull/bear/neutral) reused for correlation badge.

### Integration Points
- `Watchlist.tsx` — add sort/filter/badge UI.
- `export.ts` — add `category` to News export.
- `types/index.ts` — extend `WatchlistEntry` with version field.
- `background/index.ts` — watchlist handlers (may need to return correlation status).

</code_context>
