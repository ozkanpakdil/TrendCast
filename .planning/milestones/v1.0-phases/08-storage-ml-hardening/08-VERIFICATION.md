---
phase: 08-storage-ml-hardening
verified: 2026-08-23T17:35:00Z
status: passed
score: 4/6 must-haves verified
behavior_unverified: 2
overrides_applied: 0
behavior_unverified_items:
  - truth: "User's storage stays within the ~7 MB soft budget under sustained collection (no unbounded growth)"
    test: "Run the extension through multiple collection cycles with real data volumes and confirm storage.local usage stays under the 7 MB budget (per-key caps + getBytesInUse()-authoritative pruning)"
    "expected": "After repeated collection cycles, chrome.storage.local usage for TrendCast keys stays ≤ ~7 MB; per-key caps (1000 signals / 1000 news / 1000 markets) hold; pruning fires when over budget"
    why_human: "The per-key caps, getBytesInUse() authority, incremental tracking, and pruning are all unit-tested in isolation, but the sustained-collection runtime invariant (repeated cycles, real data volumes, real UTF-16 serialization) requires a live browser and cannot be proven by grep or unit tests"
  - truth: "ML correlation falls back to WASM without breaking the engine when WebGPU is unavailable"
    test: "Run ML correlation in a browser without WebGPU (e.g., Firefox with WebGPU flag-gated off) and confirm correlation results are still produced via the WASM CPU path"
    expected: "The engine produces correlation results via WASM CPU when WebGPU is absent or fails; no engine breakage; results match the fp32 baseline within tolerance"
    why_human: "The WebGPU→WASM catch-and-retry fallback is unit-tested at the pipeline level (retry on WASM when the WebGPU attempt fails), but the end-to-end engine inference over a real model in a live browser is unexercised"
human_verification:
  - test: "Sustained-collection storage budget"
    expected: "Run the extension through multiple collection cycles; confirm storage.local stays under ~7 MB with per-key caps enforced and pruning firing when over budget"
    why_human: "Requires a live browser with real collection data; unit tests prove the mechanisms in isolation but not the sustained-collection invariant"
  - test: "ML WASM fallback end-to-end"
    expected: "Run ML correlation without WebGPU (Firefox flag-gated); confirm correlation results are produced via WASM CPU without breaking the engine"
    why_human: "Requires a live browser; the pipeline-level fallback is tested but end-to-end engine inference is not"
---

# Phase 8: Storage & ML Hardening Verification Report

**Phase Goal:** Users' storage stays within budget via per-key caps + incremental byte estimation, and ML correlation runs with quantization/WebGPU falling back to WASM
**Verified:** 2026-08-23
**Status:** passed (code-level; 2 live-browser items deferred)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Per-key caps enforced at write time: `mergeSignals` (maxSignals=1000), `mergeNews` (maxNews=1000), `mergeMarkets` (maxMarkets=1000), evicting oldest-first via a shared `capByOldest` helper | ✓ VERIFIED | `src/background/merge.ts` — `capByOldest<T>(items, cap, dateKey)` handles ISO strings (`timestamp`, `publishedAt`) and numeric epoch ms (`lastUpdated`); all three merge functions call it. Wired into `storeSignals`/`storeNews`/`storeMarkets` and `REPORT_*_DATA` handlers (`src/background/index.ts:323,331,339,852,858,864`). `CONFIG.storageBudget.maxSignals/maxNews/maxMarkets` at `src/config/index.ts:217-230` (set to 1000 per user request). 10/10 `storage-budget.test.ts` tests pass (over-cap → capped, oldest evicted, under-cap unchanged, no mutation). |
| 2 | `measureStorageUsage()` uses `getBytesInUse()` as the authoritative budget with reconcile logic; incremental per-key byte tracking exists; pruning uses incremental deltas | ✓ VERIFIED | `src/utils/storage.ts` — `getBytesInUse()` returns authoritative total; `measureStorageUsage()` sums per-key estimates (tracked value or `estimateBytes`), reconciles when `\|authoritative - totalBytes\| > authoritative * 0.2` (trusts `getBytesInUse()`, resets tracker). Module-level `Map<string, number>` with `trackBytes`/`setTrackedBytes`/`getTrackedBytes`/`resetTrackedBytes`. `pruneStorageIfNeeded()` calls `trackBytes(key, -removedBytes)` after each pass. Wired into background (`src/background/index.ts:52,467,618`). 12/12 `storage-budget-authority.test.ts` tests pass, including a behavioral prune test (seeds 7.71 MB → prunes to 4.90 MB). |
| 3 | User's storage stays within the ~7 MB soft budget under sustained collection (no unbounded growth) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | All mechanisms present + wired + unit-tested (caps, `getBytesInUse()` authority, incremental tracking, pruning). But the sustained-collection runtime invariant (repeated cycles, real data volumes, real UTF-16 serialization) requires a live browser — see Human Verification. |
| 4 | All five `get*Pipeline()` functions use a shared `resolveDeviceAndDtype()` helper with WebGPU→WASM catch-and-retry fallback; dtype fallback chain `["q4","q8","fp16","fp32"]`; worker WASM path still works | ✓ VERIFIED | `src/services/engine/ml/transformers.ts` — `resolveDeviceAndDtype()` detects `navigator.gpu`, picks smallest dtype from `DTYPE_FALLBACK_CHAIN`; `createPipelineWithFallback()` retries once on WASM CPU when WebGPU fails. All five pipelines (embedding/sentiment/zero-shot/NER/LLM) use it. Worker WASM path intact: `src/workers/ml-worker.ts:93-106` sets `setWasmPath(deriveWasmPath())` before any pipeline. 14/14 `quantization-equivalence.test.ts` tests pass (device/dtype resolution, all five use webgpu/q4, WASM fallback, WebGPU→WASM retry). |
| 5 | ML correlation falls back to WASM without breaking the engine when WebGPU is unavailable | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | The WebGPU→WASM catch-and-retry fallback is unit-tested at the pipeline level (test confirms 2 calls, second without device = WASM CPU). But end-to-end engine inference over a real model in a live browser (e.g., Firefox flag-gated) is unexercised — see Human Verification. |
| 6 | Quantized (q8/q4) correlation results are equivalent to fp32 within tolerance (golden-test equivalence) | ✓ VERIFIED | `tests/unit/quantization-equivalence.test.ts` — q8 within 0.05 tolerance of fp32, q4 within 0.10, correlation-confidence formula within 0.05. 14/14 tests pass. No Transformers.js v4 upgrade (D-06): `package.json` pins `@huggingface/transformers: ^3.7.5`. |

**Score:** 4/6 truths verified (2 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/background/merge.ts` | Pure merge helpers + shared `capByOldest` enforcing per-key caps | ✓ VERIFIED | Present, substantive, imported by `src/background/index.ts:56`. |
| `src/utils/storage.ts` | `getBytesInUse()` authority + incremental per-key byte tracking + reconcile + pruning deltas | ✓ VERIFIED | Present, substantive, imported by background. |
| `src/services/engine/ml/transformers.ts` | Shared `resolveDeviceAndDtype()` + `createPipelineWithFallback()` used by all five pipelines | ✓ VERIFIED | Present, substantive, all five `get*Pipeline()` refactored. |
| `src/workers/ml-worker.ts` | Worker WASM path (`setWasmPath`/`deriveWasmPath`) intact | ✓ VERIFIED | Present, sets WASM path before any pipeline. |
| `tests/unit/storage-budget.test.ts` | Per-key cap enforcement tests | ✓ VERIFIED | 10 tests pass. |
| `tests/unit/storage-budget-authority.test.ts` | getBytesInUse authority + incremental tracking + prune tests | ✓ VERIFIED | 12 tests pass. |
| `tests/unit/quantization-equivalence.test.ts` | Device/dtype resolution + fallback + quantized-vs-fp32 equivalence | ✓ VERIFIED | 14 tests pass. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `mergeSignals`/`mergeNews`/`mergeMarkets` | `storeSignals`/`storeNews`/`storeMarkets` + `REPORT_*_DATA` handlers | `src/background/index.ts:323,331,339,852,858,864` | ✓ WIRED | All three merge helpers called at write time in both collection and content-script paths. |
| `merge*` helpers | `CONFIG.storageBudget.maxSignals/maxNews/maxMarkets` | `src/config/index.ts:217-230` | ✓ WIRED | Caps read from config inside each merge function. |
| `measureStorageUsage`/`pruneStorageIfNeeded` | background collection cycle | `src/background/index.ts:52,467,618` | ✓ WIRED | `GET_STORAGE_USAGE` handler + post-collection prune. |
| `getBytesInUse` | `browser.storage.local` | `src/utils/storage.ts` `getBytesInUse()` | ✓ WIRED | Authoritative total used in `measureStorageUsage()` reconcile. |
| `get*Pipeline()` (×5) | `createPipelineWithFallback` → `resolveDeviceAndDtype` | `src/services/engine/ml/transformers.ts` | ✓ WIRED | All five pipelines route through the shared choke point. |
| worker WASM path | `setWasmPath`/`deriveWasmPath` | `src/workers/ml-worker.ts:93-106` | ✓ WIRED | WASM path set at module load, before any pipeline. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `mergeSignals`/`mergeNews`/`mergeMarkets` | capped arrays | incoming collection data → dedup → cap → storage | Yes — real collection data, capped at write time | ✓ FLOWING |
| `measureStorageUsage` | `totalBytes` | `getBytesInUse()` authoritative + per-key estimates | Yes — real `chrome.storage.local` byte count | ✓ FLOWING |
| `pruneStorageIfNeeded` | `currentBytes` | `measureStorageUsage()` → prune → `trackBytes` deltas | Yes — real stored data, deltas tracked | ✓ FLOWING |
| `resolveDeviceAndDtype` | `{device, dtype}` | `navigator.gpu` detection + dtype chain | Yes — real device/dtype selection | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite | `bun run test` | 298/298 pass (26 files) | ✓ PASS |
| Phase-8 tests | `bun run test -- tests/unit/storage-budget.test.ts tests/unit/storage-budget-authority.test.ts tests/unit/quantization-equivalence.test.ts` | 36/36 pass (10+12+14) | ✓ PASS |
| Typecheck | `bun run typecheck` | clean (`tsc --noEmit`) | ✓ PASS |
| Sustained-collection budget | (requires live browser) | N/A | ? SKIP — human |
| ML WASM fallback end-to-end | (requires live browser) | N/A | ? SKIP — human |

### Probe Execution

No probes declared for this phase (code-level hardening, no `scripts/*/tests/probe-*.sh`). SKIPPED.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PERF-03 | 08-01, 08-02 | Storage stays within budget via per-key caps + incremental byte estimation | ✓ SATISFIED (code) | Caps enforced at write time; `getBytesInUse()` authority + reconcile; incremental tracking; pruning deltas. All unit-tested. Sustained-collection runtime invariant → human item. |
| PERF-04 | 08-03 | ML correlation with quantization (q8/q4) + WebGPU, falling back to WASM without breaking engine | ✓ SATISFIED (code) | Shared `resolveDeviceAndDtype()` + fallback across all five pipelines; dtype chain; quantized≡fp32 equivalence tests. Engine-level runtime fallback → human item. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | None (no TBD/FIXME/XXX/placeholder/empty-return stubs in Phase 8 files) | — | — |

### Human Verification Required

1. **Sustained-collection storage budget** — Run the extension through multiple collection cycles with real data volumes; confirm `chrome.storage.local` usage for TrendCast keys stays ≤ ~7 MB, per-key caps hold (500 signals / 200 news / 500 markets), and pruning fires when over budget. Why human: the mechanisms are unit-tested in isolation, but the sustained-collection runtime invariant (repeated cycles, real UTF-16 serialization) requires a live browser.
2. **ML WASM fallback end-to-end** — Run ML correlation in a browser without WebGPU (e.g., Firefox with WebGPU flag-gated off); confirm correlation results are still produced via the WASM CPU path without breaking the engine. Why human: the pipeline-level fallback is tested, but end-to-end engine inference over a real model is unexercised.

### Gaps Summary

No code-level gaps. All artifacts exist, are substantive, and are wired. The per-key caps, `getBytesInUse()` authority, incremental byte tracking, shared device/dtype resolution, WebGPU→WASM fallback, and quantized-vs-fp32 equivalence are all verified via code + 36 passing unit tests + clean typecheck. The phase's remaining risk is entirely behavioral: the sustained-collection storage budget and the end-to-end ML WASM fallback require live-browser confirmation. These are human-verification items, not code gaps.

---

_Verified: 2026-08-23_
_Verifier: the agent (gsd-verifier)_
