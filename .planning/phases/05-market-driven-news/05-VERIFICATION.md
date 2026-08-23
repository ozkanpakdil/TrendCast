---
phase: 05-market-driven-news
verified: 2026-08-23T13:35:00Z
status: human_needed
score: 3/3 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps: []
human_verification:
  - test: "Open the built extension dashboard and switch to the '📰 Market News' tab; trigger a correlation (or use an existing snapshot) and confirm the view renders grouped by category (finance / politics / technology) with direction badges (▲/▼/◆), volume, and top correlated news headlines per market"
    expected: "The Market News tab shows the grouped-by-category view with direction badges, volume, and correlated news; empty state ('No market-driven news yet — run a correlation first.') shows before any correlation"
    why_human: "Visual appearance and user-flow completion of the React MarketDrivenNews component are not covered by unit tests (no component tests in this repo)"
  - test: "With a large number of notable markets/news, scroll the Market News tab and confirm the per-category lists stay responsive (no jank/freeze)"
    expected: "Per-category news lists render through VirtualizedGrid and remain smooth with large result sets (PERF-01 / D-12)"
    why_human: "Dashboard responsiveness is a performance-feel behavior that unit tests cannot observe; only the VirtualizedGrid reuse is verifiable in code"
  - test: "Run a correlation end-to-end in a real browser and confirm the derived marketNewsView snapshot is written to chrome.storage.local and appears in the Market News tab without a manual refresh"
    expected: "After a correlation completes, the background writes the snapshot to 'trendcast:market-news-view' and the dashboard updates via chrome.storage.onChanged"
    why_human: "The background storage write + storage-listener sync is real-time behavior across the MV3 worker and dashboard that unit tests mock and cannot observe in a real browser"
---

# Phase 5: Market-Driven News Verification Report

**Phase Goal:** Users can see a "market-driven news" view — important prediction markets and the news/direction they imply, organized by a consistent category taxonomy
**Verified:** 2026-08-23T13:35:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth   | Status     | Evidence       |
| --- | ------- | ---------- | -------------- |
| 1   | SC1 — User can open a "market-driven news" view that surfaces notable markets and the news/direction they imply across finance, politics, and technology | ✓ VERIFIED | `'market-news'` tab added to `Tab` union (App.tsx:56), nav array `['market-news', '📰 Market News']` (App.tsx:287), and render block (App.tsx:676). `MarketDrivenNews` component renders grouped-by-category sections with direction badges (▲/▼/◆), volume, and top correlated news. `buildMarketDrivenNews` (correlationNews.ts) filters notable markets (volume ≥ minVolume OR watchlisted), computes direction (Yes-price delta blended with mean news sentiment), and groups by category. 9/9 correlation-news tests pass (notable filter, direction, grouping, sort+cap, watchlist, backfill). |
| 2   | SC2 — User sees a consistent category taxonomy (reusing the existing Reddit categories) applied to both markets and news, with deterministic precedence (politics > finance > tech) | ✓ VERIFIED | `src/config/taxonomy.ts` is the single source: `NewsCategory`, `CATEGORY_ORDER = ['politics','finance','technology']`, `CATEGORY_RULES` (labels reuse `redditCategories`), `classifyCategory` with first-match-wins precedence. `category` persisted on `NewsItem` at collection time (news.ts:155). `MarketDrivenNews` imports `CATEGORY_ORDER`/`CATEGORY_RULES` (no hardcoded taxonomy). 9/9 taxonomy tests pass (precedence, mutual exclusivity, finance fallback, case-insensitivity). |
| 3   | SC3 — The view is a read-only derived projection over existing markets + news + correlations — no new collection, and it renders without regressing dashboard responsiveness | ✓ VERIFIED | `buildMarketDrivenNews` is a pure function over existing `result.newsMatches` + watchlist — no new collection, no new runtime deps. Snapshot written to `CONFIG.storage.marketNewsView` after each correlation (both hook points). `MarketDrivenNews` reuses `VirtualizedGrid` for per-category lists (D-12). `useMarketNews` reads the cached snapshot + listens to `chrome.storage.onChanged`. |

**Score:** 3/3 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/config/taxonomy.ts` | `NewsCategory`, `CategoryRule`, `CATEGORY_ORDER`, `CATEGORY_RULES`, `TAXONOMY_VERSION`, `classifyCategory` | ✓ VERIFIED | Single-source taxonomy; precedence politics > finance > tech; finance fallback; versioned. |
| `src/types/index.ts` | `category?: NewsCategory` on `NewsItem` | ✓ VERIFIED | Optional field (line 131) — backfilled on read for old records. |
| `src/services/collectors/news.ts` | `category: classifyCategory(headline)` at collection time | ✓ VERIFIED | Assigned in `collectFromSource` (line 155), persisted on each `NewsItem`. |
| `src/config/index.ts` | `CONFIG.storage.marketNewsView` + `CONFIG.marketNews.{minVolume,capPerCategory}` | ✓ VERIFIED | `marketNewsView: 'trendcast:market-news-view'` (line 168); `minVolume: 10_000`, `capPerCategory: 20` (lines 174-178). |
| `src/utils/storage.ts` | `CONFIG.storage.marketNewsView` in `BUDGET_KEYS` | ✓ VERIFIED | Line 32 — pruning accounts for the snapshot. |
| `src/background/correlationNews.ts` | `MarketDrivenNewsItem`, `MarketNewsView`, `buildMarketDrivenNews` | ✓ VERIFIED | Pure aggregation module; notable filter, direction, category grouping, sort, cap, backfill. |
| `src/background/index.ts` | `rebuildMarketNewsView()` wired after `runAlertSweep()` in both hook points | ✓ VERIFIED | Helper (line 294) + calls after `runAlertSweep()` in `runCorrelationAsync` (line 659) and `runCorrelationPrecompute` (line 801). |
| `src/dashboard/hooks/useMarketNews.ts` | `{ view, loading }` — load snapshot + `storage.onChanged` listener | ✓ VERIFIED | Reads `CONFIG.storage.marketNewsView` on mount; listener added/removed on mount/unmount. |
| `src/dashboard/components/MarketDrivenNews.tsx` | Grouped-by-category view with direction badges + `VirtualizedGrid` | ✓ VERIFIED | Memoized, theme-aware; imports `CATEGORY_ORDER`/`CATEGORY_RULES`; reuses `VirtualizedGrid`. |
| `src/dashboard/App.tsx` | `'market-news'` tab in union + nav + render | ✓ VERIFIED | Tab union (56), nav (287), render block (676). |
| `tests/unit/taxonomy.test.ts` | 9 tests | ✓ VERIFIED | Precedence, mutual exclusivity, finance fallback, case-insensitivity, constants — all pass. |
| `tests/unit/correlation-news.test.ts` | 9 tests | ✓ VERIFIED | Notable, direction, grouping, sort+cap, watchlist, backfill, empty — all pass. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| `classifyCategory` | `NewsItem.category` | `collectFromSource` assigns at collection time | ✓ WIRED | news.ts:155 — category persisted on each stored item. |
| `buildMarketDrivenNews` | `CONFIG.storage.marketNewsView` | `rebuildMarketNewsView` writes snapshot | ✓ WIRED | background/index.ts:301-306. |
| `rebuildMarketNewsView` | correlation completion | called after `runAlertSweep()` in both hook points | ✓ WIRED | Lines 659 + 801. |
| `useMarketNews` | `CONFIG.storage.marketNewsView` | `browser.storage.local.get` + `onChanged` | ✓ WIRED | Reads cached snapshot; updates on storage change. |
| `MarketDrivenNews` | `CATEGORY_ORDER`/`CATEGORY_RULES` | import from `@/config/taxonomy` | ✓ WIRED | No hardcoded taxonomy (Pitfall 3 avoided). |
| `MarketDrivenNews` | `VirtualizedGrid` | per-category news lists | ✓ WIRED | D-12 responsiveness. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `buildMarketDrivenNews` | `newsMatches` | stored `CorrelationResult.newsMatches` | ✓ | ✓ FLOWING — real correlation output, not static |
| `MarketDrivenNewsItem.direction` | `deriveDirection` | Yes-price + `sentimentScore(headline)` | ✓ | ✓ FLOWING — derived from real data |
| `MarketDrivenNewsItem.category` | `deriveCategory` | `NewsItem.category` / `classifyCategory` | ✓ | ✓ FLOWING — real persisted/backfilled category |
| `MarketDrivenNews` render | `view.categories[cat]` | `useMarketNews` snapshot | ✓ | ✓ FLOWING — real snapshot from storage |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Taxonomy classification + precedence | `bun run test -- tests/unit/taxonomy.test.ts` | 9/9 pass | ✓ PASS |
| Aggregation (notable/direction/category/sort/cap/backfill) | `bun run test -- tests/unit/correlation-news.test.ts` | 9/9 pass | ✓ PASS |
| Combined phase unit tests | `bun run test -- tests/unit/taxonomy.test.ts tests/unit/correlation-news.test.ts` | 18/18 pass | ✓ PASS |

### Probe Execution

No probes declared in PLAN/SUMMARY for this phase. SKIPPED.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| MKT-01 | 05-02, 05-03 | User can see a "market-driven news" view — important markets → news/direction they imply (finance + politics + tech) | ✓ SATISFIED | `buildMarketDrivenNews` aggregation + `marketNewsView` snapshot + `useMarketNews` hook + `MarketDrivenNews` component + `market-news` tab; 9/9 aggregation tests pass |
| MKT-02 | 05-01 | User sees a consistent category taxonomy (reuse Reddit categories across markets + news) | ✓ SATISFIED | Single-source `src/config/taxonomy.ts` + `category` persisted on `NewsItem` at collection + deterministic precedence (politics > finance > tech); 9/9 taxonomy tests pass |

**Orphaned requirements:** None. MKT-01 and MKT-02 are the only requirements mapped to Phase 5 and are both claimed by the plans and satisfied in the codebase.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | No `TBD`/`FIXME`/`XXX`/`PLACEHOLDER`/`coming soon`/`not yet implemented` debt markers | — | None found in any phase-modified file (`taxonomy.ts`, `correlationNews.ts`, `useMarketNews.ts`, `MarketDrivenNews.tsx`, `App.tsx`, `config/index.ts`, `types/index.ts`, `news.ts`, `storage.ts`, `background/index.ts`) |

No debt markers found. No stub patterns (no `return null`/empty-array-only implementations, no hardcoded-empty props) in the phase artifacts.

### Human Verification Required

The taxonomy, aggregation logic, wiring, and data flow are all verified by code inspection + passing behavioral unit tests. The following real-time/visual behaviors cannot be proven by unit tests and require manual confirmation in a real browser:

1. **Market News tab visual rendering** — Open the built extension's dashboard and switch to the "📰 Market News" tab. Confirm the view renders grouped by category (finance / politics / technology) with direction badges (▲/▼/◆), volume, and top correlated news headlines per section. Confirm the empty state ("No market-driven news yet — run a correlation first.") shows before any correlation.
2. **Dashboard responsiveness** — With a large number of notable markets per category, scroll the Market News tab and confirm the per-category lists stay responsive (no jank/freeze). This validates the `VirtualizedGrid` reuse (D-12 / PERF-1).
3. **End-to-end snapshot sync** — Trigger a correlation in a real browser and confirm the `marketNewsView` snapshot is written to `chrome.storage.local` and appears in the Market News tab without a manual refresh (background write + `chrome.storage.onChanged` listener).

These are deferred to the phase's manual validation (05-VALIDATION.md) per the plan's own verification section.

### Gaps Summary

No blocking gaps. All 3 success criteria are met in the codebase:

1. **SC1** — The "📰 Market News" tab surfaces notable markets (volume ≥ minVolume OR watchlisted) with direction + correlated news across finance/politics/technology.
2. **SC2** — A single-source `taxonomy.ts` with deterministic precedence (politics > finance > tech) is applied to both markets and news; category persisted at collection time.
3. **SC3** — The view is a read-only derived projection over existing markets + news + correlations (no new collection, no new deps), and reuses `VirtualizedGrid` for responsive rendering.

**Status is `human_needed`** (not `passed`) because the Market News tab visual rendering, dashboard responsiveness feel, and end-to-end snapshot sync are runtime/visual behaviors that unit tests cannot observe and require manual browser confirmation. All automated checks pass; no code gaps exist.

---

_Verified: 2026-08-23T13:35:00Z_
_Verifier: the agent (gsd-verifier)_
