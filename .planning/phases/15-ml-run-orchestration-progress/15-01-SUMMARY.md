---
phase: 15-ml-run-orchestration-progress
plan: 01
subsystem: background-ml-orchestration
tags: [ml, worker, progress, mv3]
provides:
  - "Serialized ML run queue (MlRunQueue) — overlapping corr-*/precompute-* runs queue instead of overwriting resolvers (MLPROG-01)"
  - "requestId-scoped terminal states — every terminal result (success, ML error, catch-path error) carries requestId"
  - "Persisted run-state marker (trendcast:ml-run-state) + orphan recovery on background startup (SW-death path)"
  - "CORRELATION_RUN_STATE liveness message + dashboard stale-run settle"
affects: [background, dashboard, workers, types, config]
tech-stack:
  added: []
  patterns:
    - "Narrow storage-interface helpers (v0.1.5 SettingsStorage convention)"
key-files:
  created:
    - src/utils/ml-run-queue.ts
    - src/utils/ml-run-state.ts
    - tests/unit/ml-run-queue.test.ts
  modified:
    - src/background/index.ts
    - src/dashboard/hooks/useCorrelations.ts
    - src/types/index.ts
    - src/config/index.ts
key-decisions:
  - "Queue is framework-free (no browser APIs) so it is directly unit-testable"
  - "Cancel of the ACTIVE run rejects the pending promise before terminating the worker — fixes the hung-promise bug (cancel previously left runCorrelationAsync unsettled, so no error result was ever written)"
  - "Worker messages carry requestId and are dropped when they don't match the active resolvers — a late message from a terminated run can never settle the next run"
  - "Storage-poll fallback no longer accepts unstamped results while a run is active (unstamped = some other run's result)"
  - "Orphaned marker recovery runs at background startup: clear marker + broadcast interrupted error result for that requestId"
duration: "35min"
completed: 2026-08-29
---

# Phase 15 Plan 01: Serialized ML Run Queue + requestId-Scoped Terminal States Summary

**ML correlation runs are now serialized through a FIFO queue, every terminal result is stamped with its requestId, and a persisted run-state marker lets the dashboard detect (and settle) a run whose service worker died mid-flight.**

## Accomplishments

- **Task 1 — `src/utils/ml-run-queue.ts` (new):** `MlRunQueue` — FIFO, one active run, `cancel()` rejects queued entries with `ML_RUN_CANCELLED_MESSAGE`, `isQueued()`/`activeRequestId` for liveness. Rejections inside the queue are swallowed (the entry's caller owns error handling) so no unhandled rejection escapes.
- **Task 2 — `src/utils/ml-run-state.ts` (new):** persisted `{ requestId, engine, model, startedAt }` marker behind the narrow `SettingsStorage` interface; `readMlRunState` tolerates absent/corrupt data.
- **Task 3 — Background wiring:** `runMLCorrelation` enqueues through `mlRunQueue` (resolvers now carry `requestId` and self-clear on settle, which advances the queue). `cancelMLCorrelation(requestId)` rejects the active promise **before** terminating the worker (fixes the hung-promise bug) and cancels queued entries. `runCorrelationWithEngine`'s ML-error return and `runCorrelationAsync`'s catch-path error result are both stamped with `requestId`. Marker written on run start, cleared in a `finally` on every terminal path. Startup recovery: orphaned marker → clear + broadcast interrupted error result. New `CORRELATION_RUN_STATE` handler reports liveness from the marker + queue.
- **Task 4 — Hook scoping:** `useCorrelations` drops `CORRELATION_PROGRESS` messages whose requestId ≠ active id (a `precompute-*` run can no longer update/resurrect the bar); the storage-poll fallback only accepts results matching the active id; a 5s liveness poll settles the UI with an interrupted error when the background reports the run is gone.
- **Task 5 — Types + tests:** `CORRELATION_RUN_STATE`/`_RESULT` messages added; `CONFIG.storage.mlRunState` key added; 10 new tests (FIFO, one-active, reject-advances, cancel-queued/active/unknown, unhandled-rejection guard, marker round-trip/corrupt/orphan).

## Files Created/Modified

- `src/utils/ml-run-queue.ts` — new (serialized queue)
- `src/utils/ml-run-state.ts` — new (persisted marker helpers)
- `src/background/index.ts` — queue wiring, cancel fix, requestId stamping, marker lifecycle, startup recovery, `CORRELATION_RUN_STATE` handler
- `src/dashboard/hooks/useCorrelations.ts` — requestId-scoped progress, tightened storage poll, liveness poll
- `src/types/index.ts` — `CORRELATION_RUN_STATE` + `_RESULT` messages
- `src/config/index.ts` — `storage.mlRunState` key
- `tests/unit/ml-run-queue.test.ts` — new (10 tests)

## Decisions & Deviations

- **Cancel semantics:** the active run's promise is rejected synchronously in `cancelMLCorrelation` before `terminateMLWorker()` — the worker 'error' event path alone was not guaranteed to fire after termination, and the original code never rejected at all (the root cause of one class of stuck progress).
- **Queue advancement:** resolvers clear themselves on settle and the queue's `run()` promise resolves at that moment — no polling, no timers.
- **Stale-message guard:** worker messages carry `requestId`; the listener drops any message whose id ≠ active resolvers' id. Belt-and-braces on top of the queue.
- **Liveness poll interval 5s:** slow enough to be cheap, fast enough that a SW-death stall settles within one poll.

## Verification

- `bun run test -- --run tests/unit/ml-run-queue.test.ts` — 10/10
- `bun run test` — **406/406 passing (33 files)** (396 baseline + 10 new)
- `bun run typecheck` — clean; `bun run lint` — clean (max-warnings 0)
- `bun run build:debug:firefox` — built in 2.56s

## Task Commits

1. **Plan 15-01 (all tasks)** — not committed (per project rules the user stages/commits). Intended message: `fix(ml): serialize ML runs, requestId-scoped terminal states, SW-death recovery (15-01)`