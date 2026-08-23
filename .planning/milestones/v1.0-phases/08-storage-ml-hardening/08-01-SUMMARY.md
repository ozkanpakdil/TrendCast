---
phase: 08-storage-ml-hardening
plan: 01
status: complete
date: 2026-08-23
verification: passed
tests: 10/10
typecheck: clean
---

# Plan 08-01 Summary — Per-Key Storage Caps

## What was done

Enforced the per-key storage caps (`maxSignals`, `maxNews`, `maxMarkets`) at write time in the merge helpers (PERF-03, D-01).

- Extracted the merge helpers from `src/background/index.ts` into a new pure module `src/background/merge.ts` so the cap logic is unit-testable (mirrors the `alerts.ts` pattern).
- Added a shared `capByOldest<T>(items, cap, dateKey)` helper that evicts oldest-first by the item's date field, handling both ISO strings (`timestamp`, `publishedAt`) and numeric epoch ms (`lastUpdated`).
- Wired caps into `mergeSignals` (maxSignals=500), `mergeNews` (maxNews=200), `mergeMarkets` (maxMarkets=500).
- Updated `src/background/index.ts` to import the helpers from the new module.

## Files changed

- `src/background/merge.ts` (new — merge helpers + `capByOldest`)
- `src/background/index.ts` (import helpers from `@/background/merge`, removed inline defs)
- `tests/unit/storage-budget.test.ts` (new — 10 tests)

## Verification

- 10/10 unit tests pass (cap enforcement, under-cap unchanged, date handling, no mutation).
- `bun run typecheck` clean.

## Notes

The caps are a defensive per-key ceiling that complements (not replaces) the byte-budget pruner. Plan 08-02 makes `getBytesInUse()` the budget authority and adds incremental byte tracking.
