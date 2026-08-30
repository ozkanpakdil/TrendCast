---
phase: 16-correlation-persistence-analysis-triggers
date: 2026-08-29
domain: MV3 extension storage persistence + React dashboard trigger wiring
confidence: HIGH
provides:
  - "Complete map of every correlation terminal path and what it writes today (the TRIG-01 gap)"
  - "Verified CorrelationResult shape and the metadata gap (no computedAt/model/input counts)"
  - "The exact storage.onChanged pattern to mirror (useSnapshot.ts) and the snapshot keys that change on collectNow"
  - "The auto-analyze-on-open code that TRIG-02 must remove/gate (App.tsx corrInitRef effect)"
  - "Error-clobber analysis: today every terminal path wholesale-overwrites the single correlations key"
  - "Test infrastructure map: vitest 2.x + jsdom, vi.mock('@/messaging/browser') pattern, no @testing-library"
decides:
  - "Recommendation: stamp metadata at background persist time (single choke point), not in the worker"
  - "Recommendation: error results persist only when no good result exists; good results are never overwritten by errors"
  - "Recommendation: TRIG-03 = correlations-key onChanged listener for display + guarded snapshot-key trigger (double-run guard via CORRELATION_RUN_STATE)"
assumes:
  - "No new npm packages needed (pure code change) — nothing to verify on a registry"
  - "storage.local persistence across browser restarts is taken as given (platform behavior, already relied on by settings/watchlist)"
---

# Phase 16: Correlation Persistence & Analysis Triggers — Research

**Researched:** 2026-08-29
**Domain:** Chrome MV3 `storage.local` persistence of correlation results + dashboard load/trigger behavior
**Confidence:** HIGH (every claim below was verified by reading the cited file this session; no external packages or APIs involved)

<user_constraints>
## User Constraints (from copilot-instructions.md + REQUIREMENTS.md)

### Project Git Rules (MANDATORY)
- **NEVER** run `git commit`, `git push`, `git add`, `git stash`, `git tag`, or `npm publish`. Read-only git only (`git log/diff/status/show/branch/blame`). The user handles all git operations. [VERIFIED: .github/copilot-instructions.md:1-10]
- Bun only, never npm/npx (project convention; all package.json scripts run via `bun run`).

### Out of Scope (from REQUIREMENTS.md — do not let the plan drift into these)
- **TRIG-05** (cross-run embedding cache persistence) is explicitly deferred to v0.1.7+. [VERIFIED: .planning/REQUIREMENTS.md "Analysis Triggers & Persistence" deferred section]
- **Auto-analyze on every tab open** is listed in "Out of Scope": "Re-runs multi-minute ML job on every new-tab; duplicates background precompute; caused the stuck-progress confusion. Cached-until-recollect with visible `computedAt` instead." [VERIFIED: .planning/REQUIREMENTS.md Out of Scope table]
- **Persisting intermediate progress states to storage** is out of scope: "Progress is ephemeral UI state… Persist only terminal results." [VERIFIED: .planning/REQUIREMENTS.md Out of Scope table]
- 100% client-side, no API keys (hard constraint). [VERIFIED: .planning/REQUIREMENTS.md Out of Scope table]
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRIG-01 | Every terminal path (success, ML error, cancel) writes `CONFIG.storage.correlations` with `computedAt` + input metadata; error results never clobber fresh good cached results | Q1/Q2/Q5 findings: 6 terminal write sites identified (index.ts:357, 1056, 1099, 1241 + the cancel path that flows through 1056 + the precompute-throw path that writes nothing); `CorrelationResult` has no `computedAt`/`model`/input-count fields today (types/index.ts:262-283) |
| TRIG-02 | Cached results show instantly on tab open; no auto-analyze on load; auto-run only when no stored (non-error) analysis exists | Q3 findings: `App.tsx:199-215` corrInitRef effect auto-runs `runCorrelation` on first snapshot — this is the code to remove/gate; `useCorrelations.ts:109-124` already loads cache on mount; `cached.error` already read at hook line 117 |
| TRIG-03 | collectNow completion triggers re-analysis via `storage.onChanged` on snapshot keys, mirroring the `useSnapshot` pattern | Q4/Q6 findings: snapshot keys written at index.ts:981-982; exact listener pattern at useSnapshot.ts:56-67; background precompute already re-analyzes after collection (index.ts:1000) but never broadcasts — dashboard misses it today |
| TRIG-04 | Correlations header shows `computedAt` + engine so live vs cached is distinguishable | Q3/Q5 findings: header row at App.tsx:468-476; `CorrelationStatsBar` only renders after an in-session run (runStats is null on cache-load), so the badge must read `correlations.computedAt`/`engine` directly |
</phase_requirements>

## Summary

Phase 16 is a **wiring and metadata phase** — no new libraries, no protocol redesign. The persistence key (`CONFIG.storage.correlations` = `'trendcast:correlations'`) already exists and already survives restarts; what's missing is (a) freshness metadata on the result, (b) a write-policy that stops errors from clobbering good results, (c) removal of the dashboard's auto-analyze-on-open, and (d) a `storage.onChanged` listener so post-collection precompute results actually reach an open dashboard.

The critical discovery: **there are six distinct terminal paths and they behave inconsistently today.** `runCorrelationAsync` writes success results (index.ts:1056), catch-path errors (1099), and cancel-as-ML-error (via the same 1056 path) — all wholesale overwrites with no metadata. `runCorrelationPrecompute` (post-collection) writes at 1241 but has **no local error handling** — a cancelled or thrown precompute writes nothing. The SW-death recovery path (357) writes an interrupted error result that **clobbers any fresh good result**. None of these write `computedAt` — the field does not exist on `CorrelationResult` (types/index.ts:262-283).

On the dashboard side, TRIG-02's target is precise: `App.tsx:199-215` fires `runCorrelation(...)` once per session whenever a snapshot with data exists — that is the auto-analyze-on-open. The hook already loads cached results on mount (useCorrelations.ts:109-124) and already reads `cached.error`, so the "no stored (non-error) analysis" existence check has all its inputs. TRIG-03's mirror pattern is `useSnapshot.ts:56-67`; the snapshot keys that change on collectNow are written at index.ts:981-982. One tension needs a planner decision: the background **already** re-analyzes after every collection (`runCorrelationPrecompute`, index.ts:1000), so a naive dashboard-side snapshot trigger would double-run — the guard is the Phase 15 `CORRELATION_RUN_STATE` liveness message (index.ts:761-768).

**Primary recommendation:** Add `computedAt`, `model`, and `inputCounts` to `CorrelationResult`; stamp them in one background helper at persist time (not in the worker); enforce the write-policy "errors never overwrite a non-error stored result" inside that helper; delete the App.tsx auto-run effect and replace it with a gated "auto-run only if no stored non-error result" check; add a `storage.onChanged` listener on the correlations key (display refresh) plus a guarded snapshot-key listener (re-analysis trigger) in `useCorrelations`; render `computedAt` + engine in the App.tsx correlations header.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Result metadata stamping (computedAt/engine/model/counts) | Background (service worker) | — | Only the background knows terminal-path context and input counts; worker results are engine-internal |
| Write-policy (error never clobbers good) | Background (service worker) | — | All six write sites live in `src/background/index.ts` |
| Existence check (auto-run gate) | Dashboard (React) | Background (CORRELATION_RUN_STATE for liveness) | The dashboard owns "should I analyze" decisions; background owns "is a run in flight" |
| Cached-result display on open | Dashboard (React) | — | `useCorrelations` mount-load already does this |
| Re-analysis trigger on collectNow | Dashboard (React, storage.onChanged) | Background (precompute already enqueues) | Requirement mandates the useSnapshot-mirroring listener pattern |
| Freshness badge (computedAt + engine) | Dashboard (React) | — | Pure display over persisted metadata |
| Durable storage | `chrome.storage.local` (platform) | — | Already used; persists across SW death and browser restarts |

## Findings — Per Research Question

### Q1: What exactly is written to storage today when a correlation run terminates? Where is the gap vs TRIG-01?

**Storage key exists** [VERIFIED: src/config/index.ts:182-192] — quoted verbatim from the `storage` block:

```ts
storage: {
    settings: 'trendcast:settings',
    latestSnapshot: 'trendcast:latest-snapshot',
    collectedMarkets: 'trendcast:collected-markets',
    collectedSignals: 'trendcast:collected-signals',
    collectedNews: 'trendcast:collected-news',
    correlations: 'trendcast:correlations',
    correlationRunHistory: 'trendcast:corr-run-history',
    // Phase 15 (MLPROG-01): persisted marker for the in-flight ML run —
    // lets any tab detect a run whose service worker died mid-flight.
    mlRunState: 'trendcast:ml-run-state',
```

**The six terminal write sites** (all in `src/background/index.ts` unless noted):

| # | Path | Site | What it writes | Gap vs TRIG-01 |
|---|------|------|----------------|----------------|
| 1 | Success (dashboard/rpc `runCorrelationAsync`) | `await browser.storage.local.set({ [CONFIG.storage.correlations]: result });` (line 1056) | Full `CorrelationResult` + requestId | No `computedAt`, no model, no input counts |
| 2 | Catch-path error in `runCorrelationAsync` | writes `errorResult` (lines 1089-1100) | Error result with `requestId` stamped | Same metadata gap; **clobbers any good result** |
| 3 | ML-error return from `runCorrelationWithEngine` | returns `{ matches: [], …, engine, requestId, error: errorMsg }` (lines 1174-1176) → persisted by path 1 | Error result | Same; note **cancel flows through here**: `cancelMLCorrelation` (line 564) rejects the promise → caught at line 1147 → `formatMLError` wraps "Correlation cancelled by user." into a generic error string → written as an error result |
| 4 | Post-collection precompute success/ML-error | `runCorrelationPrecompute` writes at line 1241 | Result (may carry `error`) | No metadata; **no `CORRELATION_RESULT` broadcast** — an open dashboard never learns about it (see Q6) |
| 5 | Precompute throws/cancelled | **nothing written** — no local try/catch; rejection propagates to the `.catch()` at line 1000 | — | **Gap: a terminal path that writes nothing.** TRIG-01 says *every* terminal path writes |
| 6 | SW-death recovery at background startup | writes `interruptedResult` (lines 340-362) | Error result with marker's engine/requestId | **Clobbers a fresh good cached result** (violates TRIG-01's second clause) |

**What survives restart today:** the raw result object does persist (storage.local is durable) — the gap is purely metadata + write-policy, not durability. [VERIFIED: write sites above; `useCorrelations.ts:109-124` reads it back on mount]

### Q2: What result shape exists and what metadata needs adding?

**Current shape** [VERIFIED: src/types/index.ts:262-283] — quoted verbatim:

```ts
/** All correlation results from the engine. */
export interface CorrelationResult {
  requestId?: string;
  matches: CorrelationMatch[];
  newsMatches: NewsCorrelationMatch[];
  newsSocialMatches: NewsSocialCorrelationMatch[];
  /** CORR-06: news↔news matches (cross-source only). */
  newsNewsMatches: NewsNewsCorrelationMatch[];
  /**
   * Engine that produced these results.
   * If the requested engine failed, this will be the fallback engine used
   * (or 'heuristic' if no results were produced) and `error` will be set.
   */
  engine?: CorrelationEngine;
  /**
   * Error message if the requested correlation engine failed.
   * When set, the UI should show an error banner telling the user the
   * ML engine didn't work and suggesting they try a different engine
   * or switch to the heuristic engine.
   */
  error?: string;
}
```

`CorrelationEngine` [VERIFIED: src/types/index.ts:167]: `'heuristic' | 'embedding' | 'sentiment' | 'ner' | 'llm'`.

**Metadata to add (all optional, backward-compatible with stored old-shape results):**
- `computedAt?: number` — epoch ms, stamped at persist time.
- `model?: string` — the model id used (empty/omitted for heuristic). Available at every write site: `runCorrelationAsync` receives `model` (index.ts:1023); `runCorrelationPrecompute` derives it (1227-1235); the interrupted-result path can take it from the marker (`MlRunState.model`, [VERIFIED: src/utils/ml-run-state.ts:17-22]).
- `inputCounts?: { markets: number; signals: number; news: number }` — both runners already log these counts (index.ts:1043-1048), so they're in scope at the choke point. A content hash is *not* needed for this phase; counts + `computedAt` vs `lastCollectionAt` comparison is sufficient staleness signal (see Q6).

**Where to stamp:** at the background persist choke point, NOT in the worker. Rationale: the worker builds results in one place (`src/workers/ml-worker.ts:214-221`) but three other result origins bypass it (inline fallback in `runMLCorrelation` index.ts:505-522, heuristic path index.ts:1180-1195, error/interrupted results). A single `persistCorrelationResult(result, meta)` helper in the background covers all six sites uniformly and is unit-testable with the `SettingsStorage` mock pattern.

### Q3: How does the dashboard behave on open today? Where is the auto-analyze?

**Cache load on mount (keep):** `useCorrelations.ts:109-124` reads `CONFIG.storage.correlations` + `correlationRunHistory` on mount, applies the cached result, and sets `error` from `cached.error`. [VERIFIED: src/dashboard/hooks/useCorrelations.ts:109-124]

**Auto-analyze on open (remove/gate — this is the TRIG-02 target):** [VERIFIED: src/dashboard/App.tsx:199-215]

```tsx
  const corrInitRef = useRef(false);
  useEffect(() => {
    // Only run once per dashboard session, and only if we have data
    if (corrInitRef.current) return;
    if (!snapshot) return;
    if (snapshot.markets.length === 0 && snapshot.signals.length === 0) return;
    corrInitRef.current = true;
    // Fire and forget — the hook loads cached results from storage first,
    // and this ensures a fresh computation in the background.
    ...
    runCorrelation(settings.correlationEngine, initModel);
  }, [snapshot]);
```

This fires a full ML run on every dashboard open with data — exactly what REQUIREMENTS.md out-of-scope table calls "the stuck-progress confusion" cause. **Replacement:** gate on existence — auto-run only when the mount-load completed AND no stored non-error result exists. The hook needs to expose a `loaded` flag (mount read settled) so App doesn't fire before the cache read; the gate condition is `loaded && (!correlations || correlations.error) && snapshot has data`.

**Note:** `runStats` is NOT reconstructed from cache on mount (only `correlations` + `runHistory` are) — `CorrelationStatsBar` renders nothing on a fresh tab open even when cached results display. TRIG-04's header badge must therefore read `correlations.computedAt`/`correlations.engine` directly, not `runStats`. [VERIFIED: useCorrelations.ts:109-124 sets only correlations/error/runHistory; CorrelationStatsBar.tsx:15-19 returns null when stats is null]

### Q4: The exact `storage.onChanged` pattern TRIG-03 should mirror

**Canonical pattern** [VERIFIED: src/dashboard/hooks/useSnapshot.ts:56-67] — quoted verbatim:

```tsx
    // Listen for storage changes (background updates snapshot after collection).
    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      if (changes[CONFIG.storage.latestSnapshot]?.newValue) {
        setSnapshot(changes[CONFIG.storage.latestSnapshot].newValue as CollectionSnapshot);
      }
      if (changes[CONFIG.storage.lastCollectionAt]?.newValue) {
        setLastCollectionAt(changes[CONFIG.storage.lastCollectionAt].newValue as number);
      }
    };

    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
```

The same shape is used in `useMarketNews.ts:31-42`, `App.tsx:180-190` (socialHealth), `HistoryChart.tsx:102`, `MarketOdds.tsx:122`, `Watchlist.tsx:91` — six existing precedents; this is a settled house pattern. Note the listener signature receives `(changes, areaName)`; every existing usage ignores `areaName` (all writes are to `local`).

### Q5: How should "error never clobbers fresh good cached result" be structured?

**What the code does today:** every terminal path wholesale-overwrites the single key, including error results (sites 2, 3, 4, 6 in Q1's table). A fresh good result IS clobbered by a later ML error, by a cancel, and by SW-death recovery. [VERIFIED: index.ts:1056, 1099, 1241, 357]

**Recommended write-policy (single helper, enforced at persist time):**

| Incoming result | Existing stored result | Action |
|-----------------|------------------------|--------|
| success (no `error`) | anything | Overwrite with stamped result |
| error | absent, or existing is also an error | Overwrite (error is visible after restart; nothing good lost) |
| error | existing is non-error | **Do not overwrite the correlations key.** Broadcast `CORRELATION_RESULT` anyway (the active run's UI settles via the requestId-scoped message path — Phase 15 already guarantees this), optionally persist the error text to a small side key for post-restart visibility |

This satisfies both halves of success criterion 2: a good result is never clobbered, and a persisted error result (which only exists when there was nothing good) is treated as "no analysis" by the TRIG-02 existence check (`stored && !stored.error`), so it never suppresses future auto-analysis.

**Why not a separate error key as the primary design:** the dashboard's storage-poll fallback (useCorrelations.ts:231-252) and mount-load both read the single correlations key; splitting storage across two keys means every reader (hook mount, poll, `runAlertSweep` at index.ts:619-620, `rebuildMarketNewsView` at 647, `appendHistoryEntry` at 1409, `EXPORT_DATA` at 808) must consult two keys. The read-modify-write policy inside one persist helper keeps all consumers unchanged. A side key for last-error text is optional polish, not structure.

**Race safety:** the Phase 15 `MlRunQueue` serializes runs, and `runCorrelationAsync` is the only concurrent writer for dashboard runs — but precompute (path 4) writes *outside* the queue's result flow (it calls `runCorrelationWithEngine` directly, index.ts:1237). Two writers can interleave: a `precompute-*` result landing while a `corr-*` run is in flight would overwrite, then be overwritten. The existing storage-poll guard ("results without a requestId are only accepted when no run is active", useCorrelations.ts:238-243) protects the UI, but the storage key itself can flip-flop. The persist helper should follow the same rule the queue established: **a `precompute-*` write must not displace a newer `corr-*` result** — simplest guard: read-modify-write compares `computedAt`/`requestId` prefix and keeps the newer dashboard-run result. Planner should decide whether precompute writes are skipped entirely while `mlRunQueue.activeRequestId` is a `corr-*` run (the queue is already consulted by `CORRELATION_RUN_STATE`, index.ts:761-768).

### Q6: Where does collectNow complete, and which storage keys change?

**Collection completion path:** `TRIGGER_COLLECTION` handler (index.ts:705-709) and the hourly alarm (index.ts:613-616) both call `runCollection()`, which ends by writing **two keys** [VERIFIED: index.ts:981-982]:

```ts
  await browser.storage.local.set({
    [CONFIG.storage.latestSnapshot]: snapshot,
    [CONFIG.storage.lastCollectionAt]: snapshot.collectedAt,
  });
```

then immediately fires the post-collection re-analysis [VERIFIED: index.ts:996-1001]:

```ts
  runCorrelationPrecompute(markets, signals, news, settings).catch((err) =>
    console.error('[TrendCast] Pre-compute correlations failed:', err),
  );
```

**The gap TRIG-03 actually closes:** the precompute writes its result to `CONFIG.storage.correlations` (line 1241) but **never broadcasts `CORRELATION_RESULT`** — and the dashboard has **no `storage.onChanged` listener on the correlations key** (its only fallback is the poll that runs *while loading*, useCorrelations.ts:231-252). So with the dashboard open during a collectNow, fresh correlations land in storage and are not displayed until remount. The useSnapshot-mirroring fix has two parts:

1. **Display refresh:** listen on `CONFIG.storage.correlations` in `useCorrelations` and apply non-error changes (mirroring useSnapshot verbatim). This alone delivers "user gets fresh correlations after collecting" for the open-dashboard case.
2. **Trigger (the requirement's literal wording):** listen on the snapshot keys (`latestSnapshot` / `lastCollectionAt`) and trigger re-analysis — **guarded** to avoid the double-run with precompute: skip when `CORRELATION_RUN_STATE` reports a live/queued run (the precompute enqueues synchronously inside `runCollection` before the snapshot write resolves for ML engines, so the liveness check is reliable at that moment), and skip when the stored result is already fresh (`computedAt >= snapshot.collectedAt`). Alternative (simpler, also compliant): rely on precompute for the trigger and implement only part 1 — flag for planner/user decision since the requirement text names the snapshot-key listener explicitly.

**Popup:** the popup does not touch correlations at all (no `CORRELATE_ALL`/correlations references in `src/popup/**`). [VERIFIED: grep returned empty]

### Q7: Test infrastructure to pattern-match

[VERIFIED: package.json:21,62,69; vite.config.ts:68-72]

- **Runner:** Vitest `^2.0.5`, `environment: 'jsdom'`, globals on; Playwright specs excluded. Commands: `bun run test` (all), `bun run test -- --run tests/unit/<file>` (single). Typecheck `bun run typecheck`, lint `bun run lint` (max-warnings 0), build `bun run build:debug:firefox`.
- **Background/storage test pattern (pattern-match this):** `tests/unit/alerts.test.ts:24-58` — `vi.mock('@/messaging/browser', ...)` with an in-memory `store` Map backing `browser.storage.local.get/set` plus `runtime.sendMessage` capture. Same pattern in `cross-source-alerts.test.ts`, `storage-budget-authority.test.ts`, `tiktok-collector.test.ts`.
- **Narrow-storage-helper pattern (best fit for the persist helper):** `src/utils/ml-run-state.ts` takes a `SettingsStorage` interface (`get(keys: string)`, `set(items)`) — defined in `src/utils/settings.ts:21-25` — and `tests/unit/ml-run-queue.test.ts:131-139` drives it with a plain in-memory mock, no `vi.mock` needed. A new `src/utils/correlation-persistence.ts` (or similar) with `stampResult`/`persistCorrelationResult`/`readStoredAnalysis` behind `SettingsStorage` is directly testable this way.
- **Hook tests: none exist.** No `@testing-library/react` in devDependencies and zero `renderHook` usages — do not plan hook unit tests without adding a dependency (out of scope for this phase; cover trigger logic via extracted pure helpers + e2e).
- **E2E:** `tests/e2e/fixtures.ts` already mocks `storage.onChanged` (lines 357-360, 436), seeds `'trendcast:correlations': MOCK_CORRELATIONS` (line 273), and cans `CORRELATE_ALL` (line 378). `tests/e2e/dashboard.spec.ts:532-580` has a Correlations-tab describe block to extend (e.g. "shows cached results without auto-analyze", "header shows computedAt + engine"). Note `MOCK_CORRELATIONS` (fixtures.ts:212-247) has no `computedAt` — update the fixture when the field lands.
- **Baseline:** 416/416 unit tests passing across 34 files (Phase 15 close-out). [VERIFIED: .planning/phases/15-ml-run-orchestration-progress/15-02-SUMMARY.md verification section]

### Q8: MV3 service-worker considerations for persistence

- **Durability:** `chrome.storage.local` persists across SW death and browser restarts — this is already the design backbone (the messaging layer's own header comment: "In MV3, the service worker can be killed between messages. Never rely on in-memory state persisting — always use chrome.storage."). [VERIFIED: src/messaging/index.ts:14-16] No `storage.session` needed — results must survive browser restarts, which only `local` guarantees.
- **SW death mid-write:** a single `storage.local.set({ [key]: value })` is atomic per key; the risk window is "SW died before the set resolved" — the same window Phase 15's run-state marker recovery already covers (orphaned marker → interrupted result broadcast, index.ts:337-362). The recovery path's write must go through the new write-policy too (today it clobbers — Q1 site 6).
- **No idle-timer interaction:** the persist happens on the terminal path after the worker resolves; the 5-minute ML worker idle timeout (index.ts:417) is unrelated to storage writes.
- **Storage budget:** `correlations` is in `BUDGET_KEYS` (src/utils/storage.ts:30) but `pruneStorageIfNeeded` only prunes history/signals/news/markets (storage.ts:151-224) — correlations are never pruned. Adding ~100 bytes of metadata per result is negligible; no budget work needed. [VERIFIED: src/utils/storage.ts:129-238]

## Recommended Approach

**R1 — Metadata + write-policy helper (TRIG-01).** New `src/utils/correlation-persistence.ts` (SettingsStorage-convention, like `ml-run-state.ts`):
- `stampCorrelationResult(result, { engine, model, inputCounts })` → returns result with `computedAt: Date.now()`.
- `persistCorrelationResult(storage, key, result)` → implements the Q4 write-policy (read existing; errors never displace non-error results) and returns whether it persisted.
- `hasFreshAnalysis(stored)` → `!!stored && !stored.error` (the TRIG-02/TRIG-03 existence predicate).
Route all six terminal write sites through it, including SW-death recovery (index.ts:357) and a new local try/catch in `runCorrelationPrecompute` so a cancelled/thrown precompute also reaches a terminal write (Q1 site 5). Extend `CorrelationResult` with optional `computedAt?`, `model?`, `inputCounts?` — optional fields keep old stored results valid.

**R2 — Kill auto-analyze-on-open (TRIG-02).** Delete the `corrInitRef` effect body's unconditional `runCorrelation` (App.tsx:199-215). Replace with: when `useCorrelations` reports mount-load complete AND `!hasFreshAnalysis(cached)` AND snapshot has data → auto-run once. The hook exposes `loaded` (and the cached result) for this; the gate lives in App.tsx where `snapshot` already is.

**R3 — storage.onChanged wiring (TRIG-03).** In `useCorrelations`, add the useSnapshot-verbatim listener pattern for: (a) `CONFIG.storage.correlations` → apply non-error results to state (display refresh; respects the existing requestId guard in `applyResult`), (b) `latestSnapshot`/`lastCollectionAt` → guarded re-analysis trigger: skip if `CORRELATION_RUN_STATE` reports live/queued (precompute already running), skip if stored `computedAt >= snapshot.collectedAt`, else `runCorrelation`. Keep the existing poll/liveness effects untouched.

**R4 — Freshness badge (TRIG-04).** In the correlations section header (App.tsx:468-476), render `correlations.computedAt` (relative time, e.g. "computed 12m ago") + engine (+ model short-name) with a stale indicator when `computedAt < lastCollectionAt`. Data comes straight off the stored result — no new message needed.

**Sequencing:** R1 first (types + helper + tests, no behavior change), then R2/R4 (UI), then R3 (triggers) — R3's guard depends on `computedAt` existing.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Change notification | Custom polling for cached results on tab open | `browser.storage.onChanged` (useSnapshot pattern) | Platform-native, already mocked in e2e fixtures, six in-repo precedents |
| Run liveness for the trigger guard | A new heartbeat/lock | `CORRELATION_RUN_STATE` message + `MlRunQueue.activeRequestId` (Phase 15) | Already built and tested; the queue is the single source of truth for in-flight runs |
| Storage I/O testability | Mocking the whole extension runtime per test | `SettingsStorage` narrow interface (settings.ts:21-25) | Established v0.1.5 convention; ml-run-state.ts proves the pattern |
| Relative-time display | Custom interval-based formatter if not already present | Check `src/dashboard/utils/` first; `toLocaleTimeString` pattern exists in App.tsx (`lastCollectionText`) | Keep UI consistent; avoid a new util for v1 |

**Key insight:** every mechanism this phase needs exists — the work is rerouting six write sites through one policy and swapping one effect's trigger condition.

## Common Pitfalls

### Pitfall 1: The precompute path bypasses everything Phase 15 built
**What goes wrong:** `runCorrelationPrecompute` calls `runCorrelationWithEngine` directly — no run-state marker, no `CORRELATION_RESULT` broadcast, no local error handling. Adding persistence metadata only to `runCorrelationAsync` leaves the most frequent writer (post-collection) unmetadata'd and its failure path write-less.
**Why it happens:** precompute predates the Phase 15 choke-point refactor.
**How to avoid:** enumerate write sites by grepping `storage.correlations]` — there are six (Q1 table); route them all through the helper.
**Warning signs:** after collectNow, dashboard shows stale data until remount; console shows "Pre-compute correlations failed" with no storage change.

### Pitfall 2: Double ML runs after collectNow
**What goes wrong:** dashboard snapshot-listener fires `CORRELATE_ALL` while the background precompute is already queued → two multi-minute ML runs back-to-back.
**How to avoid:** guard the trigger with `CORRELATION_RUN_STATE` liveness + `computedAt >= snapshot.collectedAt` freshness (Q6).
**Warning signs:** log shows two `CORRELATE_ALL`/precompute starts per collection; queue depth 2.

### Pitfall 3: Error results silently suppressing auto-analysis forever
**What goes wrong:** if the existence check is `!!stored` instead of `!!stored && !stored.error`, a persisted error (e.g. model download blocked) permanently blocks auto-analysis.
**How to avoid:** the gate must treat `error` results as "no analysis" (success criterion 2's second clause); the mount-load already surfaces `cached.error` for the banner.
**Warning signs:** error banner shows on open but Re-analyze is the only path forward even after fixing the cause.

### Pitfall 4: Old stored results failing the new shape checks
**What goes wrong:** results persisted before this phase lack `computedAt`; strict validation would discard the user's existing cache.
**How to avoid:** all new fields optional; readers treat absent `computedAt` as "legacy result" (show it, badge as unknown-age or hide badge).
**Warning signs:** upgrade-path testing with pre-phase storage shows empty correlations tab.

### Pitfall 5: Stale-result acceptance via the poll fallback
**What goes wrong:** the storage-poll fallback accepts unstamped results only when no run is active (Phase 15 rule, useCorrelations.ts:238-243); a new onChanged listener that bypasses `applyResult`'s requestId guard would resurrect the cross-run clobbering Phase 15 fixed.
**How to avoid:** route onChanged-applied results through the same `applyResult` guard.
**Warning signs:** a `precompute-*` result overwriting a just-arrived `corr-*` result in the UI.

## Package Legitimacy Audit

**No new packages.** This phase is pure code change across existing files (`background/index.ts`, `dashboard/hooks/useCorrelations.ts`, `dashboard/App.tsx`, `types/index.ts`, `config/index.ts`, new `utils/correlation-persistence.ts`, tests). Nothing to verify on a registry; no install tasks for the planner.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^2.0.5, jsdom environment, globals on |
| Config file | `vite.config.ts` (inline `test` block, lines 68-72) |
| Quick run command | `bun run test -- --run tests/unit/correlation-persistence.test.ts` |
| Full suite command | `bun run test` (416 baseline) + `bun run typecheck && bun run lint` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRIG-01 | Stamp adds computedAt/model/inputCounts | unit | `bun run test -- --run tests/unit/correlation-persistence.test.ts` | ❌ Wave 0 |
| TRIG-01 | Error result does not overwrite stored non-error result; error overwrites error/absent | unit (persist helper, SettingsStorage mock) | same | ❌ Wave 0 |
| TRIG-01 | Precompute throw/cancel still writes a terminal (error) result | unit (extracted precompute-persist logic or handler-level with vi.mock pattern à la alerts.test.ts) | same | ❌ Wave 0 |
| TRIG-02 | `hasFreshAnalysis`: null → false; error result → false; good result → true | unit | same | ❌ Wave 0 |
| TRIG-03 | Snapshot-change trigger respects liveness + freshness guard (pure guard function) | unit | same | ❌ Wave 0 |
| TRIG-04 | Header renders computedAt + engine from cached result | e2e (extend `tests/e2e/dashboard.spec.ts` Correlations block; seed `computedAt` in `MOCK_CORRELATIONS`) | `bun run test:e2e -- dashboard.spec.ts` | ✅ (extend) |
| TRIG-02 | No auto-analyze on open with cached results | e2e (assert no CORRELATE_ALL sent on load with seeded cache) | same | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** quick run (new test file) + `bun run typecheck`
- **Per wave merge:** `bun run test && bun run typecheck && bun run lint`
- **Phase gate:** full suite green + `bun run build:debug:firefox` before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/correlation-persistence.test.ts` — covers TRIG-01/TRIG-02 guard units (mock pattern: `tests/unit/ml-run-queue.test.ts:131-139`)
- [ ] `MOCK_CORRELATIONS.computedAt` seed in `tests/e2e/fixtures.ts:212-247`
- [ ] No framework install needed — infrastructure complete

## Security Domain

`security_enforcement: true`, ASVS Level 1 (.planning/config.json:47-48). This phase adds no auth, sessions, network, or crypto surface — it reorganizes local storage writes.

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | Validate stored-result shape on read (existing pattern: `typeof cached === 'object' && 'matches' in cached`, useCorrelations.ts:113; extend for `computedAt` typeof-number tolerance — corrupt data must degrade to "no analysis", mirroring `readMlRunState`'s corrupt-tolerance, ml-run-state.ts:27-45) |
| V2/V3/V4/V6 | no | No auth/session/access-control/crypto changes |

| Threat Pattern | STRIDE | Standard Mitigation |
|----------------|--------|---------------------|
| Corrupt/oversized stored result breaking dashboard render | Tampering (storage corruption) | Defensive shape checks on read; correlations key is never pruned so quota pressure is unchanged |
| Storage injection via crafted result fields rendered in header | Tampering | React escapes text interpolation; render `computedAt` via `Date` formatting only |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `chrome.storage.local.set` for a single key is atomic/durable enough that no write-queue is needed (SW death mid-write is covered by the Phase 15 marker recovery path) | Q8 | Low — worst case a result write is lost; the run-state marker still lets the UI settle |
| A2 | The precompute enqueues synchronously within `runCollection` for ML engines, so a `CORRELATION_RUN_STATE` check immediately after the snapshot-key change reliably sees it | Q6/Recommended R3 | Medium — if racy, the trigger guard could double-run; mitigation: also compare `computedAt >= collectedAt` before triggering |
| A3 | Old stored results without `computedAt` should display with an "unknown age" treatment rather than being discarded | Pitfall 4 | Low — UX-only; planner/user can prefer hiding the badge |
| A4 | Relative-time formatting needs no new dependency (verify `src/dashboard/utils/` before planning the badge) | Don't Hand-Roll | Low — a 5-line formatter is acceptable fallback |

## Open Questions (RESOLVED)

1. **Should the dashboard trigger re-analysis on snapshot change, or rely on the background precompute + display refresh?**
   - What we know: precompute already re-analyzes after every collection (index.ts:1000); the requirement text says "via storage.onChanged on snapshot keys"; a naive dashboard trigger double-runs.
   - Recommendation: implement both listeners with the R3 guard (liveness + freshness). If the user prefers minimal change, the correlations-key listener alone satisfies the user-visible outcome — raise in discuss-phase.
   - RESOLVED: both listeners with the R3 guard — adopted in 16-02 Task 1 (shouldTriggerReanalysis pure guard + storage.onChanged listener in useCorrelations).
2. **Should `runCorrelationPrecompute` also broadcast `CORRELATION_RESULT`?**
   - What we know: it currently writes storage silently; the new onChanged listener covers open dashboards.
   - Recommendation: yes, for consistency (cheap, `.catch(() => {})` guarded) — but it's optional polish, not a requirement.
   - RESOLVED: yes — adopted in 16-01 Task 2 step 3 (precompute joins the persist+broadcast path with a `.catch(() => {})`-guarded CORRELATION_RESULT broadcast).
3. **Error-result persistence detail:** persist error text to a side key (e.g. `trendcast:corr-last-error`) for post-restart visibility when a good result exists, or broadcast-only?
   - Recommendation: side key is small and useful (error banner survives restart even with good cached results); keep it out of `BUDGET_KEYS` decision unless trivial.
   - RESOLVED: declined as optional polish per the research framing — error results persist through the standard write policy and broadcast (16-01 Task 1 persistCorrelationResult); no side key added.

## Sources

### Primary (HIGH confidence — read this session)
- `src/background/index.ts` — terminal write sites (357, 1056, 1099, 1241), precompute (996-1001, 1227-1260), snapshot write (981-982), message handlers (705-768), SW recovery (337-362), queue wiring (424-580)
- `src/types/index.ts:167, 262-283` — `CorrelationEngine`, `CorrelationResult` (quoted verbatim)
- `src/config/index.ts:182-192` — storage keys (quoted verbatim)
- `src/dashboard/hooks/useCorrelations.ts` — mount load (109-124), applyResult guard (149-183), poll fallback (231-252), liveness poll (258-289)
- `src/dashboard/hooks/useSnapshot.ts:56-67` — the onChanged pattern (quoted verbatim); `useMarketNews.ts`, `useAlerts.ts` — corroborating patterns
- `src/dashboard/App.tsx:199-215, 468-476` — auto-analyze effect, correlations header
- `src/utils/ml-run-queue.ts`, `src/utils/ml-run-state.ts`, `src/utils/settings.ts:21-25` — Phase 15 artifacts + SettingsStorage convention
- `tests/unit/alerts.test.ts`, `tests/unit/ml-run-queue.test.ts`, `tests/e2e/fixtures.ts`, `tests/e2e/dashboard.spec.ts` — test patterns
- `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md`, Phase 15 summaries, `.planning/config.json`

### Secondary (MEDIUM confidence)
- None needed — no external library/API questions arose; all eight research questions were answerable from the repository.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Current-state findings: HIGH — every claim cites a file read this session with verbatim quotes for discrete values
- Recommended approach: HIGH for R1/R2/R4 (mechanical); MEDIUM for R3's trigger guard (A2 timing assumption — mitigated by the freshness comparison)
- Pitfalls: HIGH — all derived from read code paths

**Research date:** 2026-08-29
**Valid until:** 2026-09-28 (stable — no fast-moving external dependencies)