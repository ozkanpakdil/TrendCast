---
phase: 03-correlation-speedup
plan: 02
subsystem: correlation-engine
tags: [performance, inverted-index, equivalence, heuristic]
requires:
  - 03-01
provides:
  - candidate-filtered heuristic path
  - heuristic equivalence oracle
affects:
  - src/services/engine/correlation.ts
tech-stack:
  added: []
  patterns:
    - InvertedIndex candidate pre-filtering (shared index from plan 03-01)
    - tiny-input fallback to naive loop
    - single tokenization source (extractKeywords/extractEntities)
key-files:
  created:
    - tests/unit/correlation-equivalence.test.ts
    - .planning/phases/03-correlation-speedup/deferred-items.md
  modified:
    - src/services/engine/correlation.ts
decisions:
  - "Candidate query includes entity-derived keywords (candidateKeywords) so entity-only matches are preserved (superset invariant, must-have truth #4)."
  - "Naive oracles replicate the pre-change pair-scoring logic independently (not importing the production pair functions) for a true reference."
metrics:
  duration: ~15 min
  completed_date: "2026-08-22"
status: complete
actuals:
  tokens: 12000
  tasks: 2
  commits: 0
---

# Phase 3 Plan 2: Heuristic Correlation Candidate-Filtering Summary

Converted the heuristic correlation path (`correlate`, `correlateNews`, `correlateNewsSocial`) from the O(n×m) nested loop to candidate-filtered via the shared `InvertedIndex`, and proved equivalence with the naive loop via a dedicated equivalence test file.

## What Was Built

- **`correlate`**: builds `getIncrementalIndex(contracts, { includeEntityKeywords: true })` once per call; tiny-input fallback keeps the naive loop when `contracts.length < TINY_INPUT_THRESHOLD`; otherwise the inner loop iterates `index.candidates(...)` indexing `contracts[i]`.
- **`correlateNews`**: same conversion over contracts.
- **`correlateNewsSocial`**: same conversion over the `signals` array (index built from signals).
- **`candidateKeywords(keywords, text)`** helper: the index query unions `item.keywords` with `extractEntityKeywords(item.text)` so entity-only matches (e.g. a cashtag `$BTC` → entity `btc`, or a multi-word proper noun not in `keywords`) are preserved — the superset invariant (must-have truth #4).
- **`tests/unit/correlation-equivalence.test.ts`**: naive oracles (`naiveCorrelate`, `naiveCorrelateNews`, `naiveCorrelateNewsSocial`) replicating the pre-change loops, asserting indexed output deep-equals naive output (same matches, confidence, order) over shared + golden fixtures + D-03 edge cases.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Entity-only matches would be dropped by the indexed path**
- **Found during:** Task 1 (tracer)
- **Issue:** The plan specified querying `index.candidates(signal.keywords)`. But the index is built with `includeEntityKeywords: true`, so it carries entity-derived postings for *contracts*. A signal whose *entity* (e.g. cashtag `$BTC` → entity `btc`, or a multi-word proper noun) is not present in its own `keywords` array would resolve to an empty candidate set, dropping matches the naive loop produces via `cachedEntitySimilarity`. This violates must-have truth #4 ("entity-only matches are preserved") and PERF-02 ("results equivalent to the current engine").
- **Fix:** Added a `candidateKeywords(keywords, text)` helper that queries the index with the union of `item.keywords` and `extractEntityKeywords(item.text)`. This keeps the candidate set a superset of the naive-loop matches.
- **Files modified:** `src/services/engine/correlation.ts`
- **Commit:** N/A (commits forbidden per project git rules)

## Auth Gates

None.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, file access, or schema changes. The index is built only from already-normalized `contract.keywords`/`signal.keywords` (T-3-03), `candidates` dedups via `Set` and returns order-preserving indices (T-3-04), and zero new runtime dependencies (T-3-SC).

## Deferred Issues

- `tests/unit/index.test.ts:28` — unused `toIndexable` helper causes `tsc --noEmit` TS6133. Pre-existing from plan 03-01; out of scope for plan 03-02. Logged to `deferred-items.md`.

## Self-Check: PASSED

- `tests/unit/correlation-equivalence.test.ts` — 21 tests pass.
- Full unit suite — 7 files, 76 tests pass.
- `tsc --noEmit` — clean for plan 03-02 files (only pre-existing `index.test.ts` TS6133 remains, deferred).
