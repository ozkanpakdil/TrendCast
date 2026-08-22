# Phase 3: Correlation Speedup - Context

**Gathered:** 2026-08-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the O(n×m) nested-loop correlation with an inverted keyword→contract index that pre-filters candidate contracts, applied consistently across the heuristic and ML correlation paths — with results provably equivalent to the current engine. This is a pure performance optimization with **zero new runtime dependencies** (per research SUMMARY.md). It is the hard dependency for Phase 4 (Correlation Alerts) and Phase 5 (Market-Driven News).

**In scope:** Shared inverted index + single tokenization source; candidate pre-filtering for heuristic AND all ML correlation paths; incremental index (cached by data version); golden-test equivalence vs the naive loop; naive fallback for tiny inputs.

**Out of scope:** Alerts (Phase 4), market-driven news view (Phase 5), watchlist/export (Phase 6), TikTok collector (Phase 7), storage caps / ML quantization (Phase 8).

</domain>

<decisions>
## Implementation Decisions

### Golden-Test Equivalence Strategy
- **D-01:** Equivalence tests must cover **all engines** — the heuristic path (`correlate`, `correlateNews`, `correlateNewsSocial`) AND all 5 ML engines (zeroshot, embedding, sentiment, ner, llm). Full equivalence, not just the heuristic bottleneck. — **Reversibility:** reversible — test-only, no production contract.
- **D-02:** Use a **hybrid oracle**: the naive O(n×m) loop is the reference oracle for the indexed path (indexed output must be identical — same matches, same confidence, same order), PLUS a small set of hand-verified golden fixtures for edge cases. The hand fixtures guard against both paths sharing the same bug. — **Reversibility:** reversible.
- **D-03:** Equivalence tests must cover **comprehensive edge cases**: empty keyword arrays, single contract, single signal, duplicate keywords, cashtag/hashtag-only texts, and the tiny-input fallback path (index not built). — **Reversibility:** reversible.
- **D-04:** Structure equivalence tests as **per-engine equivalence files** (e.g., `correlation-equivalence.test.ts` per engine) that run both paths over shared fixtures and assert identical results. Clear failure isolation. — **Reversibility:** reversible.

### the agent's Discretion
The user selected only the Golden-test equivalence area. The following areas were identified but NOT discussed — the agent has discretion, but should follow the research (SUMMARY.md) which already prescribes:
- **Index scope across engines:** Research mandates the shared index apply to heuristic AND ML paths (single tokenization source). Generalize the zero-shot engine's existing `findCandidateContracts` into a shared `Map<keyword, contractId[]>` index.
- **Canonical tokenization source:** One tokenizer shared by index + matcher. Research says "single tokenization source shared by index + matcher" — the planner should reconcile the heuristic's `extractKeywords`/`extractEntities` with the ML engines' tokenization.
- **Incremental index caching:** Research says "incremental index (cache by data version)". The planner decides in-memory vs persisted cache and the rebuild trigger key.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` §PERF-02 — The requirement this phase delivers: inverted keyword→contract index (O(n×m) → candidate filtering), results equivalent to current engine.
- `.planning/ROADMAP.md` §Phase 3 — Goal, success criteria (4 items), depends-on, requirements mapping.

### Research (authoritative on approach)
- `.planning/research/SUMMARY.md` — Mandates: zero new runtime deps; hand-rolled `Map<keyword, contractId[]>` index; generalize `findCandidateContracts`; single tokenization source; golden-test equivalence vs naive loop; incremental index (cache by data version); keep naive fallback for tiny inputs. Also documents Pitfall 5 (index drift) and its prevention.

### Existing Code (the machinery being optimized)
- `src/services/engine/correlation.ts` — The heuristic O(n×m) engine with `EntityCache`; the naive loop that is the equivalence oracle.
- `src/services/engine/ml/zeroshot.ts` — Existing `findCandidateContracts` / `findCandidateContractsForNews` pre-filters to generalize into the shared index.
- `src/services/engine/ml/embedding.ts`, `sentiment.ts`, `ner.ts`, `llm.ts` — The other ML engines, each with their own pre-filter / index patterns.
- `src/utils/keywords.ts` — `extractKeywords` + `keywordSimilarity` (Jaccard), the heuristic tokenization source.
- `src/utils/entities.ts` — `extractEntities` / `extractEntityKeywords`, entity-based matching used by the heuristic path.
- `src/services/engine/ml.ts` — The ML engine dispatch (correlateEmbedding, correlateSentiment, correlateZeroShot, correlateNER, correlateLLM + news variants).

### Tests (equivalence guard)
- `tests/unit/correlation.test.ts` — Existing heuristic correlation tests; the naive-loop fixtures to reuse for equivalence.
- `tests/unit/correlation-threshold.test.ts` — Threshold behavior tests.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `EntityCache` in `src/services/engine/correlation.ts`: already caches entity extraction per text — the heuristic path's memoization to preserve.
- `findCandidateContracts` / `findCandidateContractsForNews` in `src/services/engine/ml/zeroshot.ts`: the existing keyword-overlap pre-filter to generalize into the shared inverted index.
- `keywordSimilarity` in `src/utils/keywords.ts`: Jaccard similarity used by the heuristic path.
- `extractKeywords` / `extractEntities` in `src/utils/keywords.ts` / `src/utils/entities.ts`: the tokenization sources.

### Established Patterns
- **One-file-per-engine** convention in `src/services/engine/ml/` (zeroshot.ts, embedding.ts, sentiment.ts, ner.ts, llm.ts each expose 3 correlate fns + a shared index class).
- **Index-class pattern**: each ML engine already has an index class (`ZeroShotIndex`, `EmbeddingIndex`, `SentimentIndex`, `NEREntityIndex`) with a `cache` Map — the shared inverted index should follow this shape.
- **Pre-filter before expensive inference**: zero-shot already reduces NLI passes from O(signals×contracts) to O(signals×min(matching, MAX_LABELS)) — the shared index generalizes this.

### Integration Points
- `src/services/engine/ml.ts` — the facade that dispatches to each engine; the shared index must be wired here so all paths use it.
- `src/background/index.ts` — the orchestrator that calls correlation; the index build/cache lifecycle hooks in here.
- `src/services/engine/correlation.ts` — the heuristic path to convert from nested loop to candidate-filtered.

</code_context>

<specifics>
## Specific Ideas

- The user emphasized **full equivalence across all engines** — the indexed path must be provably identical to the naive loop, not just "close enough". This is the primary correctness guard for the phase.
- The user chose a **hybrid oracle** (naive loop + hand-verified fixtures) specifically to guard against both paths sharing the same bug.
- The user wants **comprehensive edge-case coverage** including the tiny-input fallback path.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 3-Correlation Speedup*
*Context gathered: 2026-08-22*
