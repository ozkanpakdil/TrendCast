# Feature Research

**Domain:** Browser-extension correlation fixes — entity bridging, ML progress UX, analysis scheduling, result persistence
**Researched:** 2026-08-27
**Confidence:** HIGH (codebase-grounded; ecosystem claims verified against Transformers.js official docs)

## Feature Landscape

This is a **fix/hardening milestone** on a mature codebase, not a greenfield feature build. "Features" here are *correct behaviors the product already promises but doesn't deliver*. Each is mapped to the existing code it touches — every fix is a modification of existing modules, zero new subsystems.

### Table Stakes (Users Expect These)

For a correlation dashboard, these are non-negotiable correctness behaviors. Missing any of them makes the Correlations tab feel broken — which is exactly the current state.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Ticker/cashtag entity bridging** — `AMZN` (stock-indicator news keyword), `$AMZN` (social cashtag), and `Amazon` (org name) all resolve to ONE canonical entity so correlation matches them | The whole point of adding stock-indicator sources (v0.1.5, SRC-03/04) was "correlation can match them against social signals" — a screener item for AMZN that never matches `$AMZN` posts is a silent data hole | MEDIUM | Root cause is **dual canonicalization** in `src/utils/entities.ts`: cashtags normalize to bare ticker (`amzn`), but `KNOWN_ORGS` aliases canonicalize to org name (`amazon`). A social signal carrying `$AMZN` yields entity `amzn`; a news headline "AMZN — Breakout" yields entity `amazon` (via KNOWN_ORGS alias) — weighted-Jaccard intersection is empty. Additionally: all-caps bare tickers (`AMZN`) match NO entity pattern (cashtag regex requires `$`; proper-noun regexes require mixed case), and `extractKeywords` keeps the `$` prefix (`$amzn`) so keyword-level Jaccard also fails to intersect with news keywords (`amzn`). Fix is a **unified canonical space**: one ticker-canonical alias map (ticker ↔ org name ↔ cashtag), emit both bare + `$`-prefixed keyword forms, and recognize bare all-caps tickers against `KNOWN_TICKERS`. All changes are pure functions in `entities.ts`/`keywords.ts` — the existing equivalence-test harness (`correlation-equivalence.test.ts`, `ner-equivalence.test.ts`) is the safety net |
| **Keyword noise filtering for indicator items** — screener-derived keywords like `vcp`, `2026`, `breakout` don't create false correlation bridges | These tokens appear in EVERY item from a source; if they ever match a contract/signal keyword, one screener row correlates with unrelated markets | LOW | `extractStockSymbols` already isolates real tickers; the headline template `${symbol} — ${label} ${date}` feeds `extractKeywords` which emits the label/date as keywords. Either filter source-label/date tokens from stock-indicator item keywords, or rely on the fact that they only hurt if they intersect — cheap to do at NewsItem construction in `src/services/collectors/news.ts` |
| **ML progress reflects actual worker state** — progress bar moves during model download AND clears when the run finishes (success, error, or cancel) | A progress bar that freezes at "Embedding contracts 40/120" while the worker has already finished destroys trust in the ML engines; users can't tell running from hung | MEDIUM | Two distinct gaps: (1) **Download phase is silent** — `createPipelineWithFallback` in `src/services/engine/ml/transformers.ts` passes no `progress_callback` to `lib.pipeline()`, so the (potentially minutes-long) Xenova/gte-small download emits zero events; Transformers.js supports `progress_callback` in pipeline options emitting `{status: 'initiate'\|'download'\|'progress'\|'done', file, loaded, total}` per file — wire it through to the existing `CORRELATION_PROGRESS` channel as a `loading-model` phase. (2) **Terminal-state leak** — `useCorrelations.ts` applies `CORRELATION_PROGRESS` unconditionally but rejects `CORRELATION_RESULT` when `requestId` mismatches (background precompute uses `precompute-*`, dashboard auto-run uses `corr-*`); when the dashboard's request is superseded or its result is rejected, `loading` stays true and the last progress frame freezes forever. The storage-polling fallback has the same requestId gate. Fix: scope progress by requestId, accept any result newer than request start (or when no active request), and clear progress on every terminal path |
| **Analysis runs at the right times** — no auto-analyze on every dashboard open; analyze only when no analysis exists; re-analyze after collectNow completes | Users expect opening a tab to *show* cached results instantly, not silently kick off a multi-minute ML job; and expect fresh data to produce fresh correlations | LOW–MEDIUM | Current behavior double-triggers: `corrInitRef` effect in `src/dashboard/App.tsx` fires `runCorrelation` on EVERY dashboard load with data, AND the background precomputes after every collection. Standard extension pattern (mirrors how `useSnapshot` already works): on mount, load cached correlations from storage (already implemented); trigger a run **only if storage has no result**; subscribe to `storage.onChanged` on `latestSnapshot`/`lastCollectionAt` (the exact pattern `useSnapshot.ts` lines 55–66 already use) and re-run when a new collection lands. The `corrInitRef` unconditional run is the code to remove/gate |
| **Correlation results survive reloads** — every result path (success, ML error, cancel) writes to `chrome.storage.local` and carries freshness metadata | Dashboard reload showing an empty Correlations tab despite a completed run is indistinguishable from "never ran" | LOW | Background paths (`runCorrelationAsync`, `runCorrelationPrecompute` in `src/background/index.ts`) already persist to `CONFIG.storage.correlations` and the hook loads it on mount — the gap is **freshness metadata**: results lack `computedAt`/input counts, so the "analyze only if no analysis exists" trigger can't distinguish a fresh result from a stale one, and error results overwrite good cached results with empty arrays. Add `computedAt` + `inputFingerprint` (counts or lastCollectionAt) to `CorrelationResult`; keep the existing per-key storage-cap pruning (PERF-03) authoritative |

### Differentiators (Competitive Advantage)

Not required for the fix, but cheap wins that fall out of the same code paths. Each aligns with the Core Value ("signal the user trusts as a daily decision aid").

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Model-download progress with per-file granularity** (beyond the fix) | During first-run gte-small download (~20–90 MB with tokenizer), a real byte-level bar converts "is it hung?" into "30% of onnx_model.wasm" — the single biggest trust win for ML engines | LOW | Falls out of wiring `progress_callback` anyway: aggregate `loaded/total` across files into one bar; label with the file name. Transformers.js emits per-file events; dedupe by `file` key |
| **Stale-result badge on cached correlations** | "Results from 14:32 · engine: Embedding" tells the user whether they're looking at live analysis or a leftover — supports the new trigger semantics (cached-until-recollect) | LOW | `computedAt` metadata (table stakes above) renders for free in `CorrelationStatsBar.tsx` / `CorrelationPanel.tsx` header |
| **Bridging diagnostics in source health** | Count of stock-indicator items that produced a canonical ticker entity vs. total — makes the correlation fix observable instead of vibes-based | MEDIUM | Extends `SourceHealth` projection in `src/utils/source-health.ts`; only worth it if bridging still under-matches after the canonical-space fix. Defer unless UAT shows residual gaps |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Fuzzy/substring ticker matching** (e.g. `amz` matches `AMZN`, `V` matches any "v" token) | "Catch more matches" | Bare 1–2 letter tickers (`V`, `A`, `F`) are English words/initials; substring matching produced the exact false-positive class the entity-confidence system exists to prevent. `matchKeyword` in `entities.ts` already word-boundary-guards short keywords for this reason | Exact match against a curated ticker set (`KNOWN_TICKERS`, extendable); cashtag regex stays strict (`$[A-Z]{1,6}\b`) |
| **Auto-analyze on every tab open "so it's always fresh"** | Feels safer than cached data | Re-runs a multi-minute ML job on every new-tab; MV3 service worker churn; duplicates the background precompute that already runs post-collection; caused the current stuck-progress confusion | Analyze-on-missing + re-analyze-on-collect (the milestone requirement); show `computedAt` so staleness is visible, not guessed |
| **Persisting every intermediate progress state to storage** | "So progress survives reload too" | Progress is ephemeral UI state; writing it to `chrome.storage` on every batch burns the storage budget (PERF-03 guards ~7 MB) and creates stale-progress-on-reload bugs worse than the one being fixed | Persist only terminal results; on reload with an in-flight run, show an indeterminate "running" state until the next progress/result message or storage poll |
| **Broadening `MIN_CONFIDENCE` / threshold tweaks to "make matches appear"** | Quick way to surface stock-indicator correlations | Masks the canonicalization bug with false positives; v1.0's REL-01 already proved diagnose-the-root-cause beats force-display | Fix the entity canonical space; keep thresholds as tuned |

## Feature Dependencies

```
[Unified ticker/cashtag canonicalization]  (entities.ts + keywords.ts)
    └──enables──> [Stock-indicator ↔ social/news correlation]  (the v0.1.5 promise)
                       └──feeds──> [Alerts + market-driven news views]  (existing consumers, no changes)

[progress_callback wiring]  (transformers.ts)
    └──feeds──> [Request-scoped progress + terminal-state clearing]  (useCorrelations.ts)
                       └──requires──> [requestId discipline across precompute/dashboard runs]  (background/index.ts)

[Persist results + computedAt metadata]  (types, background writers)
    ├──requires──> [Terminal-state clarity]  (same requestId work — you can't persist "done" reliably without it)
    └──enables──> [Analyze-only-if-missing trigger]  (App.tsx gate reads stored result existence + freshness)
                       └──requires──> [collectNow → re-analyze wiring]  (storage.onChanged on snapshot keys)
```

### Dependency Notes

- **Trigger gating requires persistence metadata:** "analyze only if no analysis exists" is only answerable if stored results carry `computedAt` (and ideally the engine/model that produced them). Do persistence metadata first or in the same phase.
- **Progress fix has two independent halves:** `progress_callback` wiring (worker/model side) and requestId-scoped terminal handling (dashboard side). They don't depend on each other — can ship/verify separately, but both are needed for "progress reflects actual worker state."
- **Entity bridging is upstream of everything correlation-shaped:** alerts (ALERT-01/02), consensus alerts (PHASE-10), and market-driven news (MKT-01) all consume correlation output; fixing canonicalization improves them all with zero changes to those modules. Equivalence tests must assert **no regression** on existing match sets while new bridged matches appear.
- **Keyword noise filtering conflicts with nothing** but should land with (not after) canonicalization — otherwise newly-bridged matches may include label/date false positives and muddy the equivalence diff.

## MVP Definition

### Launch With (v0.1.6)

- [ ] **Unified entity canonicalization** — cashtag `$AMZN`, bare ticker `AMZN`, and org name `Amazon` collapse to one canonical key; stock-indicator news correlates with social/news/markets — *the milestone's headline fix*
- [ ] **Keyword-form bridging** — `extractKeywords` emits bare form for cashtags (or correlation normalizes both sides) so keyword-level matching bridges too
- [ ] **Terminal-state progress fix** — progress scoped by requestId; result acceptance no longer deadlocks on `precompute-*` vs `corr-*`; progress clears on success/error/cancel
- [ ] **Model-download progress events** — `progress_callback` wired into pipeline creation, surfaced as `loading-model` phase
- [ ] **Result persistence with freshness metadata** — every terminal path writes `CONFIG.storage.correlations` including `computedAt`; error results don't clobber fresh good results
- [ ] **Trigger behavior** — no auto-analyze on tab open; run only when no stored analysis; re-run when collectNow/collection completes (storage.onChanged)
- [ ] **Unit + equivalence tests** — bridging matches appear; existing match sets unchanged; trigger logic covered (mirrors SRC-05/06 test discipline)

### Add After Validation (v0.1.7+)

- [ ] Stale-result badge in Correlation UI — trigger: `computedAt` shipped and users still confused about freshness
- [ ] Bridging diagnostics in source health — trigger: live testing shows residual under-matching
- [ ] Per-file download progress aggregation polish — trigger: first-run download UX still unclear

### Future Consideration (v2+)

- [ ] Full ticker universe beyond `KNOWN_TICKERS` (e.g. embedded NASDAQ/NYSE symbol list) — defer: curated set covers the user's actual watchlist; a 10k-symbol list adds bundle weight for marginal recall
- [ ] Cross-run embedding cache persistence (vectors to storage) — defer: in-memory cache already spans the three passes; storage cost/benefit unproven

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Unified ticker/cashtag canonicalization | HIGH | MEDIUM | P1 |
| Terminal-state progress fix (requestId scoping) | HIGH | LOW–MEDIUM | P1 |
| Trigger behavior (no auto-analyze; on-missing; post-collect) | HIGH | LOW | P1 |
| Result persistence + `computedAt` metadata | HIGH | LOW | P1 |
| Keyword-form bridging (bare vs `$`-prefixed) | HIGH | LOW | P1 |
| Model-download progress events | MEDIUM | LOW | P2 |
| Keyword noise filtering for indicator items | MEDIUM | LOW | P2 |
| Stale-result badge | MEDIUM | LOW | P3 |
| Bridging diagnostics | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor/Pattern Feature Analysis

| Feature | Typical financial tools (screeners, StockTwits-style) | Transformers.js ecosystem apps | Our Approach |
|---------|------------------------------------------------------|-------------------------------|--------------|
| Ticker normalization | Curated ticker↔company alias tables; strict cashtag regex; word-boundary matching for bare symbols | N/A | Extend existing `KNOWN_TICKERS`/`KNOWN_ORGS` into one ticker-canonical map — no new dependency, pure functions, testable |
| ML load progress | N/A | `progress_callback` on `pipeline()` options is the documented mechanism (per-file `initiate/download/progress/done` events) | Wire it through the existing worker → `CORRELATION_PROGRESS` → React state channel; no new messaging machinery |
| Long-job progress UX | N/A | requestId-scoped progress + terminal events; never leave UI state owned by a dead request | Scope progress by requestId; accept newer results; clear on all terminal paths |
| Computed-result caching | Cache keyed by inputs + timestamp; invalidate on data change | N/A | `computedAt` + input counts on `CorrelationResult`; invalidate on collection via existing `storage.onChanged` pattern |

## Sources

- **Codebase (HIGH confidence — read directly):** `src/utils/entities.ts` (cashtag → bare-ticker normalization; KNOWN_ORGS alias canonicalization; `matchKeyword` word-boundary guard), `src/utils/keywords.ts` (`$`-prefixed cashtag keywords), `src/services/collectors/news.ts` (stock-indicator item construction, keyword provenance), `src/services/engine/correlation.ts` (entity/keyword weighting, inverted index), `src/services/engine/ml/transformers.ts` (pipeline creation, no progress_callback), `src/workers/ml-worker.ts` + `src/background/index.ts` (progress/result message flow, `precompute-*` requestIds, storage writes), `src/dashboard/hooks/useCorrelations.ts` (unscoped progress application, requestId-gated result acceptance, storage polling), `src/dashboard/App.tsx` (`corrInitRef` auto-analyze, phase labels), `src/dashboard/hooks/useSnapshot.ts` (storage.onChanged pattern to mirror), `src/config/index.ts` (storage keys, budget caps)
- **Transformers.js official docs (HIGH confidence):** huggingface.co/docs/transformers.js — pipeline factory accepts `PretrainedModelOptions` including `progress_callback`; per-file download progress events (`initiate`/`download`/`progress`/`done` with `loaded`/`total`); dtype/quantization options as used by the existing `createPipelineWithFallback`
- **Domain convention (MEDIUM confidence):** financial NLP entity resolution standard practice — canonical ticker space with alias tables, strict cashtag regex, word-boundary guards for short tickers (consistent with the codebase's existing `matchKeyword` design)

---
*Feature research for: TrendCast v0.1.6 "fix correlation" milestone*
*Researched: 2026-08-27*
