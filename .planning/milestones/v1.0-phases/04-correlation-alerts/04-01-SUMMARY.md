---
phase: 04-correlation-alerts
plan: 01
subsystem: background
tags: [alerts, correlation, chrome-storage, dedup, throttle]

requires:
  - phase: 03-correlation-speedup
    provides: CorrelationResult engine output (matches/newsMatches) consumed by evaluateAlerts
provides:
  - Pure alert engine `evaluateAlerts()` + `deriveDirection()` in src/background/alerts.ts
  - AlertRecord / AlertState types, ExtensionSettings alertsEnabled/alertCooldownMinutes, ALERTS_UPDATED/CLEAR_ALERTS Message variants
  - CONFIG.alerts tuning block + alertState/alertHistory storage keys
  - BUDGET_KEYS accounting for the two new keys
  - Unit tests for the alert engine (23 tests)
affects: [04-02 (wire into background orchestrator), 04-03 (dashboard Alerts tab)]

actuals:
  tokens: 5646
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns:
    - "slice(-N) ring-buffer for capped alert history"
    - "storage-as-state for ephemeral MV3 worker alert detection"

key-files:
  created:
    - src/background/alerts.ts
    - tests/unit/alerts.test.ts
    - tests/unit/alert-direction.test.ts
  modified:
    - src/types/index.ts
    - src/config/index.ts
    - src/utils/storage.ts

key-decisions:
  - "Alert only on NEW or direction-changed watchlisted correlations (D-01) — never sustained matches"
  - "No numeric confidence threshold gates an alert (D-02)"
  - "Market-level direction from aggregate signal sentiment + Yes-price delta vs prior snapshot (D-03, D-04)"
  - "Prior Yes-price stored per contract in alertState (D-05)"
  - "Meaningful-band flip (sentiment ±0.2 / yesPrice >2pts) filters minor wobbles (D-06)"

patterns-established:
  - "Ring-buffer cap: alertHistory trimmed via slice(-CONFIG.alerts.historyCap) before persist"
  - "Storage-as-state: alertState/alertHistory read+written via browser.storage.local, surviving MV3 worker restarts"

requirements-completed: [ALERT-01, ALERT-02]

coverage:
  - id: D1
    description: "evaluateAlerts() produces deduped, throttled, watchlist-scoped, direction-aware AlertRecord[] for new/direction-changed correlations"
    requirement: ALERT-01
    verification:
      - kind: unit
        ref: "tests/unit/alerts.test.ts#evaluateAlerts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Direction derived from aggregate signal sentiment + Yes-price delta vs prior snapshot"
    requirement: ALERT-02
    verification:
      - kind: unit
        ref: "tests/unit/alert-direction.test.ts#deriveDirection"
        status: pass
    human_judgment: false
  - id: D3
    description: "alertHistory capped at CONFIG.alerts.historyCap; alertState/alertHistory added to BUDGET_KEYS"
    verification:
      - kind: unit
        ref: "tests/unit/alerts.test.ts#BUDGET_KEYS"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-08-22
status: complete
---

# Phase 4: Correlation Alerts — Plan 01 Summary

**Built the pure alert engine `evaluateAlerts()` + `deriveDirection()` and its data foundation (types, config, storage keys, Message variants), with 23 unit tests proving dedup, throttle, watchlist scoping, direction derivation, and the history cap.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2
- **Files modified:** 6 (3 created, 3 edited)

## Accomplishments
- Created `src/background/alerts.ts` with `evaluateAlerts()` (dedup/throttle/watchlist-scope/direction/band-flip) and `deriveDirection()` (sentiment + Yes-price delta).
- Added `AlertRecord`/`AlertState` types, `alertsEnabled`/`alertCooldownMinutes` settings, and `ALERTS_UPDATED`/`CLEAR_ALERTS` Message variants.
- Added `CONFIG.alerts` tuning block + `alertState`/`alertHistory` storage keys; added both keys to `BUDGET_KEYS`.
- Capped `alertHistory` at 100 via the `slice(-N)` ring-buffer pattern.
- 23 unit tests green (full suite 180 green); typecheck clean for all changed files.

## Task Commits

Commits are handled by the user (per mandatory git rules). No commits were made by the agent.

1. **Task 1: Build evaluateAlerts() engine + data foundation** — types, config, engine, tests
2. **Task 2: Cap alert history + account for new keys in storage budget** — slice(-N) cap + BUDGET_KEYS

## Files Created/Modified
- `src/background/alerts.ts` (created) — `evaluateAlerts()` + `deriveDirection()` alert engine
- `src/types/index.ts` (modified) — `AlertRecord`, `AlertState`, `AlertDirection`, settings fields, Message variants
- `src/config/index.ts` (modified) — `CONFIG.alerts` block + `alertState`/`alertHistory` storage keys
- `src/utils/storage.ts` (modified) — exported `BUDGET_KEYS`, added both new keys
- `tests/unit/alerts.test.ts` (created) — engine tests (D-01..D-06, throttle, cap, BUDGET_KEYS)
- `tests/unit/alert-direction.test.ts` (created) — `deriveDirection` tests

## Decisions Made
Followed the plan exactly. All six decisions D-01..D-06 honored; no confidence threshold added.

## Deviations from Plan

None — plan executed exactly as written.

### Auto-fixed Issues

**1. Variable shadowing — `watchlist.has` vs `watchlisted` Set**
- **Found during:** Task 1 (test run)
- **Issue:** `evaluateAlerts` built a `watchlisted` Set but referenced `watchlist.has(...)`, throwing `TypeError: watchlist.has is not a function`.
- **Fix:** Changed the two guard checks to `watchlisted.has(...)`.

**2. Test fixture cooldown timing**
- **Found during:** Task 1 (test run)
- **Issue:** The "alerts when sentiment crosses the band" test seeded `lastNotified` only 1 min ago, which the 60-min per-market cooldown correctly suppressed.
- **Fix:** Seeded `lastNotified` 2h in the past so the cooldown passes and the band-flip path is exercised.

**3. Browser polyfill throws outside extension**
- **Found during:** Task 1 (test run)
- **Issue:** `alert-direction.test.ts` imported `@/background/alerts`, which loads the webextension polyfill that throws outside a browser extension.
- **Fix:** Added a `vi.mock('@/messaging/browser')` so the pure `deriveDirection` is tested in isolation.

## Verification
- `bun run test tests/unit/alerts.test.ts tests/unit/alert-direction.test.ts` — 23/23 pass
- `bun run test` (full unit suite) — 180/180 pass
- `bun run typecheck` — clean for all changed files (5 pre-existing errors in untouched prior-phase test files remain)
