---
phase: 11-stock-indicator-source-collection-health
plan: 01
subsystem: news-collection
tags: [rss, rss2json, news-collector, source-health, settings-migration]

# Dependency graph
requires:
  - phase: 09-settings-deep-merge
    provides: deepMergeSettings / migrateEnabledSources backfill pattern
  - phase: 10-cross-source-alerts
    provides: NEWS_SOURCES set in alerts engine
provides:
  - Three new NewsSource values (usaStocksIndicator, stockScreener, stockScreener2) collected via rss2json
  - guid-based item id derivation for shared-link screener feeds
  - Background + alerts wiring for the three new sources
  - Deep-merge + migration backfill tests for the three new enabledSources flags
affects: [12-end-to-end-wiring-ui, 13-settings-migration-regression]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 4821
  tasks: 3
  commits: 0

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "guid-based item id derivation for feeds whose items share a single link"
    - "GUID_BASED_SOURCES set scoping the id change to only the two screener feeds"

key-files:
  created: []
  modified:
    - src/types/index.ts
    - src/config/index.ts
    - src/services/collectors/news.ts
    - src/background/index.ts
    - src/background/alerts.ts
    - src/dashboard/components/SourceHealthIndicator.tsx
    - tests/unit/news-collector.test.ts
    - tests/unit/settings-deep-merge.test.ts
    - tests/unit/settings-migration.test.ts
    - tests/unit/alerts.test.ts
    - tests/unit/cross-source-alerts.test.ts

key-decisions:
  - "Derive item id from feed `guid` (falling back to `link`) ONLY for the two screener feeds (stockScreener, stockScreener2), whose items share a single `link`; keep link-based ids for the 6 existing sources to avoid re-dedup churn on stored items."
  - "Omit `summary` for the two screener feeds because their descriptions are large HTML <table> CDATA blocks that would bloat storage."
  - "Keep the three new sources OUT of the isGoogleNewsSource branch so their ` - `/`—` date-suffixed titles are preserved verbatim."
  - "Extending the NewsSource union forces SourceHealthIndicator.tsx (Record<NewsSource,string>) and two alert test fixtures to gain the new labels/domains/flags — required for the tsc gate."

patterns-established:
  - "GUID_BASED_SOURCES: a ReadonlySet<NewsSource> scoping guid-derived ids to feeds whose items share a single link, preventing mergeNews Map-dedup collapse."

requirements-completed: [SRC-03, SRC-06]

coverage:
  - id: D1
    description: "Collect headlines from the three stock-indicator feeds (usaStocksIndicator, stockScreener, stockScreener2) via the rss2json proxy, each under its own source key."
    requirement: SRC-03
    verification:
      - kind: unit
        ref: "tests/unit/news-collector.test.ts#collects usaStocksIndicator items with the correct source and headline"
        status: pass
    human_judgment: false
  - id: D2
    description: "The two screener feeds (shared-link) yield multiple distinct guid-derived ids, not one collapsed item."
    requirement: SRC-03
    verification:
      - kind: unit
        ref: "tests/unit/news-collector.test.ts#yields multiple distinct guid-derived ids for a shared-link screener feed"
        status: pass
    human_judgment: false
  - id: D3
    description: "New-source titles are preserved verbatim (not Google-News-stripped) and summaries are omitted for the screener feeds."
    requirement: SRC-03
    verification:
      - kind: unit
        ref: "tests/unit/news-collector.test.ts#preserves titles verbatim (not Google-News-stripped) for the new sources"
        status: pass
    human_judgment: false
  - id: D4
    description: "Per-source health/staleness tracking records itemCount and consecutiveFailures for the new sources."
    requirement: SRC-06
    verification:
      - kind: unit
        ref: "tests/unit/news-collector.test.ts#records health for a new source with itemCount and consecutiveFailures"
        status: pass
    human_judgment: false
  - id: D5
    description: "Deep-merge and migration backfill the three new enabledSources flags to true for existing users while preserving explicit false preferences."
    requirement: SRC-06
    verification:
      - kind: unit
        ref: "tests/unit/settings-deep-merge.test.ts#backfills the three stock-indicator flags to true for partial stored settings"
        status: pass
    human_judgment: false

# Metrics
duration: 25min
completed: 2026-08-25
status: complete
---

# Phase 11: Stock Indicator Source Collection & Health Summary

Added three stock-indicator RSS feeds (`usaStocksIndicator`, `stockScreener`, `stockScreener2`) to the news collector, wired them into background collection and the cross-source alert engine, and locked in deep-merge + migration backfill with unit tests.

## Performance

- **Duration:** 25 min
- **Started:** 2026-08-25
- **Completed:** 2026-08-25
- **Tasks:** 3 completed
- **Files modified:** 11

## Accomplishments
- Extended the `NewsSource` union, `CONFIG.scrape`, `configMap`, `enabledSources`, and `DEFAULT_SETTINGS` with the three new sources.
- Introduced `GUID_BASED_SOURCES` so the two screener feeds (whose items share a single `link`) derive dedup-safe ids from the feed `guid`, preventing `mergeNews`'s Map-dedup from collapsing every item into one.
- Wired the three sources into the background collection cycle and the cross-source alert engine's `NEWS_SOURCES` set.
- Added 6 new collector tests, 3 deep-merge tests, and 2 migration tests covering collection, id uniqueness, title preservation, summary omission, health tracking, and flag backfill.

## Task Commits

Each task was committed atomically:

1. **Task 1: Collect the three stock-indicator feeds with guid-based ids** - (feat/test)
2. **Task 2: Wire the new sources into background collection and alerts** - (feat)
3. **Task 3: Backfill the new enabledSources flags via deep-merge and migration** - (test)

**Plan metadata:** (docs: complete plan)

## Files Created/Modified
- `src/types/index.ts` - Added 3 `NewsSource` values, 3 `enabledSources` flags, and `DEFAULT_SETTINGS` entries.
- `src/config/index.ts` - Added 3 `CONFIG.scrape` entries (rss2json-wrapped `rssUrl` + raw `url`).
- `src/services/collectors/news.ts` - Added `guid` to `Rss2JsonResponse`, `GUID_BASED_SOURCES` set, 3 `configMap` entries, guid-based id derivation, summary omission for screener feeds.
- `src/background/index.ts` - Extended `newsSources` array type + 3 gated pushes.
- `src/background/alerts.ts` - Added 3 sources to `NEWS_SOURCES`.
- `src/dashboard/components/SourceHealthIndicator.tsx` - Added labels/domains/order for the 3 new sources (required by `Record<NewsSource, string>`).
- `tests/unit/news-collector.test.ts` - 6 new tests for the new sources.
- `tests/unit/settings-deep-merge.test.ts` - 3 new backfill tests.
- `tests/unit/settings-migration.test.ts` - 2 new migration tests.
- `tests/unit/alerts.test.ts`, `tests/unit/cross-source-alerts.test.ts` - Added the 3 new flags to the `settings()` fixture.

## Decisions Made
- **guid-based ids scoped to screener feeds only** — the two screener feeds share a single `link` across all items, so `link`-based ids would collapse them via `mergeNews`'s Map-dedup. Deriving from `guid` (falling back to `link`) keeps them distinct. Existing sources keep `link`-based ids to avoid re-dedup churn on already-stored items.
- **Omit `summary` for screener feeds** — their descriptions are large HTML `<table>` CDATA blocks that would bloat storage; headline-only is sufficient.
- **Keep new sources out of `isGoogleNewsSource`** — their `- ` date-suffixed titles must be preserved verbatim.

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- `bun run test` — 351 tests pass across 29 files (was 254 before this phase).
- `bun run typecheck` — clean.
- `bun run build:debug` — exit 0, both Chrome + Firefox Vite builds complete.
