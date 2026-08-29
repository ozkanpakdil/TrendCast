# Phase 15 Research — ML Run Orchestration & Progress

**Requirements:** MLPROG-01 (requestId-scoped progress/results, serialized queue, guaranteed terminal state), MLPROG-02 (model-download progress events).

## Root causes of stuck progress (verified in code)

1. **Progress is not requestId-scoped** — `useCorrelations` applies every `CORRELATION_PROGRESS` message (`setProgress(data.payload)`), including ones from a concurrent `precompute-*` run. A late precompute progress event can resurrect the bar after the user's run settled.
2. **Error results are not requestId-stamped** — `runCorrelationAsync`'s catch writes `{ matches: [], …, error }` with no `requestId`; the hook's storage-poll fallback accepts results without an id (`!cached.requestId`), so a precompute error can settle the user's `corr-*` UI with the wrong error.
3. **Resolvers are a module singleton** — `runMLCorrelation` overwrites `mlWorkerResolvers`/`mlWorkerRequestId` on every call. Two overlapping runs cross-deliver results; the first resolver to fire settles the wrong promise.
4. **Cancel leaves a hung promise** — `cancelMLCorrelation()` terminates the worker but never rejects the pending promise; `runCorrelationAsync` never settles, so no error result is written to storage.
5. **No persisted run-state marker** — if the MV3 service worker dies mid-run, no tab can tell whether a run was in flight; the UI waits forever.

## Design

- **`src/utils/ml-run-queue.ts`** — framework-free serialized queue: FIFO, one active run, `cancel(requestId)` rejects a queued entry, `isQueued(id)` for the liveness ping. No browser APIs → fully unit-testable.
- **Background wiring** — replace the singleton resolvers with the queue; stamp `requestId` on every terminal result (success + error) inside `runCorrelationWithEngine`; persist a run-state marker (`trendcast:ml-run-state`) on start, clear on terminal; on background startup, an orphaned marker (SW died mid-run) is cleared and an interrupted error result is broadcast for that requestId.
- **Hook scoping** — `useCorrelations` ignores progress messages whose `requestId` ≠ active id, and while loading pings `CORRELATION_RUN_STATE`; if the background reports the run is not live (SW died), it settles with an interrupted error instead of spinning forever.

## Key files

| File | Role |
|------|------|
| `src/utils/ml-run-queue.ts` | new — serialized run queue |
| `src/utils/ml-run-state.ts` | new — persisted run-state marker helpers |
| `src/background/index.ts` | queue wiring, marker lifecycle, requestId stamping |
| `src/dashboard/hooks/useCorrelations.ts` | requestId-scoped progress + stale-run settle |
| `tests/unit/ml-run-queue.test.ts` | new — queue + state tests |