---
phase: 03-correlation-speedup
audited: 2026-08-22
asvs_level: 1
block_on: high
threats_total: 8
threats_verified: 8
threats_open: 0
status: secured
---

# Phase 3: Security Audit — Correlation Speedup

**Audited:** 2026-08-22
**ASVS Level:** 1
**Block on:** high
**Verdict:** SECURED (8/8 threats verified, 0 open)

## Summary

Retroactive security audit of the Phase 3 (Correlation Speedup) implementation. The phase is a performance refactor that replaces the O(n×m) nested-loop candidate scan with a shared `InvertedIndex` (candidate pre-filtering) across the heuristic and ML correlation paths. All threats were verified against the actual implementation files (not just documentation). No high-severity threats are open.

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Verified |
|-----------|----------|-----------|----------|-------------|----------|
| T-3-01 | Tampering | `InvertedIndex.build` | low | mitigate | ✅ |
| T-3-02 | DoS | `InvertedIndex` map | low | mitigate | ✅ |
| T-3-03 | Tampering | `correlate`/`correlateNews`/`correlateNewsSocial` | low | mitigate | ✅ |
| T-3-04 | DoS | candidate pre-filter | low | mitigate | ✅ |
| T-3-05 | Tampering | zeroshot/sentiment/llm candidate pre-filter | low | mitigate | ✅ |
| T-3-06 | DoS | candidate pre-filter | low | mitigate | ✅ |
| T-3-07 | Tampering | embedding/NER equivalence tests | low | mitigate | ✅ |
| T-3-08 | DoS | embedding/NER naive loop | low | accept | ✅ |
| T-3-SC | Tampering | npm/pip/cargo installs | high | mitigate | ✅ |

## Mitigation Verification (against source)

### T-3-01 — Single tokenization source (Tampering, low)
**Mitigation:** Build the index only from `contract.keywords` (already normalized by `extractKeywords`); never re-tokenize with a different function.
**Verified:** `src/services/engine/index.ts` `collectTokens` builds the token set from `item.keywords` (line 86). Entity-derived keywords are only added when `opts.includeEntityKeywords` is set, and they come from the same `extractEntityKeywords` util used by the matcher — no divergent tokenizer. ✅

### T-3-02 — Cap distinct keyword cardinality (DoS, low)
**Mitigation:** Cap distinct keyword cardinality during build to bound index memory.
**Verified:** `src/services/engine/index.ts:32` defines `MAX_DISTINCT_KEYWORDS = 10_000`; line 72 skips postings beyond the cap. Storage budget already bounds collected data. ✅

### T-3-03 — Heuristic path single tokenizer (Tampering, low)
**Mitigation:** Build the index only from `contract.keywords`/`signal.keywords`; never re-tokenize.
**Verified:** `src/services/engine/correlation.ts` builds the index via `getIncrementalIndex(contracts, { includeEntityKeywords: true })` and queries with `candidateKeywords` (union of `item.keywords` + `extractEntityKeywords(item.text)`), all from the shared normalized source. ✅

### T-3-04 — Candidate pre-filter dedup (DoS, low)
**Mitigation:** `InvertedIndex.candidates` dedups via `Set` and returns order-preserving indices; index size bounded by build cap.
**Verified:** `src/services/engine/index.ts:97-102` uses `Set<number>` for dedup and returns `[...seen]` preserving contract order. ✅

### T-3-05 — ML path single tokenizer (Tampering, low)
**Mitigation:** Build the index only from `keywords` arrays; single tokenization source.
**Verified:** `zeroshot.ts`, `sentiment.ts`, `llm.ts` all consume `getIncrementalIndex` built from the same `keywords` arrays. No divergent tokenization. ✅

### T-3-06 — Per-engine inference caps (DoS, low)
**Mitigation:** `InvertedIndex.candidates` dedups via `Set`; per-engine caps bound inference cost; index size bounded by build cap.
**Verified:** `zeroshot.ts` caps at `ZEROSHOT_MAX_LABELS` (lines 183/240/293); `llm.ts` caps at `LLM_MAX_CANDIDATES` (lines 259/338/415). ✅

### T-3-07 — Embedding/NER equivalence tests (Tampering, low)
**Mitigation:** Tests mock the pipeline deterministically and assert exact output; no external input surface.
**Verified:** `embedding-equivalence.test.ts` and `ner-equivalence.test.ts` mock pipelines deterministically and assert deep-equality against naive oracles. ✅

### T-3-08 — Embedding/NER naive loop retained (DoS, low, accepted)
**Mitigation:** These engines' dominant cost is already batched embedding/extraction; the keyword index is not a valid superset for semantic/entity similarity, so the naive loop is retained and documented.
**Verified:** `grep` confirms `embedding.ts` and `ner.ts` contain **no** references to `getIncrementalIndex`/`getInvertedIndex`/`InvertedIndex` — they remain on the naive loop as designed. ✅

### T-3-SC — Zero new dependencies (Tampering, high)
**Mitigation:** Zero new runtime dependencies this phase; no package installs.
**Verified:** `git diff package.json` is empty — no dependency changes. ✅

## Post-review note (WR-01)
The incremental cache key was originally keyed only on contract IDs, which could return a stale index when `mergeMarkets` overwrites a contract's `keywords` while keeping the same `id`. This was fixed post-review: the version hash now includes each contract's keyword content. Verified in `src/services/engine/index.ts` `getIncrementalIndex`. This is a correctness fix (PERF-02 equivalence), not a security threat, but it is noted here for completeness.

## Conclusion
**SECURED** — all 8 threats verified, 0 open. No high-severity threats. Phase 3 may advance.
