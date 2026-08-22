---
phase: 01-data-reliability
plan: 03
subsystem: ui
tags: [source-health, ui-states, e2e, rel-02]

requires:
  - phase: 01-data-reliability
    plan: 01-01
    provides: SourceHealthIndicator healthy-path tracer, computeHealth/computeCorrelatedCounts
provides:
  - Full 7-state SourceHealthIndicator (empty/loading/error/populated/partial/overflow/zero-one-many)
  - e2e regression guard for the REL-02 health indicator
affects: [verify-work]

actuals:
  tokens: 0
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Read-only derived projection component with explicit state branches"
    - "useSnapshot exposes error state for read failures"

key-files:
  created: []
  modified:
    - src/dashboard/components/SourceHealthIndicator.tsx
    - src/dashboard/App.tsx
    - src/dashboard/hooks/useSnapshot.ts
    - tests/e2e/fixtures.ts
    - tests/e2e/dashboard.spec.ts

key-decisions:
  - "SourceHealthIndicator branches on loading → error → empty → populated (early returns)."
  - "useSnapshot gains an error boolean set on storage read failure."

patterns-established:
  - "Early-return state branches keep the component a pure read-only projection."

requirements-completed: [REL-01, REL-02]

coverage:
  - id: D1
    description: "SourceHealthIndicator covers all 7 UI states from UI-SPEC"
    requirement: REL-02
    verification:
      - kind: e2e
        ref: "tests/e2e/dashboard.spec.ts#renders source health indicator with fetched/correlated counts"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-08-22
status: complete
---

# Phase 01: Data Reliability — SourceHealthIndicator 7 UI States + e2e

Expanded the `SourceHealthIndicator` from the healthy-path tracer to cover all 7 UI states mandated by the UI-SPEC, wired `loading`/`error` from the snapshot hook, and added an e2e regression guard.

## Performance

- **Tasks:** 2 completed
- **Files modified:** 5

## Accomplishments
- **7 UI states covered** in `SourceHealthIndicator` via early-return branches:
  - **loading** → placeholder skeleton badges (neutral `bg-slate-800`/`bg-light-border` pulse)
  - **error** → "Health data unavailable — check your connection and run collection again."
  - **empty** → "No health data available — Run a collection to see per-source status."
  - **populated** → `flex flex-wrap gap-2` badge row with status dot + label + "fetched N · correlated M"
  - **partial** → source with no entry renders neutral "No data" badge (never omitted)
  - **overflow** → badges wrap via `flex-wrap`
  - **zero-one-many** → numeric counts handle 0/1/many without pluralization bugs
- **`useSnapshot`** now exposes an `error` boolean set on storage read failure.
- **`App.tsx`** passes `loading`/`error` to both news and correlations tab indicators.
- **e2e** asserts the indicator renders "fetched 10 · correlated" (healthy seekingalpha) and "fetched 0 · correlated" (degraded investing).

## Task Commits

Commits are handled by the user per repository git rules (no auto-commit).

**Plan metadata:** `01-03-PLAN.md`

## Files Created/Modified
- `src/dashboard/components/SourceHealthIndicator.tsx` - 7-state coverage via early-return branches.
- `src/dashboard/App.tsx` - wired `loading`/`error` props to both indicators.
- `src/dashboard/hooks/useSnapshot.ts` - added `error` state.
- `tests/e2e/fixtures.ts` - added `sourceHealth` to `MOCK_SNAPSHOT`.
- `tests/e2e/dashboard.spec.ts` - added health indicator assertion.

## Decisions Made
- Early-return branches (loading → error → empty → populated) keep the component a pure read-only projection.
- `error` is a boolean (not a message string) to keep the indicator's copy contract fixed per UI-SPEC.

## Deviations from Plan

None. All 7 states, the e2e assertion, and the `MOCK_SNAPSHOT.sourceHealth` fixture were delivered as specified.
