# Phase 8: Storage & ML Hardening - Context

**Gathered:** 2026-08-23
**Status:** Ready for planning
**Mode:** Autonomous (recommended defaults accepted)

## Phase Boundary

Users' storage stays within budget via per-key caps + incremental byte estimation, and ML correlation runs with quantization/WebGPU falling back to WASM. Two independent hardening tracks (PERF-03, PERF-04) with no new runtime dependencies and no Transformers.js v4 upgrade.

## Decisions

### D-01: Enforce per-key caps at write time

Wire `CONFIG.storageBudget.maxSignals` (500), `maxNews` (200), `maxMarkets` (500) into `mergeSignals`/`mergeNews`/`mergeMarkets` in `src/background/index.ts`. When a merged array exceeds its cap, evict oldest-first (by `timestamp`/`publishedAt`/`lastUpdated`) down to the cap. This is a defensive per-key ceiling that complements (not replaces) the byte-budget pruner.

**Rationale:** The caps are currently defined in config but never enforced — they exist only as documentation. A single runaway key (e.g., a burst of news) could blow the budget before the byte pruner runs. Enforcing at write time bounds each key independently.

### D-02: `getBytesInUse()` as budget authority

Switch `measureStorageUsage()` in `src/utils/storage.ts` to use `browser.storage.local.getBytesInUse()` for the authoritative total, keeping `estimateBytes` only as a per-item relative heuristic for pruning deltas. This aligns the budget with Chrome's real UTF-16 serialization (the current UTF-8 Blob estimate diverges and can overflow the real quota).

**Rationale:** Per PITFALLS.md, `estimateBytes` (UTF-8 Blob) diverges from `chrome.storage.local`'s real UTF-16 serialization. `getBytesInUse()` is cheap and exact. Keep `estimateBytes` for per-item pruning deltas only.

### D-03: Incremental byte estimation

Track a running byte delta per key (add new item size, subtract pruned item size) instead of re-serializing the whole dataset on every budget check. Reconcile against `getBytesInUse()` periodically (e.g., every N cycles or when the incremental estimate drifts beyond a threshold).

**Rationale:** Per PITFALLS.md, pruning currently re-serializes the whole dataset every cycle. Incremental deltas avoid the O(store) cost on each collection.

### D-04: Extend WebGPU + WASM fallback to all ML pipelines

Mirror the existing `getLLMPipeline` pattern (transformers.ts:252-287) to embedding/sentiment/zero-shot/NER: detect `navigator.gpu`, try `device: 'webgpu'`, catch and fall back to WASM CPU with `{ quantized: true }`. Add an explicit dtype fallback chain `["q4", "q8", "fp16", "fp32"]` using `ModelRegistry.get_available_dtypes()` when available.

**Rationale:** Only the LLM pipeline currently has WebGPU + WASM fallback. The other four pipelines are WASM-only. Extending the pattern covers all engines at the single choke point (`get*Pipeline()`), and the dtype chain picks the smallest available dtype.

### D-05: Golden-test quantization equivalence

Add equivalence tests proving quantized (q8/q4) correlation results don't shift beyond a tolerance vs fp32. Reuse the existing equivalence-test pattern (sentiment/zeroshot/embedding/ner/llm-equivalence.test.ts) with a mocked pipeline that returns slightly-different scores for quantized vs fp32, asserting correlation matches/confidence stay within tolerance.

**Rationale:** Per PITFALLS.md, quantization is a silent quality change not caught without golden tests. The existing equivalence harness is the proven pattern.

### D-06: Stay on @huggingface/transformers 3.7.x

Do NOT upgrade to v4.x (breaking major). The `.jsep` WASM build already supports WebGPU/WebNN. All changes are additive within the existing 3.7.x API surface.

**Rationale:** Per STATE.md:81 and PITFALLS.md — v4 is a breaking major; staying on 3.7.x avoids a risky dependency upgrade in a hardening phase.

## Specific Implementation Details

- **Storage caps** (`src/background/index.ts`): add a shared `capByOldest<T>(items, cap, dateKey)` helper; call it at the end of `mergeSignals`/`mergeNews`/`mergeMarkets`. Evict oldest-first by the item's date field.
- **Budget authority** (`src/utils/storage.ts`): `measureStorageUsage()` uses `getBytesInUse()` for total; keep `estimateBytes` for per-item deltas in `pruneStorageIfNeeded()`. Add incremental per-key byte tracking (a module-level `Map<key, bytes>` updated on write/prune, reconciled against `getBytesInUse()`).
- **ML pipelines** (`src/services/engine/ml/transformers.ts`): extract a shared `resolveDeviceAndDtype()` helper (WebGPU detect + dtype chain) used by all five `get*Pipeline()` functions; each gets the WebGPU→WASM catch-and-retry fallback.
- **Worker** (`src/workers/ml-worker.ts`): ensure `setWasmPath`/`deriveWasmPath` still works when WebGPU is primary and WASM is fallback (no change expected — the worker already sets the WASM path before any pipeline).
- **Tests**: new `tests/unit/storage-budget.test.ts` (caps enforced, getBytesInUse authority, incremental deltas) and `tests/unit/quantization-equivalence.test.ts` (quantized vs fp32 within tolerance). Update the browser mock in tests to include `getBytesInUse`.

## Out of Scope

- Transformers.js v4 upgrade
- New runtime dependencies
- Changing correlation thresholds (unless golden tests prove drift requires it)
- Storage schema migrations (caps/pruning are runtime-only)

## Deferred Ideas

- Per-key byte caps (in addition to item-count caps) — item-count caps + byte pruner cover the budget; per-key byte caps add complexity without a demonstrated need.
