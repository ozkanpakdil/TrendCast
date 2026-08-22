---
phase: 01-data-reliability
plan: 01
subsystem: data-collection
tags: [source-health, telemetry, news, storage, dashboard]

requires:
  - phase: 00-onboarding
    provides: project context, codebase map, requirements
provides:
  - Per-source fetch health map (SourceHealth) persisted inside CollectionSnapshot
  - SourceHealthIndicator dashboard component rendering "fetched N · correlated M"
  - Pure computeHealth/computeCorrelatedCounts projection helpers
affects: [01-02, 01-03, verify-work]

actuals:
  tokens: 0
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns:
    - "storage-as-state: sourceHealth embedded in CollectionSnapshot for atomicity"
    - "typed NewsSource union as health-map key (ASVS V5 input validation)"
    - "Promise.allSettled per-source outcome capture into health map"

key-files:
  created:
    - src/utils/source-health.ts
    - src/dashboard/components/SourceHealthIndicator.tsx
    - tests/unit/news-collector.test.ts
    - tests/unit/source-health.test.ts
  modified:
    - src/types/index.ts
    - src/config/index.ts
    - src/services/collectors/news.ts
    - src/background/index.ts
    - src/dashboard/App.tsx

key-decisions:
  - "Embed sourceHealth in CollectionSnapshot (not a separate storage key) for atomicity — avoids a second key/read/BUDGET_KEYS change."
  - "Empty (304/empty) fetch increments consecutiveFailures, distinguishing a failed/empty source from one with no correlated items."
  - "computeHealth delegates staleness to a pure util; component never inlines date math."

patterns-established:
  - "SourceHealthEntry/SourceHealth typed map keyed by NewsSource union"
  - "collectNews returns { news, health } with optional previousHealth for cross-cycle failure accumulation"
  - "Read-only derived projection component (SourceHealthIndicator) modeled on CorrelationStatsBar"

requirements-completed: [REL-01, REL-02]

coverage:
  - id: D1
    description: "Per-source fetch outcomes recorded into a persisted sourceHealth map inside CollectionSnapshot"
    requirement: REL-01
    verification:
      - kind: unit
        ref: "tests/unit/news-collector.test.ts#collectNews health map"
        status: pass
    human_judgment: false
  - id: D2
    description: "SourceHealthIndicator renders per-source 'fetched N · correlated M' badges in news and correlations tabs"
    requirement: REL-02
    verification:
      - kind: unit
        ref: "tests/unit/source-health.test.ts#computeHealth"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-08-14
status: complete
---

# Phase 01: Data Reliability — Source Health Telemetry Tracer

Wired the source-health telemetry layer end-to-end: the background collector records per-source fetch outcomes, persists them inside `CollectionSnapshot`, and the dashboard renders a read-only `SourceHealthIndicator` showing "fetched N · correlated M" per source.

## Performance

- **Duration:** 25 min
- **Tasks:** 2 completed
- **Files modified:** 9 (4 created, 5 modified)

## Accomplishments
- `collectNews` now returns `{ news, health }` with a per-source health map, replacing the silent `console.warn` + `return []` anti-pattern with recorded failure telemetry.
- `runCollection` reads the previous snapshot's `sourceHealth` and persists the new health map atomically inside `CollectionSnapshot`.
- `SourceHealthIndicator` renders per-source health badges in both the news and correlations tabs, decoupling "fetched" from "correlated" (REL-01/REL-02).
- Pure `computeHealth` / `computeCorrelatedCounts` helpers are unit-tested in isolation.

## Task Commits

Commits are handled by the user per repository git rules (no auto-commit).

**Plan metadata:** `01-01-PLAN.md`

## Files Created/Modified
- `src/types/index.ts` - Added `SourceHealthEntry`, `SourceHealth`, and `sourceHealth` field on `CollectionSnapshot`.
- `src/config/index.ts` - Added `stalenessThresholdMs` (2h) to the `collection` block.
- `src/services/collectors/news.ts` - `collectNews` returns `{ news, health }`; records per-source outcomes.
- `src/background/index.ts` - `runCollection` reads previous health, persists `sourceHealth` in snapshot.
- `src/utils/source-health.ts` - Pure `computeHealth` / `computeCorrelatedCounts` helpers.
- `src/dashboard/components/SourceHealthIndicator.tsx` - Read-only per-source health badges.
- `src/dashboard/App.tsx` - Renders `SourceHealthIndicator` in news + correlations tabs.
- `tests/unit/news-collector.test.ts` - 5 tests for health-map recording (REL-01).
- `tests/unit/source-health.test.ts` - 8 tests for `computeHealth` / `computeCorrelatedCounts` (REL-02).

## Decisions Made
- Embedded `sourceHealth` in `CollectionSnapshot` for atomic persistence (avoids a second storage key).
- Empty (304) fetch increments `consecutiveFailures`, distinguishing a failed source from one with no correlated items.
- Staleness delegated to pure `computeHealth`; component never inlines date math.

## Deviations from Plan

None - plan executed exactly as written.
