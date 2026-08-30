---
phase: 16-correlation-persistence-analysis-triggers
verified: 2026-08-30T09:00:00Z
status: passed
score: 12/12 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Reload the extension (chrome://extensions → reload) with existing collected data, then open the dashboard Correlations tab"
    expected: "Cached results render instantly from storage.local with the freshness badge; no automatic CORRELATE_ALL fires on open"
    why_human: "Requires a real extension reload and real service-worker lifecycle — the e2e mock cannot reproduce SW restart semantics"
  - test: "Force an ML engine error (go offline / block the Hugging Face CDN) and run Re-analyze while a good cached result exists"
    expected: "The error is shown for the active run but the stored non-error result survives in CONFIG.storage.correlations; reopening the tab still shows the good cached result"
    why_human: "Requires a real ML runtime failure; the write policy is unit-tested at the helper level but the real background catch-path is not exercised by automated tests"
  - test: "Run Collect Now with the dashboard open on the Correlations tab (real collection, not the synthetic mock event)"
    expected: "Correlation analysis re-runs automatically exactly once after the collection completes; the header badge shows a fresh computedAt"
    why_human: "Requires the real background collection pipeline writing real snapshot keys; e2e covers the synthetic storage event only"
  - test: "Restart the browser entirely and reopen the dashboard"
    expected: "Correlation results are still present (browser.storage.local persistence across browser restarts)"
    why_human: "Requires a real browser restart; no automated test can survive process death"
---

# Phase 16: Correlation Persistence & Analysis Triggers Verification Report

**Phase Goal:** Correlation results persist across dashboard sessions with freshness metadata; errors never destroy good cached results; opening the dashboard shows cached results instantly without auto-analyzing; collection completion triggers re-analysis in the open dashboard.
**Verified:** 2026-08-30T09:00:00Z
**Status:** passed (all 12 must-have truths verified in code + tests; all 4 real-extension manual checks passed via UAT on 2026-08-30 — see 16-UAT.md)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

**16-01 truths (TRIG-01, TRIG-02, TRIG-04):**

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every terminal correlation run path (success, ML error, cancel, precompute success/error/throw, SW-death recovery) persists the result with computedAt + engine, and model/inputCounts where in scope | ✓ VERIFIED | `src/utils/correlation-persistence.ts` exports the full helper set; `src/background/index.ts` has 4 `persistCorrelationResult` call sites + 1 import (grep count = 5): success path (line 1076, stamped with model + inputCounts), catch-path (line 1132, stamped with engine + model), SW-death recovery (line 361, stamped with marker.model), precompute (line 1305, stamped with model + inputCounts, with local try/catch converting a throw into a terminal error result). Write policy enforced at the single choke point and unit-tested (29/29 pass) |
| 2 | An error result never overwrites a stored non-error result; the CORRELATION_RESULT broadcast still fires | ✓ VERIFIED | Unit test `error over stored non-error returns false AND the stored value is unchanged` passes; all 4 call sites send the CORRELATION_RESULT broadcast outside/after the persist call (lines 1093, 1143, 372, 1318) — the broadcast is not gated on persist success |
| 3 | A persisted error result is treated as 'no analysis' by the auto-run gate | ✓ VERIFIED | `hasFreshAnalysis` returns `stored != null && !stored.error` (correlation-persistence.ts); unit tests `returns false for an error result` and `returns true for a legacy good result lacking computedAt` pass |
| 4 | Opening the dashboard with a stored non-error result renders it instantly and sends zero CORRELATE_ALL messages | ✓ VERIFIED | e2e `shows cached results without auto-analyze` passes: counter `__trendcastCorrelateAllCalls === 0` and cached text 'BTC to the moon' renders (dashboard.spec.ts:788) |
| 5 | Opening with no stored result (or error-only) and snapshot data present auto-runs exactly once per session | ✓ VERIFIED | e2e `auto-runs analysis when no stored result exists` passes (counter ≥ 1 with `'trendcast:correlations': null`); once-per-session enforced structurally — `corrInitRef.current = true` is set BEFORE the freshness check in App.tsx:224, so the gate cannot re-fire |
| 6 | Header shows computedAt as relative time + engine; legacy results show 'unknown age'; results older than last collection show a stale marker | ✓ VERIFIED | App.tsx:500-504 renders all three branches; e2e tests `header shows computedAt and engine from cached result` (/computed \d+[smhd] ago/ + 'heuristic'), `header shows unknown age for legacy results` (/unknown age/i), `header marks stale results after a newer collection` (/stale/i) all pass |
| 7 | Corrupt, absent, or wrong-shaped stored data degrades to 'no analysis' — nothing thrown into the UI | ✓ VERIFIED | `readStoredAnalysis` try/catch → null; null when not an object or `matches` not an array; unit tests for absent/string/non-array-matches all pass; e2e seeds `'trendcast:correlations': null` without error |

**16-02 truths (TRIG-03):**

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 7 | When a collection completes, the dashboard re-runs analysis automatically — exactly once per collection, no double ML runs | ✓ VERIFIED | e2e `re-runs analysis when a collection completes` passes: counter increases by exactly +1 after a synthetic latestSnapshot write with newer collectedAt; `__trendcastStorageEvents` confirms the listener saw the event |
| 8 | Trigger suppressed when a run is live/queued or when stored analysis is at least as fresh as the snapshot | ✓ VERIFIED | e2e `does not double-run when a run is already active` passes (exactly 1 total invocation with `__trendcastSlowCorrelation` mock liveness reporting live:true); queued suppression + equal/newer computedAt suppression unit-tested in `shouldTriggerReanalysis` (11 cases) |
| 9 | Trigger never fires from the dashboard's own CORRELATION_RESULT broadcast or unrelated storage keys | ✓ VERIFIED | Listener Branch B arms ONLY on `CONFIG.storage.latestSnapshot` / `CONFIG.storage.lastCollectionAt` (useCorrelations.ts:429-431); the correlations key goes to Branch A (apply, not trigger); broadcast echo deduped via `lastAppliedRef` (requestId + computedAt both match → skip); the trigger e2e confirms counter goes 0 → exactly 1 with no runaway loop |
| 10 | A stored result without computedAt (legacy) is NOT fresh for trigger purposes — a collection completion still re-runs | ✓ VERIFIED | `shouldTriggerReanalysis` returns true when `stored.computedAt` is not finite; unit test `returns true for a legacy stored result without computedAt` passes; display/trigger predicate split documented in the module docstring |
| 11 | The trigger routes through the same applyResult guard — no direct setState from the storage listener | ✓ VERIFIED | grep confirms `setCorrelations` appears only at line 97 (useState), 136 (mount-load), 183 (inside applyResult itself); the onChanged listener body calls only `applyResultRef.current(...)` (line 423) |

**Score:** 12/12 truths verified (0 present-but-behavior-unverified)

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| TRIG-01 | 16-01 | Freshness metadata on every terminal path; errors never clobber fresh good cached results | ✓ SATISFIED | Helper module + 4 wired call sites + `computedAt`/`model`/`inputCounts` on CorrelationResult (types/index.ts:283-287) + 29 unit tests |
| TRIG-02 | 16-01 | Cached results instantly on tab open; no auto-analyze; analyze only when none exists | ✓ SATISFIED | `loaded` flag + corrInitRef gate (App.tsx:212-238) + 2 e2e tests (0 calls with cache, ≥1 without) |
| TRIG-03 | 16-02 | Re-analyze triggers when collection completes via storage.onChanged on snapshot keys | ✓ SATISFIED | `shouldTriggerReanalysis` + onChanged listener (Branch A/B) + 2 e2e tests (trigger fires +1, no double-run) |
| TRIG-04 | 16-01 | Correlations header shows computedAt + engine (stale badge) | ✓ SATISFIED | Header badge (App.tsx:499-505) + 3 e2e tests (fresh, legacy unknown-age, stale) |

No orphaned requirements: REQUIREMENTS.md maps exactly TRIG-01..04 to Phase 16 (TRIG-05 is explicitly deferred at milestone level, not mapped to this phase). All 4 IDs are claimed across the two plans' frontmatter (16-01: TRIG-01/02/04; 16-02: TRIG-03).

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/utils/correlation-persistence.ts` | stampCorrelationResult, persistCorrelationResult, hasFreshAnalysis, readStoredAnalysis, shouldTriggerReanalysis, CorrelationInputCounts, CorrelationStampMeta, CorrelationRunLiveness | ✓ VERIFIED | All 8 exports present; 200-line module with full decision-table docstrings; imported by background/index.ts, useCorrelations.ts, App.tsx |
| `src/types/index.ts` | CorrelationResult gains optional computedAt, model, inputCounts | ✓ VERIFIED | Lines 283-287 |
| `src/background/index.ts` | All terminal write sites through persistCorrelationResult; precompute try/catch + broadcast | ✓ VERIFIED | 4 call sites + import; precompute has local try/catch (line ~1288) converting throws into terminal error results and broadcasts CORRELATION_RESULT (line 1318) |
| `src/dashboard/hooks/useCorrelations.ts` | loaded flag; storage.onChanged listener with liveness + freshness guards | ✓ VERIFIED | `loaded` set in mount-load `.finally()` (line 145); listener effect lines 387-482 with echo dedupe, in-flight flag, mountedRef guard, cleanup |
| `src/dashboard/App.tsx` | Auto-run gate on loaded + hasFreshAnalysis; header freshness badge | ✓ VERIFIED | Gate lines 212-238; badge lines 499-505 with timeAgo helper (line 62) |
| `tests/unit/correlation-persistence.test.ts` | Write-policy + stamp + predicate + corrupt-read + trigger coverage | ✓ VERIFIED | 29 tests across 5 describes; 29/29 pass |
| `tests/e2e/fixtures.ts` | MOCK_CORRELATIONS stamped; CORRELATE_ALL counter; storage-events recorder; opt-in liveness mock | ✓ VERIFIED | computedAt/model/inputCounts (lines 257-259); `__trendcastCorrelateAllCalls` incremented at TOP of runtimeSendMessage (line 450); `__trendcastStorageEvents` recorder (381-382); `__trendcastSlowCorrelation` handler (413-438) |
| `tests/e2e/dashboard.spec.ts` | 7 new Correlations Tab tests | ✓ VERIFIED | All 7 present (lines 788-911) and passing in the 95-passed run |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| 4 background terminal write sites | persistCorrelationResult(storage, CONFIG.storage.correlations, stamped) | direct call | ✓ WIRED | grep count 5 (1 import + 4 sites); each site stamps first, warns (not throws) on false |
| App.tsx auto-run gate | hasFreshAnalysis + corrLoaded + snapshot-has-data | import + hook destructure | ✓ WIRED | App.tsx:52 import; gate order: ref-check → corrLoaded → snapshot → data → set ref → freshness → run |
| App.tsx header badge | correlations.computedAt/engine/model off the stored result | direct read | ✓ WIRED | Reads the stored result, not runStats; e2e proves it renders from cache with runStats null |
| e2e CORRELATE_ALL counter | auto-run gate | globalThis.__trendcastCorrelateAllCalls | ✓ WIRED | Increment at TOP of runtimeSendMessage (before handler loop + canned lookup); asserted 0 and ≥1 and +1 in three tests |
| storage.onChanged snapshot keys | shouldTriggerReanalysis → CORRELATION_RUN_STATE → runCorrelationRef | listener Branch B | ✓ WIRED | Pure pre-filter, then ok-unwrap liveness check, then run; triggerInFlightRef closes the race; mountedRef guards continuations |
| onChanged correlations-key branch | applyResultRef.current(result) | single entry point | ✓ WIRED | No direct setCorrelations in the listener body (grep-verified) |
| CORRELATION_RUN_STATE handler | { live, requestId, queued, activeRequestId } | background/index.ts:774 | ✓ WIRED | Mock returns the wrapped { ok, data } wire format matching src/messaging/index.ts |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| Header badge | correlations.computedAt / engine / model | browser.storage.local['trendcast:correlations'] via useCorrelations mount-load | Yes — real storage read; e2e renders actual values | ✓ FLOWING |
| Auto-run gate | correlations + snapshot | storage mount-load + useSnapshot | Yes — real storage state decides the gate | ✓ FLOWING |
| Re-analysis trigger | snapshotCollectedAt | changes['trendcast:latest-snapshot'].newValue.collectedAt | Yes — from the actual storage event payload | ✓ FLOWING |
| shouldTriggerReanalysis | stored | readStoredAnalysis(browser.storage.local, ...) | Yes — real storage read inside the listener | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Write-policy + trigger unit coverage | `bun run test -- --run tests/unit/correlation-persistence.test.ts` | 29 passed (29), 622ms | ✓ PASS |
| Full unit suite | `bun run test` | 35 files, 445 passed (445) | ✓ PASS |
| Typecheck | `bun run typecheck` | exit 0 | ✓ PASS |
| Lint (max-warnings 0) | `bun run lint` | exit 0 | ✓ PASS |
| Firefox debug build | `bun run build:debug:firefox` | exit 0, built in 2.60s | ✓ PASS |
| Dashboard e2e (incl. all 7 new Phase 16 tests) | `bun run test:e2e -- dashboard.spec.ts` | 95 passed, 3 failed (all 3 pre-existing, see below) | ✓ PASS |

### Probe Execution

No probe scripts declared by the phase (`scripts/*/tests/probe-*.sh` absent; PLAN/SUMMARY declare none). Step 7c: SKIPPED — no probes in scope.

### Pre-existing e2e Failures (NOT phase regressions)

3 dashboard + 2 popup e2e failures, all with the identical pre-existing root cause: commit `975a7a1` removed the zero-shot engine (6 → 5 options) without updating the tests. Documented in `deferred-items.md` with a recommended fix. Verified pre-existing: `git log` shows popup.spec.ts last touched by `975a7a1`; no popup source files modified in this phase's working tree. These do not count against Phase 16.

| File | Test | Root cause |
| ---- | ---- | ---------- |
| tests/e2e/dashboard.spec.ts:552 | engine dropdown has all 6 engine options | 6-vs-5 engine count (975a7a1) |
| tests/e2e/dashboard.spec.ts:1150 | shows correlation engine radio buttons | same |
| tests/e2e/dashboard.spec.ts:1158 | heuristic engine is selected by default | same |
| tests/e2e/popup.spec.ts:227 | shows 6 engine radio buttons | same |
| tests/e2e/popup.spec.ts:235 | heuristic engine is selected by default | same |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (none) | — | No TBD/FIXME/XXX/PLACEHOLDER markers in any of the 8 phase-modified files | — | — |

Debt-marker gate: clean — zero unreferenced markers across all phase files.

### Prohibition Checks (must-NOT block)

| Prohibition | Verification | Status |
| ----------- | ------------ | ------ |
| Error result never overwrites a stored non-error result | Unit test asserts helper returns false AND stored value unchanged; enforced inside persistCorrelationResult | ✓ VERIFIED (test-tier evidence wired) |
| Dashboard never auto-runs when a stored non-error result exists | e2e asserts counter === 0 with fresh cache | ✓ VERIFIED |
| Persistence failure never breaks the terminal path | Helper body try/catch → false; call sites only console.warn; unit test `a storage failure returns false instead of throwing` passes | ✓ VERIFIED |
| Listener never calls setCorrelations directly | grep: setCorrelations only in useState/mount-load/applyResult; listener routes through applyResultRef | ✓ VERIFIED |
| Trigger never fires while a run is live/queued | e2e no-double-run test + unit liveness cases | ✓ VERIFIED |
| Trigger never fires from own broadcast echo or unrelated keys | Branch B arms only on snapshot keys; echo dedupe via lastAppliedRef; e2e counter stable at exactly +1 | ✓ VERIFIED |

### Human Verification Required — RESOLVED (2026-08-30)

All 4 items in the frontmatter `human_verification` list were executed as UAT tests 1–4 and ALL PASSED (full evidence in 16-UAT.md):

1. Extension reload → cached-first: PASS (badge "computed 2m ago · heuristic", zero CORRELATE_ALL, runState idle)
2. Forced ML error → good cache survives: PASS (real error via `correlate embedding=nonexistent/model-xyz`; "Kept existing non-error correlation result"; stored result identical before/after)
3. Real Collect Now → single auto re-run + fresh badge: PASS (exactly one dashboard CORRELATE_ALL `corr-1788075914914`; badge "computed 0m ago")
4. Full browser restart → persistence: PASS (stored result survived quit+relaunch, computedAt 1788076237070; fresh tab rendered instantly, no auto re-run)

### Gaps Summary

None. All 12 must-have truths from both plans are verified against actual code with wiring and behavioral evidence; all 4 requirement IDs trace to implementation and passing tests; all automated gates are green (445/445 unit, typecheck 0, lint 0, build 0, dashboard e2e 95 passed with the only 3 failures pre-existing and out of scope); all 4 human-verification items passed via UAT (16-UAT.md, 2026-08-30). The phase goal is achieved.

---

_Verified: 2026-08-30T09:00:00Z (initial code verification 2026-08-29T22:40:00Z; human verification completed 2026-08-30 via UAT)_
_Verifier: the agent (gsd-verifier); UAT executed with the user via the debug bridge_