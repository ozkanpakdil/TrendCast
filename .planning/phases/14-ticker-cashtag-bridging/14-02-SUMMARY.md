---
phase: 14-ticker-cashtag-bridging
plan: 02
subsystem: correlation-engine
tags: [correlation, news-collector, source-health, dashboard]
provides:
  - "Ticker-only keyword curation for stock-indicator news items (CORR-03)"
  - "Per-source bridging coverage projection + SourceHealthIndicator tooltip segment (CORR-04)"
affects: [news-collector, source-health, dashboard]
tech-stack:
  added: []
  patterns:
    - "Pure-projection helpers in source-health.ts (computeCorrelatedCounts pattern)"
key-files:
  created: []
  modified:
    - src/services/collectors/news.ts
    - src/utils/source-health.ts
    - src/dashboard/components/SourceHealthIndicator.tsx
    - src/dashboard/App.tsx
    - tests/unit/news-collector.test.ts
    - tests/unit/source-health.test.ts
key-decisions:
  - "Ticker-only keywords (no org aliases) — org bridging handled by 14-01 unified entity space"
  - "Curation scoped to stock-indicator sources only; BBC/other feeds keep raw extractKeywords"
  - "Bridging coverage is a pure projection (Set of matched ids), no schema/storage change"
  - "Tooltip renders bridged 0/0 when coverage absent/empty — never NaN/undefined"
patterns-established:
  - "computeBridgingCoverage follows computeFetchedCounts pure-projection convention"
duration: "25min"
completed: 2026-08-27
---

# Phase 14 Plan 02: Keyword Curation + Bridging Coverage Summary

**Stock-indicator news items now carry ticker-only keywords (label/date tokens can no longer dilute keyword Jaccard), and the source-health sidebar shows per-source bridging coverage (bridged/total) in its tooltip.**

## Performance

- **Duration:** ~25 min (executed inline after subagent infra failures)
- **Tasks:** 2 of 2
- **Files modified:** 6

## Accomplishments

- **Task 1 (CORR-03):** Stock-indicator branch in `collectFromSource` now emits `keywords: [symbol.toLowerCase()]` instead of `extractKeywords(\`${stockHeadline} ${symbol}\`)`. Screener-label tokens (stock/indicator/breakout/vcp) and date tokens no longer pollute the keyword set, so keyword Jaccard against ticker-centric signals is no longer diluted. Org-name bridging is delegated to the 14-01 unified entity space (research A4).
- **Task 2 (CORR-04):** New `computeBridgingCoverage(news, newsMatches)` pure projection in `src/utils/source-health.ts` (Set of matched news ids → per-source `{ total, bridged }`). `SourceHealthIndicator` gained an optional `bridgingCoverage` prop and a ` · bridged B/T` tooltip segment (0/0 fallback, never NaN). Wired at both `App.tsx` render sites (news tab + correlations tab).

## Task Commits

1. **Task 1: Ticker-only keyword curation** — not committed (per project rules the user stages/commits). Intended message: `feat(14-02): ticker-only keyword curation + bridging coverage display`
2. **Task 2: Bridging coverage projection + display** — same commit.

## Files Created/Modified

- `src/services/collectors/news.ts` — stock-indicator keywords curated to bare lowercase ticker; comment updated (CORR-03); non-stock path untouched
- `src/utils/source-health.ts` — added `computeBridgingCoverage` pure projection after `computeFetchedCounts`
- `src/dashboard/components/SourceHealthIndicator.tsx` — optional `bridgingCoverage` prop + ` · bridged B/T` tooltip segment with 0/0 fallback
- `src/dashboard/App.tsx` — import + `bridgingCoverage` wired at both SourceHealthIndicator render sites (~429, ~744)
- `tests/unit/news-collector.test.ts` — AMZN/EBAY/ASML keywords deep-equal exact ticker arrays; label/date token absence asserted; XPON deep-equal `['xpon']`; BBC scoping assertion (raw extractKeywords preserved); added `extractKeywords` import
- `tests/unit/source-health.test.ts` — new `computeBridgingCoverage` describe: empty → `{}`, no matches → `{total: N, bridged: 0}`, mixed counts, phantom match ids ignored, duplicate matches count once (Set), single-item boundary

## Decisions & Deviations

- **Executed inline instead of via gsd-executor subagent:** two subagent spawn attempts failed on infrastructure errors (network disconnect, then 502). Both tasks were small and fully specified, so the orchestrator executed them directly. No content deviation.
- **Ticker-only, no org aliases (research A4):** org-name bridging is the 14-01 unified entity space's job; duplicating aliases here would double-count and re-introduce noise.
- **Curation scoping:** only the `STOCK_INDICATOR_SOURCES` branch is curated; the generic RSS path (`keywords: extractKeywords(fullText)`) is untouched — asserted by the BBC test.
- **Coverage projection purity:** no storage I/O, no React imports, no `SourceHealthEntry` schema change; phantom match ids produce no source entries; duplicate matches count once via Set semantics.

## Out-of-Plan Work This Session (documented here per orchestrator note)

- **Embedding entity enrichment** (between 14-01 and 14-02, user-approved): `src/services/engine/ml/embedding.ts` now enriches every embedded text with canonical entity keywords via `enrichForEmbedding(text)` (appends `extractEntityKeywords(text)`), so "NVDA — VCP 2026-08-27" embeds with "nvidia" and can match "$NVDA breaking out nvidia". All 6 embed call sites enriched; news→social top-5 diagnostic added in `correlateNewsToSignals`. Oracle lockstep + 5 new tests in `tests/unit/embedding-equivalence.test.ts` (mock CONCEPTS gained `'nvidia'`). This closes the gap where 14-01 Task 2's bridging lived only in the heuristic engine while the user runs `engine="embedding"`. Intended commit message: `fix(ml): entity enrichment for embedding inputs + news→social top-K diagnostic`.

## Verification

- `bun run test` — **392/392 passing (31 files)** (386 baseline + 6 new coverage tests)
- `bun run typecheck` — clean
- `bun run lint` — clean (max-warnings 0)
- `grep -c "bridgingCoverage" src/dashboard/App.tsx` — 2 (both render sites)

## Next Phase Readiness

- Phase 14 plans 1/2 and 2/2 both executed; CORR-01…CORR-04 all marked complete; state is `ready_for_verification`.
- Remaining for phase close-out: aggregate results → advisory code review gate → `verify_phase_goal` (gsd-verifier) → roadmap phase status update.
- Known follow-up candidate (user-selected, to be filed as a new plan after close-out): a **news↔news correlation pass** so VCP (stockScreener2) items can match Seeking Alpha stock-indicator items directly — currently impossible by construction (the engine only runs signal→market, news→market, news→social passes).
