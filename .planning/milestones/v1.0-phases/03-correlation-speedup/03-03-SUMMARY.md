---
phase: 03-correlation-speedup
plan: 03
subsystem: correlation-engine
tags: [performance, inverted-index, equivalence, ml, zeroshot, sentiment, llm]
requires:
  - 03-01
provides:
  - candidate-filtered zeroshot/sentiment/llm paths
  - per-engine equivalence oracles
affects:
  - src/services/engine/ml/zeroshot.ts
  - src/services/engine/ml/sentiment.ts
  - src/services/engine/ml/llm.ts
tech-stack:
  added: []
  patterns:
    - InvertedIndex candidate pre-filtering (shared index from plan 03-01)
    - per-engine candidate cap preserved after candidates() (ZEROSHOT_MAX_LABELS=15, LLM_MAX_CANDIDATES=5)
    - single tokenization source (extractKeywords)
key-files:
  created:
    - tests/unit/zeroshot-equivalence.test.ts
    - tests/unit/sentiment-equivalence.test.ts
    - tests/unit/llm-equivalence.test.ts
  modified:
    - src/services/engine/ml/zeroshot.ts
    - src/services/engine/ml/sentiment.ts
    - src/services/engine/ml/llm.ts
decisions:
  - "Each engine builds the shared index once per call (getIncrementalIndex) and queries it with index.candidates(...), preserving the per-engine cap via .slice(0, cap) after candidates()."
  - "The index is built over the array the inner loop iterates: contracts for signal/news→contract passes, signals for news→signals passes, news for signal→news passes."
  - "Naive oracles replicate the pre-change loops independently (not importing production functions) for a true reference."
metrics:
  duration: ~25 min
  completed_date: "2026-08-22"
status: complete
actuals:
  tokens: 26000
  tasks: 3
  commits: 0
---

# Phase 3 Plan 3: ML Engine Candidate-Filtering Summary

Routed the three keyword-overlap ML engines — zeroshot, sentiment, and LLM — through the shared `InvertedIndex` candidate pre-filter, replacing their ad-hoc `filter`+`slice`/`filter`+`continue` blocks, and proved equivalence with per-engine equivalence test files.

## What Was Built

- **`src/services/engine/ml/zeroshot.ts`**: deleted `findCandidateContracts`/`findCandidateContractsForNews`; all three passes (`correlateSignalsToContracts`, `correlateNewsToContracts`, `correlateNewsToSignals`) now build `getIncrementalIndex(...)` once and query `index.candidates(...).slice(0, ZEROSHOT_MAX_LABELS).map(i => contracts[i])`. `ZeroShotIndex`, `classify`, `ZEROSHOT_THRESHOLD`, `matchedKeywords`, and progress/cancel plumbing unchanged.
- **`src/services/engine/ml/sentiment.ts`**: all three passes (`correlateSignalsToContracts`, `correlateNewsToContracts`, `correlateNewsToSignals`) now iterate `index.candidates(...)` instead of the full array; the `matchedKeywords`/`overlapRatio`/confidence computation and the `matchedKeywords.length === 0 continue` guard are unchanged.
- **`src/services/engine/ml/llm.ts`**: all three passes (`correlateLLM`, `correlateNewsLLM`, `correlateNewsSocialLLM`) replaced their inline `.filter(...).slice(0, LLM_MAX_CANDIDATES)` blocks with `index.candidates(...).slice(0, LLM_MAX_CANDIDATES).map(i => contracts[i])`; scoring/batching/matchedKeywords unchanged.
- **`tests/unit/zeroshot-equivalence.test.ts`**, **`sentiment-equivalence.test.ts`**, **`llm-equivalence.test.ts`**: each mocks its transformers pipeline with a deterministic stub and asserts the indexed production path deep-equals an independent naive oracle (same matches, confidence, order) over shared + golden fixtures + D-03 edge cases.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `matchedKeywords` used wrong index in zeroshot `correlateNewsToSignals`**
- **Found during:** Task 1 (tracer) verification
- **Issue:** The indexed path computed `matchedKeywords: news[j].keywords.filter(...)` but `j` indexes the *candidate* subset, not the full `news` array. This produced wrong matched keywords (and could reference out-of-range indices) whenever the candidate set was a strict subset. The naive oracle used `candidateNews[j]`, so the equivalence test caught the mismatch.
- **Fix:** Changed to `candidateNews[j].keywords.filter(...)`.
- **Files modified:** `src/services/engine/ml/zeroshot.ts`
- **Commit:** N/A (commits forbidden per project git rules)

**2. [Rule 1 - Bug] Local `index` variable shadowed the `ZeroShotIndex`/`SentimentIndex` parameter**
- **Found during:** Task 1/2 verification
- **Issue:** The plan named the local inverted-index variable `index`, but the zeroshot and sentiment correlate functions already receive an `index: ZeroShotIndex`/`SentimentIndex` parameter. `const index = getIncrementalIndex(...)` shadowed it, causing a compile error (`The symbol "index" has already been declared`).
- **Fix:** Renamed the local inverted-index variable to `candidateIndex` in zeroshot and sentiment (llm has no such parameter, so it kept `index`).
- **Files modified:** `src/services/engine/ml/zeroshot.ts`, `src/services/engine/ml/sentiment.ts`
- **Commit:** N/A (commits forbidden per project git rules)

**3. [Rule 1 - Bug] Test fixture "no overlap" cases actually overlapped**
- **Found during:** Task 1/2/3 verification
- **Issue:** The "does not match news with no overlap" tests used `newsSet[3]` (weather news), but `signalSet` contains `sig-unrelated` with `keywords: ['weather', 'nice', 'today']` — so there WAS overlap and the engine correctly produced a match. The test expectation of 0 was wrong.
- **Fix:** Added a truly unrelated news item (`newsItem('reuters', 'SpaceX launches a new satellite')`) and pointed the social no-overlap tests at it.
- **Files modified:** `tests/unit/zeroshot-equivalence.test.ts`, `tests/unit/sentiment-equivalence.test.ts`, `tests/unit/llm-equivalence.test.ts`
- **Commit:** N/A (commits forbidden per project git rules)

## Auth Gates

None.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, file access, or schema changes. The index is built only from already-normalized `keywords` arrays (T-3-05), `candidates` dedups via `Set` and per-engine caps bound inference cost (T-3-06), and zero new runtime dependencies (T-3-SC).

## Deferred Issues

- `tests/unit/index.test.ts:28` — unused `toIndexable` helper causes `tsc --noEmit` TS6133. Pre-existing from plan 03-01; out of scope for plan 03-03. Already logged to `deferred-items.md`.

## Self-Check: PASSED

- `tests/unit/zeroshot-equivalence.test.ts` — 20 tests pass.
- `tests/unit/sentiment-equivalence.test.ts` — 20 tests pass.
- `tests/unit/llm-equivalence.test.ts` — 20 tests pass.
- Full unit suite — 10 files, 136 tests pass (no regressions).
