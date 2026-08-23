---
phase: 03-correlation-speedup
plan: 01
subsystem: correlation-engine
tags: [performance, inverted-index, equivalence, fixtures]
requires: []
provides:
  - shared InvertedIndex candidate pre-filter
  - incremental data-version cache
  - shared test fixtures
affects:
  - src/services/engine/correlation.ts
  - src/services/engine/ml/zeroshot.ts
  - src/services/engine/ml/sentiment.ts
  - src/services/engine/ml/llm.ts
tech-stack:
  added: []
  patterns:
    - InvertedIndex candidate pre-filtering (Map<keyword, number[]>)
    - FNV-1a data-version hash incremental cache
    - tiny-input fallback threshold
    - single tokenization source (extractKeywords/extractEntities)
key-files:
  created:
    - src/services/engine/index.ts
    - tests/unit/index.test.ts
    - tests/unit/fixtures.ts
  modified: []
decisions:
  - "InvertedIndex built only from contract.keywords (single tokenization source, Pitfall 1)."
  - "getIncrementalIndex caches by FNV-1a hash of contract IDs; rebuilds only on change."
  - "includeEntityKeywords opt-in adds entity-derived postings for the heuristic superset."
  - "TINY_INPUT_THRESHOLD=2 naive-fallback threshold."
metrics:
  duration: ~15 min
  completed_date: "2026-08-22"
status: complete
actuals:
  tokens: 14000
  tasks: 2
  commits: 0
---

# Phase 3 Plan 1: Shared InvertedIndex Summary

Built the shared `InvertedIndex` — a hand-rolled `Map<keyword, number[]>` that pre-filters candidate contracts for correlation, collapsing the O(n×m) nested loop to O(n×k) candidate filtering. This is the foundation every engine (heuristic + ML) consumes in later plans.

## Performance

- **Duration:** ~20 min
- **Tasks:** 2/2 complete
- **Files created:** 3

## Accomplishments
- `InvertedIndex` class with `build`, `candidates`, `has`, `size`, and `TINY_INPUT_THRESHOLD=2`.
- `getIncrementalIndex` module-level cache keyed by FNV-1a hash of contract IDs + `includeEntityKeywords` flag.
- Threat mitigations: T-3-01 (single tokenization source), T-3-02 (MAX_DISTINCT_KEYWORDS=10_000 cardinality cap), T-3-SC (zero new deps).
- Shared fixtures (`mockContract`, `mockSignal`, `newsItem`, golden cashtag/hashtag fixtures) for all equivalence tests.

## Task Commits

Commits were NOT made — per project git rules, the user handles all commits. Files are staged in the working tree.

## Files Created
- `src/services/engine/index.ts` - `InvertedIndex` class + `getIncrementalIndex`/`getInvertedIndex` cache helpers
- `tests/unit/index.test.ts` - 20 unit tests covering build/candidates/fallback + all D-03 edge cases
- `tests/unit/fixtures.ts` - shared `mockContract`, `mockSignal`, `newsItem`, and golden cashtag/hashtag fixtures

## Decisions Made
- Index built only from `contract.keywords` (single tokenization source).
- `includeEntityKeywords` is an explicit opt-in that adds entity postings, never re-tokenizes the same keywords with a different function.
- `MAX_DISTINCT_KEYWORDS = 10_000` bounds index memory (T-3-02).

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 1 - Bug] Fixed a test assertion that expected an unextractable keyword.** The `newsItem` fixture test asserted `extractKeywords('Bitcoin surges past $100k')` contains `'100k'`, but `extractKeywords` only emits cashtags, hashtags, and 3+ letter words. Changed the assertion to `'surges'`.
2. **Refactored `InvertedIndex.build`** into a `build` + private `collectTokens` split to satisfy the ESLint cognitive-complexity rule. No behavior change.

### Post-review Fix (WR-01)

3. **Incremental cache key now includes keyword content.** Code review (03-REVIEW.md, WR-01) found that `getIncrementalIndex` was keyed only on contract IDs, but `mergeMarkets` can overwrite a contract's `keywords` while keeping the same `id` — so an ID-only key could return a stale index and silently drop matches (violating PERF-02 equivalence). The version hash now includes each contract's `id + keywords`, and a regression test was added. Full suite: 157/157 pass.

## Self-Check: PASSED

- `src/services/engine/index.ts`, `tests/unit/index.test.ts`, `tests/unit/fixtures.ts` all exist.
- Index tests: 20/20 green.
- Full suite: 55/55 green (no regressions).
