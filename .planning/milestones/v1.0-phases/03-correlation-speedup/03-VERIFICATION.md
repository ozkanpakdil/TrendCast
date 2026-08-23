---
phase: 03-correlation-speedup
verified: 2026-08-22T23:25:00Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps: []
deferred:
  - truth: "Unused `toIndexable` helper in tests/unit/index.test.ts causes tsc --noEmit TS6133"
    addressed_in: "Phase 3 (follow-up cleanup) — logged in deferred-items.md"
    evidence: "deferred-items.md: 'Unused toIndexable helper ... Pre-existing from plan 03-01; not in plan 03-02 scope.'"
---

# Phase 3: Correlation Speedup Verification Report

**Phase Goal:** Users see correlation results faster via an inverted keyword→contract index, with results equivalent to the current engine
**Verified:** 2026-08-22T23:25:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth   | Status     | Evidence       |
| --- | ------- | ---------- | -------------- |
| 1   | SC1: User sees correlation results computed from a candidate-filtered inverted index instead of the O(n×m) nested loop | ✓ VERIFIED | `src/services/engine/index.ts` defines `InvertedIndex` (Map<keyword, number[]>) with `build`/`candidates`/`has`/`size`. Heuristic `correlate`/`correlateNews`/`correlateNewsSocial` in `correlation.ts` build `getIncrementalIndex(contracts, { includeEntityKeywords: true })` and iterate `index.candidates(...)` instead of the full nested loop. ML engines zeroshot/sentiment/llm all use `getIncrementalIndex` + `index.candidates(...).slice(0, cap)`. |
| 2   | SC2 — Correlation results are equivalent to the previous engine (golden-test equivalence vs the naive loop), no silent result drift | ✓ VERIFIED | 6 equivalence test files (`correlation`, `zeroshot`, `sentiment`, `llm`, `embedding`, `ner`) each define an independent naive-loop oracle and assert production output deep-equals it (`toEqual`) over shared + golden fixtures + D-03 edge cases. Full suite: 156/156 pass. |
| 3   | SC3 — Both heuristic and ML correlation paths use the same tokenization source and index, so results stay consistent across engines | ✓ VERIFIED | All keyword-overlap engines (heuristic, zeroshot, sentiment, llm) consume the shared `getIncrementalIndex` built from the already-extracted `keywords` arrays (single tokenization source, anti-drift guard). Embedding/NER intentionally remain on the naive loop — a keyword-only index is NOT a valid superset for semantic/entity similarity (documented design decision, not a gap). |
| 4   | SC4 — The index is built incrementally (cached by data version) and falls back to the naive loop for tiny inputs without breaking correlation | ✓ VERIFIED | `getIncrementalIndex` caches by FNV-1a hash of contract IDs + `includeEntityKeywords` flag; rebuilds only on change. `InvertedIndex.TINY_INPUT_THRESHOLD = 2`; all three heuristic functions keep the naive loop when `contracts.length < TINY_INPUT_THRESHOLD`. Tiny-input fallback asserted in `correlation-equivalence.test.ts` (single contract/signal cases) and `index.test.ts`. |

**Score:** 4/4 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/services/engine/index.ts` | `InvertedIndex` class + `getIncrementalIndex` cache | ✓ VERIFIED | Exists, substantive (build/candidates/has/size/TINY_INPUT_THRESHOLD, FNV-1a cache), wired (imported by correlation.ts + all 3 ML engines) |
| `src/services/engine/correlation.ts` | Candidate-filtered heuristic path | ✓ VERIFIED | `correlate`/`correlateNews`/`correlateNewsSocial` use `getIncrementalIndex` + `index.candidates`; pair functions byte-for-byte unchanged; tiny-input fallback present |
| `src/services/engine/ml/zeroshot.ts` | Candidate-filtered zeroshot | ✓ VERIFIED | All 3 passes use `index.candidates(...).slice(0, ZEROSHOT_MAX_LABELS)`; `findCandidateContracts` removed; `candidateNews[j]` index fix applied |
| `src/services/engine/ml/sentiment.ts` | Candidate-filtered sentiment | ✓ VERIFIED | All 3 passes iterate `index.candidates`; `matchedKeywords`/`overlapRatio`/confidence unchanged |
| `src/services/engine/ml/llm.ts` | Candidate-filtered LLM | ✓ VERIFIED | All 3 passes `index.candidates(...).slice(0, LLM_MAX_CANDIDATES)`; scoring/batching unchanged |
| `src/services/engine/ml/embedding.ts` | Naive loop retained (no index) | ✓ VERIFIED | No `getIncrementalIndex`/`InvertedIndex` reference; nested loop + cosine similarity intact |
| `src/services/engine/ml/ner.ts` | Naive loop retained (no index) | ✓ VERIFIED | No `getIncrementalIndex`/`InvertedIndex` reference; nested loop + `nerEntitySimilarity` intact |
| `tests/unit/index.test.ts` | Index unit tests | ✓ VERIFIED | Exists; covers build/candidates/edge cases/tiny-input/`includeEntityKeywords`/incremental cache |
| `tests/unit/fixtures.ts` | Shared fixtures | ✓ VERIFIED | Exists; `mockContract`/`mockSignal`/`newsItem` + golden cashtag/hashtag fixtures |
| 6 × `*-equivalence.test.ts` | Per-engine equivalence | ✓ VERIFIED | All exist with naive oracles + deep-equality assertions; all pass |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| `InvertedIndex.build` | `contract.keywords` | `collectTokens` reads `item.keywords` | ✓ WIRED | Single tokenization source; `includeEntityKeywords` opt-in adds entity postings |
| `InvertedIndex.candidates` | heuristic `correlate`/`correlateNews`/`correlateNewsSocial` | `index.candidates(candidateKeywords(...))` | ✓ WIRED | `candidateKeywords` unions keywords + entity keywords to preserve entity-only matches (superset invariant) |
| `InvertedIndex.candidates` | zeroshot/sentiment/llm | `index.candidates(...).slice(0, cap)` | ✓ WIRED | Per-engine caps preserved after candidates |
| `getIncrementalIndex` | data-version cache | FNV-1a hash of contract IDs | ✓ WIRED | Rebuilds only on change |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `correlate` | `contracts[i]` | `index.candidates(...)` → `contracts[i]` | ✓ | ✓ FLOWING — index built from real `contract.keywords`; candidates index into real contracts |
| `correlateNewsSocial` | `signals[i]` | `index.candidates(...)` → `signals[i]` | ✓ | ✓ FLOWING — index over signals array |
| zeroshot/sentiment/llm | `contracts[idx]`/`signals[j]`/`news[idx]` | `index.candidates(...).map(i => arr[i])` | ✓ | ✓ FLOWING — real arrays indexed |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Full unit suite | `./node_modules/.bin/vitest run` | 12 files, 156/156 pass | ✓ PASS |
| Heuristic equivalence | `correlation-equivalence.test.ts` | 21 tests pass | ✓ PASS |
| Zeroshot equivalence | `zeroshot-equivalence.test.ts` | 20 tests pass | ✓ PASS |
| Sentiment equivalence | `sentiment-equivalence.test.ts` | 20 tests pass | ✓ PASS |
| LLM equivalence | `llm-equivalence.test.ts` | 20 tests pass | ✓ PASS |
| Embedding equivalence | `embedding-equivalence.test.ts` | 10 tests pass | ✓ PASS |
| NER equivalence | `ner-equivalence.test.ts` | 10 tests pass | ✓ PASS |

### Probe Execution

No probes declared in PLAN/SUMMARY for this phase. SKIPPED.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| PERF-02 | 03-01, 03-02, 03-03, 03-04 | User sees correlation results faster via inverted keyword→contract index (O(n×m) → candidate filtering), equivalent to current engine | ✓ SATISFIED | InvertedIndex + candidate-filtered heuristic/ML paths + 6 equivalence tests proving output identity; 156/156 tests pass |

**Orphaned requirements:** None. PERF-02 is the only requirement mapped to Phase 3 and is claimed by all 4 plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `tests/unit/index.test.ts` | 28 | Unused `toIndexable` helper (TS6133) | ⚠️ Warning | Pre-existing from plan 03-01; logged in `deferred-items.md`; does not affect runtime or test pass. Not a blocker. |
| `src/services/engine/correlation.ts` | various | ESLint style warnings (cognitive complexity, floating-point equality, `Set` suggestion) | ℹ️ Info | Pre-existing patterns; not debt markers (no TBD/FIXME/XXX); no functional impact |
| `src/services/engine/ml/llm.ts` | various | ESLint style warnings (`parseInt`, `for` loops, nested templates) | ℹ️ Info | Pre-existing patterns; no functional impact |

No `TBD`/`FIXME`/`XXX` debt markers found in any phase-modified file.

### Human Verification Required

None. All must-haves are verified by code inspection + passing behavioral equivalence tests. The equivalence tests are behavioral tests that exercise the actual indexed-vs-naive output identity, so no behavior-dependent truth is left unverified.

### Gaps Summary

No blocking gaps. All 4 success criteria are met in the codebase:

1. **SC1** — Candidate-filtered inverted index replaces the O(n×m) nested loop across heuristic + ML keyword-overlap engines.
2. **SC2** — Equivalence proven by 6 naive-oracle equivalence test files; 156/156 tests pass.
3. **SC3** — All keyword-overlap engines share the same `getIncrementalIndex` built from the same `keywords` arrays. Embedding/NER remain on the naive loop by documented design (keyword index is not a valid superset for semantic/entity similarity).
4. **SC4** — Incremental FNV-1a data-version cache + `TINY_INPUT_THRESHOLD=2` naive fallback, both tested.

**Note (documentation, not code):** ROADMAP.md shows "2/4 plans executed" with 03-01 and 03-04 unchecked, but all 4 SUMMARY.md files exist and all 4 plans' artifacts are present and verified in the codebase. This is a ROADMAP checkbox bookkeeping discrepancy, not a code gap.

---

_Verified: 2026-08-22T23:25:00Z_
_Verifier: the agent (gsd-verifier)_
