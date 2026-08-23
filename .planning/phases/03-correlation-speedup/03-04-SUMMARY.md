---
phase: 03-correlation-speedup
plan: 04
subsystem: correlation-engine
tags: [performance, equivalence, embedding, ner]
requires:
  - 03-01
provides:
  - embedding equivalence oracle (naive-loop)
  - NER equivalence oracle (naive-loop)
  - documentation of why the keyword index does not apply to semantic/entity engines
affects:
  - src/services/engine/ml/embedding.ts
  - src/services/engine/ml/ner.ts
tech-stack:
  added: []
  patterns:
    - naive-loop reference oracle for semantic/entity engines
    - deterministic pipeline mocking (vi.mock transformers)
    - zero-keyword-overlap match fixtures
key-files:
  created:
    - tests/unit/embedding-equivalence.test.ts
    - tests/unit/ner-equivalence.test.ts
  modified: []
decisions:
  - "Embedding and NER remain on the naive loop — a keyword-only index is NOT a valid superset for semantic/entity similarity."
  - "Equivalence tests prove output correctness against a hand-verified oracle (D-01 coverage for ALL engines)."
  - "Semantic-match and entity-match fixtures document why the keyword index does not apply."
metrics:
  duration: ~15 min
  completed_date: "2026-08-22"
status: complete
actuals:
  tokens: 13000
  tasks: 2
  commits: 0
---

# Phase 3 Plan 4: Embedding & NER Equivalence Summary

Added equivalence tests for the embedding and NER engines. These two engines use semantic similarity (embedding cosine) and ML-extracted entity similarity respectively — both can match a contract with zero keyword overlap, so a keyword-only inverted index is NOT a valid superset of their matches. They remain on the naive loop as the reference oracle.

## Performance

- **Duration:** ~20 min
- **Tasks:** 2/2 complete
- **Files created:** 2

## Accomplishments
- `embedding-equivalence.test.ts` — mocks `getEmbeddingPipeline` with a deterministic concept-based vector stub; `naiveEmbedding` oracle replicates the pre-change nested loop; asserts production `correlateEmbedding` deep-equals the oracle over shared + golden fixtures + D-03 edge cases.
- **Semantic-match fixture:** signal "Powell hints at rate relief" ↔ contract "Will the Fed cut rates?" matches with zero keyword overlap (`matchedKeywords: []`), documenting why the keyword index does not apply.
- `ner-equivalence.test.ts` — mocks `getNERPipeline` with a deterministic entity-extraction stub; `naiveNER` oracle replicates the production loop; asserts production `correlateNER` deep-equals the oracle.
- **Entity-match fixture:** both texts mention "Powell" as an entity while the contract's `keywords` omit it — the match still occurs and `powell` is surfaced in `matchedKeywords`.
- Top-of-file comment blocks explain the design decision for both engines.

## Task Commits

Commits were NOT made — per project git rules, the user handles all commits. Files are staged in the working tree.

## Files Created
- `tests/unit/embedding-equivalence.test.ts` - embedding equivalence (naive-loop oracle, no index pre-filter)
- `tests/unit/ner-equivalence.test.ts` - NER equivalence (naive-loop oracle, no index pre-filter)

## Decisions Made
- No production change to embedding/NER — they remain on the naive loop as the reference (T-3-08).
- The equivalence test is the guard that prevents a future contributor from incorrectly routing these engines through the keyword index.

## Deviations from Plan

None - plan executed as written. One internal correction during Task 1: the oracle initially produced floating-point mismatches because production L2-normalizes vectors before cosine. Updated the oracle to replicate production's exact normalize-then-cosine formula so deep-equality holds. This is a test-internal fix, not a plan deviation.

## Self-Check: PASSED

- `tests/unit/embedding-equivalence.test.ts` (10/10) and `tests/unit/ner-equivalence.test.ts` (10/10) pass.
- Full suite: 156/156 green (no regressions).
- `embedding.ts`/`ner.ts` unmodified.
