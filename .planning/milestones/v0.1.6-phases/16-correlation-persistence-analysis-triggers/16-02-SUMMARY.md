---
phase: 16
plan: 02
subsystem: correlation-persistence
tags: [correlations, storage-triggers, reanalysis, dashboard, race-hardening]
requires:
  - correlation-persistence helpers (hasFreshAnalysis, readStoredAnalysis — from 16-01)
  - CONFIG.storage keys (correlations, latestSnapshot, lastCollectionAt — src/config/index.ts)
  - CORRELATION_RUN_STATE handler (src/background/index.ts — { live, requestId, queued, activeRequestId })
  - applyResult guard + applyResultRef pattern (src/dashboard/hooks/useCorrelations.ts)
provides:
  - shouldTriggerReanalysis pure guard (src/utils/correlation-persistence.ts)
  - CorrelationRunLiveness exported type
  - storage.onChanged listener effect in useCorrelations (Branch A correlations-key apply, Branch B snapshot-trigger)
  - lastAppliedRef echo dedupe + triggerInFlightRef race guard + mountedRef unmount guard
  - e2e mock liveness simulation (__trendcastSlowCorrelation opt-in flag) + __trendcastStorageEvents recorder
affects:
  - End-of-phase manual verification (16-VALIDATION.md) — trigger behavior is now testable in the live dashboard
tech-stack:
  added: []
  patterns:
    - pure decision function + thin browser-API wrapper (guard unit-tested without browser APIs)
    - storage.onChanged listener with empty-deps effect + cleanup (mirrors useSnapshot.ts)
    - single-entry-point state updates (listener routes through applyResultRef, never setCorrelations)
    - synchronous in-flight flag + async liveness re-check to close the pre-filter/response race
key-files:
  created: []
  modified:
    - src/utils/correlation-persistence.ts
    - src/dashboard/hooks/useCorrelations.ts
    - tests/unit/correlation-persistence.test.ts
    - tests/e2e/fixtures.ts
    - tests/e2e/dashboard.spec.ts
decisions:
  - "Trigger freshness is a different predicate from display freshness: a legacy stored result (no computedAt) displays as 'unknown age' but never suppresses a re-run; computedAt === collectedAt counts as fresh (no re-run)."
  - "Branch A (correlations key) routes exclusively through applyResultRef with an echo dedupe (requestId + computedAt both match lastAppliedRef → skip) — no direct setCorrelations from the listener."
  - "Branch B (snapshot keys) uses a cheap pure pre-filter (liveness {live:false,queued:false}) before the async CORRELATION_RUN_STATE check, plus a synchronous triggerInFlightRef cleared in finally to close the race between pre-filter and liveness response."
  - "Mock liveness simulation is opt-in via globalThis.__trendcastSlowCorrelation: a custom __messageHandlers handler holds CORRELATE_ALL ~1500ms with __trendcastCorrelationLive=true, and CORRELATION_RUN_STATE reports the live flag — default behavior (instant canned response, live:false) is unchanged for all pre-existing tests."
metrics:
  duration: ~1.5h (across 2 context windows)
  completed: 2026-08-29
status: complete
actuals:
  tokens: ~52000
  tasks: 3
  commits: 0
---

# Phase 16 Plan 02: Collection-Triggered Re-Analysis (TRIG-03) Summary

A storage.onChanged listener in the open dashboard re-runs correlation analysis exactly once when a collection lands a new snapshot — suppressed while a run is live/queued, suppressed when the stored analysis already covers the new data, deduped against broadcast echoes, and race-hardened with an in-flight flag.

## Objective

TRIG-03: collection completion triggers a guarded re-analysis in the open dashboard without a manual click, without double ML runs, and without re-running when the stored result is already fresh.

## What Was Built

### Task 1 (tracer): end-to-end trigger path — snapshot change → one guarded re-run

- **`src/utils/correlation-persistence.ts`** — added `CorrelationRunLiveness` interface ({ live, queued }) and the pure guard `shouldTriggerReanalysis({ liveness, stored, snapshotCollectedAt })`: returns false when live/queued; false when snapshotCollectedAt is not a finite number (empty/missing snapshot arms nothing); true when stored is absent or an error result; true for legacy stored results lacking computedAt (never suppress); otherwise true only when `stored.computedAt < snapshotCollectedAt` (strictly older — equality counts as fresh). Module docstring extended with the trigger-rules decision table.
- **`tests/unit/correlation-persistence.test.ts`** — new `shouldTriggerReanalysis` describe with 11 cases covering every decision-table row (live/queued suppression, null/undefined/NaN collectedAt, absent stored, error stored, legacy no-computedAt, strictly-older triggers, equal and newer do not trigger). File now has 29 tests.
- **`src/dashboard/hooks/useCorrelations.ts`** — added the storage.onChanged effect (empty deps, cleanup removes listener, mirrors useSnapshot.ts): ignores non-'local' areas. Branch A (correlations key): shape-checks newValue (object + Array.isArray(matches)), echo-dedupes against lastAppliedRef, routes through `applyResultRef.current(...)` — never setCorrelations directly. Branch B (latestSnapshot / lastCollectionAt): reads collectedAt, runs the pure pre-filter, then sendMessage('CORRELATION_RUN_STATE') with ok-unwrap; suppresses when live||queued; otherwise `runCorrelationRef.current()`. All async steps guarded by mountedRef.
- **`tests/e2e/fixtures.ts`** — added `__trendcastStorageEvents` recorder listener (records { key, area } for the three watched keys) so specs can assert the listener saw the collection event.
- **`tests/e2e/dashboard.spec.ts`** — new test 're-runs analysis when a collection completes': dispatches a synthetic latestSnapshot write via `page.evaluate` → `globalThis.browser.storage.local.set` (the mock's notifyChange synchronously fires onChanged), asserts the storage event was observed and the CORRELATE_ALL counter increased by exactly 1.

### Task 2: race hardening — no double runs, no echoes, no unmount leaks

- **`src/dashboard/hooks/useCorrelations.ts`** — added `lastAppliedRef` ({ requestId, computedAt } recorded in applyResult) for broadcast-echo dedupe; `triggerInFlightRef` set synchronously before the liveness check and cleared in finally (closes the pre-filter→response race); `mountedRef` with mount/unmount effect guarding every async continuation.
- **`tests/e2e/fixtures.ts`** — mock liveness simulation (opt-in `globalThis.__trendcastSlowCorrelation`): a custom `__messageHandlers` handler (checked before cannedResponses) holds CORRELATE_ALL ~1500ms with `__trendcastCorrelationLive=true` (cleared before resolve), and CORRELATION_RUN_STATE returns the wrapped wire format `{ ok: true, data: { live, queued: false, requestId, activeRequestId } }` matching src/messaging/index.ts. Other message types return undefined — canned behavior untouched.
- **`tests/e2e/dashboard.spec.ts`** — new test 'does not double-run when a run is already active': enables slow mode, clicks Re-analyze (run held live ~1500ms), immediately dispatches the snapshot event, asserts the CORRELATE_ALL counter increased by exactly 1 total — the collection event landed mid-run, CORRELATION_RUN_STATE reported live:true, and the trigger suppressed the second run.

### Task 3: full regression gate

All gates green (see Verification below). The 16-01 cached-first behavior composes correctly: 'shows cached results without auto-analyze' still passes with the listener registered.

## Verification

| Gate | Command | Result |
|------|---------|--------|
| Unit (target file) | `bun run test -- --run tests/unit/correlation-persistence.test.ts` | 29 passed (29) |
| Typecheck | `bun run typecheck` | exit 0 |
| Lint | `bun run lint` (max-warnings 0) | exit 0 |
| Dashboard e2e | `bun run test:e2e -- dashboard.spec.ts` | 95 passed, 3 failed (all 3 pre-existing, see Deviations) |
| Full unit suite | `bun run test` | 35 files, 445 passed (434 baseline + 11 new) |
| Full e2e suite | `bun run test:e2e` | 138 passed, 5 failed (all 5 pre-existing, see Deviations) |
| Firefox build | `bun run build:debug:firefox` | exit 0, built in 2.49s |

Both new e2e tests pass: the collectNow-trigger test observes exactly +1 CORRELATE_ALL after a synthetic snapshot change; the no-double-run test observes exactly 1 total invocation when the collection event lands during a mock-live manual run.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written. Task 2's implementation was folded into the same edit batch as Task 1 (one cohesive change to the shared files) rather than as a separate pass; all Task 2 acceptance criteria were verified independently after the batch.

### Pre-existing failures (documented, NOT fixed — out of scope)

**Dashboard (3, known from 16-01, in `deferred-items.md`):** 'engine dropdown has all 6 engine options' (line 552), 'shows correlation engine radio buttons' (line 1150), 'heuristic engine is selected by default' (line 1158) — 6-vs-5 engine-count mismatch from commit `975a7a1` (zero-shot removal).

**Popup (2, newly surfaced by this plan's first full-suite e2e run):** 'shows 6 engine radio buttons' (popup.spec.ts line 227), 'heuristic engine is selected by default' (line 235) — identical 6-vs-5 root cause from the same commit. `tests/e2e/popup.spec.ts` is unmodified in the working tree (last touched by `975a7a1`); no popup source files were changed by Phase 16. These are pre-existing failures that prior phases never observed because only `dashboard.spec.ts` was run.

**Recommended fix (deferred):** update all 5 tests to expect the remaining 5 engines (heuristic, embedding, sentiment, ner, llm).

## Known Stubs

None — no placeholder data, no unwired components, no skipped tests.

## Authentication Gates

None encountered.

## Notes for Verification

- The trigger is observable in the live dashboard: run a collection (collectNow) with the dashboard open on the Correlations tab — analysis re-runs automatically once, unless a run is already active or the stored result is newer than the snapshot.
- The e2e mock liveness simulation is opt-in and page-scoped (`__trendcastSlowCorrelation`); default mock behavior is unchanged.