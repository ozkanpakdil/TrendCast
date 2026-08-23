---
phase: 08-storage-ml-hardening
plan: 02
status: complete
date: 2026-08-23
verification: passed
tests: 12/12
typecheck: clean
---

# Plan 08-02 Summary — getBytesInUse Authority + Incremental Byte Tracking

## What was done

Made `browser.storage.local.getBytesInUse()` the authoritative budget measure and added incremental per-key byte tracking so pruning no longer re-serializes the whole dataset on every cycle (PERF-03, D-02, D-03).

- Added `getBytesInUse()` — returns the authoritative total from `browser.storage.local.getBytesInUse()` (falls back to 0 on error).
- Added incremental per-key byte tracking via a module-level `Map<string, number>`:
  - `trackBytes(key, delta)` — records a positive/negative delta, clamped at 0.
  - `setTrackedBytes(key, bytes)` — overrides a key's estimate.
  - `getTrackedBytes(key)` — reads a key's estimate (0 if untracked).
  - `resetTrackedBytes()` — clears all tracking.
- Updated `measureStorageUsage()` to use `getBytesInUse()` as the authority: it sums per-key estimates (tracked value when available, else `estimateBytes` on the stored value), then reconciles — if `|authoritative - totalBytes| > authoritative * 0.2`, it trusts `getBytesInUse()` and resets the tracker.
- Updated `pruneStorageIfNeeded()` to track byte deltas via `trackBytes(key, -removedBytes)` after each pruning pass.

## Files changed

- `src/utils/storage.ts` (getBytesInUse + incremental tracking + reconcile logic)
- `tests/unit/storage-budget-authority.test.ts` (new — 12 tests)

## Verification

- 12/12 unit tests pass (getBytesInUse authority, incremental tracking, reconcile, prune behavior).
- `bun run typecheck` clean.
- Full suite: 284/284 tests pass.

## Notes

The incremental tracker is a relative heuristic for pruning deltas only; `getBytesInUse()` remains the budget authority and resyncs the tracker when estimates diverge by more than 20%. Plan 08-03 extends WebGPU→WASM fallback to all ML pipelines and adds quantization equivalence tests.
