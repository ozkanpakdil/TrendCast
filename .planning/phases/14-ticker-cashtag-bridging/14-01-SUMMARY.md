---
phase: 14-ticker-cashtag-bridging
plan: 01
subsystem: correlation-engine
tags: [entities, tickers, cashtags, correlation, embeddings, ml]
provides:
  - Unified ticker/cashtag/org entity identity (CORR-01)
  - Bare-caps ticker recognition with 3-gate filtering
  - Ticker-aware correlation boost (CORR-02)
  - Legacy stored-keyword `$`-strip bridging
  - Embedding pipeline hardening (dtype restriction, batching, WebGPU sanity check)
  - Correlation top-K diagnostics + timestamped progress logging
affects: [14-02 keyword curation, source-health bridging coverage, alerts display]
tech-stack:
  added: []
  patterns: [org-canonical entity identity, literal-regex + Set-gate entity recognition, single-pass batched embedding, runtime ML sanity probe with backend fallback]
key-files:
  created:
    - tests/unit/bridging.test.ts
  modified:
    - src/utils/keywords.ts
    - src/utils/entities.ts
    - src/services/engine/correlation.ts
    - src/services/engine/index.ts
    - src/background/alerts.ts
    - src/background/index.ts
    - src/services/engine/ml/embedding.ts
    - src/services/engine/ml/transformers.ts
    - tests/unit/fixtures.ts
    - tests/unit/correlation.test.ts
    - tests/unit/index.test.ts
    - tests/unit/correlation-equivalence.test.ts
    - tests/unit/quantization-equivalence.test.ts
key-decisions:
  - "Org-canonical identity: ticker with known org resolves to org key (nvda→nvidia, amzn→amazon); TICKER_TO_ORG derived from KNOWN_ORGS ∩ KNOWN_TICKERS, no second ticker table"
  - "Bare-caps recognition uses literal /\\b([A-Z]{2,6})\\b/g + 3 gates (KNOWN_TICKERS ∧ ¬STOP_WORDS ∧ not-seen); dynamic-pattern sites remain exactly 1 (ReDoS/ASVS V5)"
  - "Boost fires on any known-ticker keyword overlap (isKnownTicker(k) || k.startsWith('$')), not just $-prefixed — intended CORR-02 semantics"
  - "EMBEDDING_SUPPORTED_DTYPES excludes q4 (WebGPU returns garbage for quantized MiniLM); runtime sanity probe auto-falls-back to WASM"
  - "embedBatch runs whole input in ONE pipeline call (EMBED_BATCH_SIZE=32); nested re-chunking was a 25x slowdown"
patterns-established: []
duration: "90min"
completed: 2026-08-27
status: complete
---

# Phase 14 Plan 01: Ticker/Cashtag Bridging Summary

**Ticker-identity bridging shipped: `$NVDA` social posts, `NVDA — Stock Indicator` news, and Nvidia contracts now unify on one entity key, with ticker-aware boost and hardened embedding pipeline.**

## Performance

- **Duration:** ~90 min (across 3 debugging rounds + 2 tasks)
- **Tasks:** 2 of 2 complete
- **Files modified:** 16 (1 created)

## Accomplishments

- **Task 1 (tracer):** cashtag stage emits bare form alongside `$`-prefixed keyword; `keywordSimilarity` strips one leading `$` per side so legacy stored news keywords (`$amzn`) bridge to bare postings (`amzn`).
- **Task 2 (bridging):** entity unification on org-canonical keys (`$AMZN`/`AMZN`/`Amazon` → `amazon`); new bare-caps recognition stage (1b) with 3 gates; correlation boost reworked to fire on known-ticker overlaps; `humanizeTopic` uppercases known tickers (`btc` → `BTC`).
- **Embedding hardening (Rule 1 deviations, user-reported):** q4 dtype excluded from WebGPU embeddings (garbage vectors); single-pass batched `embedBatch` (26s → 8.6s for 10 items); runtime sanity probe rejects degenerate WebGPU output and falls back to WASM.
- **Diagnostics:** timestamped progress logs (`+X.Xs` deltas, `total X.Xs`); `logTopPairs` logs top-5 cosine pairs regardless of threshold in both correlation paths.
- **Tests:** 381/381 passing (31 files), including new `bridging.test.ts` (16 tests: unification, bare-caps gates, keyword bridging, purity, e2e on both engine paths). Typecheck 0, lint 0.

## Task Commits

1. **Task 1: bare cashtag emission + legacy strip-$ keyword bridge (tracer)** — not committed (per project rules user stages/commits)
2. **Task 2: entity unification + bare-caps ticker recognition + boost rework** — not committed (per project rules user stages/commits)
3. **Embedding hardening (deviation)** — not committed; suggested message: `fix(ml): embedding dtype/batching/WebGPU sanity`

## Files Created/Modified

- `src/utils/keywords.ts` — cashtag → bare-form emission; `keywordSimilarity` strips one leading `$` per side
- `src/utils/entities.ts` — `aapl`/`goog` aliases; `TICKER_TO_ORG` map; `isKnownTicker` export; cashtag canonicalization + dedupe on org-or-ticker key; bare-caps stage 1b (confidence 0.85)
- `src/services/engine/correlation.ts` — `isKnownTicker` import; `candidateKeywords` strips one leading `$`; boost detection `isKnownTicker(k) || k.startsWith('$')` both sides; `#`-hashtag half unchanged
- `src/services/engine/index.ts` — candidates() sorted output (Task 1)
- `src/background/alerts.ts` — `humanizeTopic` uppercases known tickers
- `src/background/index.ts` — `logTime()` helper; progress logs with `+X.Xs`/`elapsed` deltas
- `src/services/engine/ml/embedding.ts` — `EMBED_BATCH_SIZE=32` single-pass `embedBatch`; `logTopPairs` diagnostic
- `src/services/engine/ml/transformers.ts` — `EMBEDDING_SUPPORTED_DTYPES` (q4 excluded); `isEmbeddingPipelineSane` sanity probe; WebGPU→WASM fallback
- `tests/unit/bridging.test.ts` — NEW: 16 tests (CORR-01 unification, A1 bare-caps gates, CORR-02 bridging, purity, e2e indexed+naive)
- `tests/unit/fixtures.ts`, `tests/unit/correlation.test.ts`, `tests/unit/index.test.ts` — canonical-form lockstep updates (Task 1)
- `tests/unit/correlation-equivalence.test.ts` — `naiveCorrelatePair` boost block mirrors production exactly
- `tests/unit/quantization-equivalence.test.ts` — pinned q8; sanity-probe mocks; `resetPipelineCaches()`

## Decisions & Deviations

- **Org-canonical identity model** (decided pre-execution): ticker with known org → org key; bare ticker otherwise. All 8 ticker-backed orgs reachable (aapl, msft, googl/goog, amzn, meta, tsla, nvda).
- **Rule 1 deviations (user-reported defects, fixed mid-plan):**
  1. q4 dtype on WebGPU produced degenerate embeddings → `EMBEDDING_SUPPORTED_DTYPES = ['q8','fp16','fp32']`
  2. Nested chunking (index chunks to 10, embedBatch re-chunked to 1) → 100 single-text calls, 26s/10 items → single-pass batch
  3. Firefox WebGPU silently returns garbage vectors for quantized MiniLM → runtime sanity check (related/unrelated gap ≥ 0.15) with auto-WASM fallback
- **Task 2 test-fixture deviation:** e2e `correlateNews` fixture needed realistic Amazon contract `keywords: ['amazon','amzn']` — sparse contracts fail entity threshold (0.35) when stock-indicator noise entities dilute weighted Jaccard. Test-only; Plan 14-02 curation mitigates.
- **Threshold interaction (documented):** bare-caps entities raise entity-map cardinality on stock-indicator headlines, which can drop weighted-Jaccard below 0.35 for sparse contracts. Matches still occur when either side carries ticker-form keywords (realistic collector shape). 14-02 keyword curation directly mitigates.

## Next Phase Readiness

- **14-02 (Wave 2) ready:** ticker-only keyword curation in `src/services/collectors/news.ts` stock-indicator block (CORR-03) + `computeBridgingCoverage` in `src/utils/source-health.ts` with SourceHealthIndicator display (CORR-04).
- Structural bridging is in place; user should rebuild (`bun run build:debug:firefox`), reload, re-run Analyze to see `$NVDA` ↔ `NVDA — VCP` ↔ Nvidia contracts connect.
- Note: news→market matches require contracts containing stock markets; current 100-contract set has none (FIFA/climate/NATO/energy/Brazil only).
