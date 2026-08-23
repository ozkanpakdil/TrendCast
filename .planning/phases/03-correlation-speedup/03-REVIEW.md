---
phase: 03-correlation-speedup
reviewed: 2026-08-22T00:00:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - src/services/engine/index.ts
  - src/services/engine/correlation.ts
  - src/services/engine/ml/zeroshot.ts
  - src/services/engine/ml/sentiment.ts
  - src/services/engine/ml/llm.ts
  - tests/unit/index.test.ts
  - tests/unit/fixtures.ts
  - tests/unit/correlation-equivalence.test.ts
  - tests/unit/zeroshot-equivalence.test.ts
  - tests/unit/sentiment-equivalence.test.ts
  - tests/unit/llm-equivalence.test.ts
  - tests/unit/embedding-equivalence.test.ts
  - tests/unit/ner-equivalence.test.ts
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-08-22
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

> **Update (post-review):** WR-01 was fixed in `src/services/engine/index.ts` — the incremental cache version hash now includes each contract's keyword content (not just IDs), so a contract whose `keywords` change while its `id` stays stable (as `mergeMarkets` permits) triggers a rebuild instead of returning a stale index. A regression test was added in `tests/unit/index.test.ts` ("rebuilds when a contract keeps its id but its keywords change"). Full suite: 157/157 pass. WR-02 and WR-03 remain open (see below).

## Summary

Reviewed the Phase 3 (Correlation Speedup) implementation: the shared `InvertedIndex` + incremental cache (`src/services/engine/index.ts`), the candidate-filtered heuristic path (`correlation.ts`), the three candidate-filtered ML engines (zeroshot/sentiment/llm), and the six equivalence test files plus shared fixtures.

The core design is sound and the equivalence tests are genuinely adversarial — the naive oracles replicate the pre-change loops independently (not importing production pair functions), and the golden fixtures assert exact expected matches. The superset invariant for the heuristic path holds: the index is built with `includeEntityKeywords: true` and the query unions `keywords` + `extractEntityKeywords(text)`, so any pair the naive loop matches via `cachedEntitySimilarity` or `keywordSimilarity` is guaranteed to be a candidate. The embedding/NER engines correctly remain on the naive loop (a keyword index is not a valid superset for semantic/entity similarity) — this is a documented design decision, not a gap.

The main concerns are around the **incremental cache correctness**: the cache is keyed only on contract IDs, so it can return a stale index when a contract's `keywords` change without its `id` changing (which `mergeMarkets` permits). This is the phase's most important correctness risk and is not covered by any test. Secondary concerns: the `MAX_DISTINCT_KEYWORDS` cap can silently break the superset invariant under large inputs, and the module-level cache grows unboundedly.

## Warnings

### WR-01: Incremental cache keyed only on contract IDs can return a stale index

**File:** `src/services/engine/index.ts:137-152`
**Issue:** `getIncrementalIndex` computes the version hash from `items.map(i => i.id).join('\u0000')` plus the `includeEntityKeywords` flag. It does **not** include the keywords (or question/text) themselves. In `src/background/index.ts:771`, `mergeMarkets` overwrites a contract when `m.lastUpdated > prev.lastUpdated` — so a contract's `keywords` array can change while its `id` stays stable (e.g., a question is re-extracted, or a market's keyword set is refreshed). When that happens, the cached index still holds the **old** postings, so `candidates()` returns a stale candidate set and the engine silently drops matches the naive loop would produce. This directly violates the phase's core requirement (PERF-02: "results equivalent to the current engine") and is not covered by any equivalence test (all tests use static fixtures with stable keywords).
**Fix:** Include the keyword content in the version hash, e.g. hash `items.map(i => i.id + '\u0000' + i.keywords.join(',')).join('\u0000')`, or hash the serialized `keywords` arrays. Alternatively, drop the module-level cache and build per-call (the build is O(total keywords), cheap relative to the correlation loop). At minimum, add a test that mutates a contract's `keywords` (same `id`) and asserts the index is rebuilt.

### WR-02: `MAX_DISTINCT_KEYWORDS` cap breaks the superset invariant under large inputs

**File:** `src/services/engine/index.ts:88-92`
**Issue:** In `InvertedIndex.build`, once `idx.map.size >= MAX_DISTINCT_KEYWORDS` (10_000), any new keyword is skipped (`continue`). A contract whose keyword falls beyond the cap is therefore **not** indexed, so `candidates()` will not return it even though the naive loop would match it. This breaks the documented "superset of the naive-loop matches" invariant (must-have truth #2) and the equivalence guarantee, but only when the corpus exceeds 10k distinct keywords. The equivalence tests never exercise the cap (the cap test only asserts `size <= 10_000`, not that no match is dropped).
**Fix:** Either (a) document that the cap is a deliberate best-effort bound and accept the dropped-match risk, or (b) when the cap is hit, fall back to the naive loop for the whole call (like the tiny-input fallback) so correctness is preserved. Add a test that asserts a contract beyond the cap is still matched (or that the caller falls back).

### WR-03: Module-level index cache grows unboundedly

**File:** `src/services/engine/index.ts:126-152`
**Issue:** `indexCache` is a module-level `Map<string, InvertedIndex>` with no eviction. Every distinct contract-ID set (e.g., different watchlists, changing market data across collection cycles) adds a permanent entry. In a long-running MV3 worker that re-collects markets hourly, this Map grows without bound, retaining full inverted indexes for every historical data version — a memory leak. (Performance is nominally out of v1 scope, but unbounded memory growth is a robustness/correctness concern, not a pure speed issue.)
**Fix:** Bound the cache (e.g., keep only the most recent N versions, or a single-entry cache since the engine processes one data set per cycle), or evict entries when the cache exceeds a size threshold.

## Info

### IN-01: Unused `toIndexable` helper causes `tsc --noEmit` failure

**File:** `tests/unit/index.test.ts:28`
**Issue:** `toIndexable` is declared but never used → `TS6133`. This is acknowledged in `deferred-items.md` and is a test-file issue, but it breaks `tsc --noEmit` for the whole project.
**Fix:** Remove the unused helper (or use it in the `build` tests).

### IN-02: Cognitive complexity of the three heuristic correlate functions

**File:** `src/services/engine/correlation.ts:128, 233, 308`
**Issue:** The tiny-input fallback `if/else` added a branch to each of `correlate`/`correlateNews`/`correlateNewsSocial`, pushing cognitive complexity to 20 (limit 15). This is a maintainability concern, not a bug.
**Fix:** Extract the candidate-filtered loop into a small helper (e.g., `correlateIndexed(signals, contracts, cache)`) so each public function is a thin dispatch between the naive and indexed paths.

### IN-03: Pre-existing lint findings in unchanged pair functions

**File:** `src/services/engine/correlation.ts:182, 188, 277, 352`
**Issue:** `baseSim === 0` floating-point equality checks and `contractTags` as an array (should be a `Set`) are flagged by the linter. These are in `correlatePair`/`correlateNewsPair`/`correlateNewsSocialPair`, which the plan deliberately kept byte-for-byte unchanged as the equivalence oracle — so they are pre-existing, not introduced by this phase. Noted for completeness only.

---

_Reviewed: 2026-08-22_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
