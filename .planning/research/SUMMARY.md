# Project Research Summary

**Project:** TrendCast
**Domain:** Browser-extension bugfix/hardening milestone (MV3, 100% client-side) — correlation matching, ML progress UX, analysis scheduling, result persistence
**Researched:** 2026-08-27
**Confidence:** HIGH

## Executive Summary

v0.1.6 "fix correlation" is a fix-scoped milestone on a mature codebase: four behaviors the product already promises but doesn't deliver. All four researchers independently converged on the same conclusions — **zero new dependencies**, every fix is a modification of existing modules, and every root cause is pinned to a specific file by direct code inspection. This is not a design problem; it is a precision problem. The existing architecture (background-orchestrator + storage-as-state + React dashboard) is correct and stays untouched; the fixes repair broken hops inside it.

The root causes, verified against source: **(1) Bridging** — dual canonicalization in `src/utils/entities.ts` (cashtags normalize to bare ticker `amzn`, but `KNOWN_ORGS` aliases canonicalize to org name `amazon`) plus `src/utils/keywords.ts` keeping the `$` prefix on cashtag keywords, plus bare all-caps tickers (`AMZN`) matching no entity pattern at all. Stock-indicator news and `$AMZN` social signals never intersect in either the keyword or entity space. **(2) ML progress** — `createPipelineWithFallback()` in `src/services/engine/ml/transformers.ts` passes no `progress_callback` (model download is silent), `useCorrelations.ts` applies progress unconditionally but rejects results on `requestId` mismatch (`precompute-*` vs `corr-*`), and the single-slot `mlWorker` resolver in `src/background/index.ts` lets overlapping runs overwrite each other — the worker finishes but the dashboard's loading state never settles. **(3) Triggers** — the `corrInitRef` effect in `src/dashboard/App.tsx` auto-runs correlation on every dashboard open. **(4) Persistence** — results already write to `CONFIG.storage.correlations`, but lack `computedAt`/input-count metadata (so "does an analysis exist?" is unanswerable), error results clobber good cached ones, and dual appliers (message listener + storage poll) can double-record runs.

The recommended approach: canonicalize all ticker-like tokens to bare lowercase form at extraction **and** comparison time (comparison-time canonicalization rescues already-stored legacy data without a migration); wire `progress_callback` at the single `createPipelineWithFallback` choke point and scope all progress/result handling by `requestId` with a storage-backed run-state record as truth (broadcasts are hints); make the background the sole owner of post-collection re-analysis while the dashboard's only trigger responsibility is the mount-time "no analysis exists" case. The key risks are over-bridging false positives (gate bare-ticker recognition on `KNOWN_TICKERS`), silently breaking the inverted-index superset invariant (the equivalence suites are the guard — never relax their assertions), the "stuck bar" bug class (every terminal path must funnel through one settle), and MV3 service-worker death mid-run (persisted run marker is the recovery path).

## Key Findings

### Recommended Stack

**Zero new runtime dependencies.** All four features are pure-TypeScript fixes in existing modules; adding any library would be overbuilding on a privacy-focused, ~7 MB-budget extension. The only "new" surface is a verified API of an existing dependency.

**Core technologies (all installed, unchanged):**
- TypeScript ^5.5.4 (strict) — all fix logic; `tsc --noEmit` gate in every build
- React ^18.3.1 — trigger behavior + progress UI; `useRef`/effect changes only, no state library
- @huggingface/transformers 3.8.1 (installed) — `progress_callback` API **verified against the installed copy** (`node_modules/.../hub.js`): events `{status: 'initiate'|'download'|'progress'|'done', name, file, progress?, loaded?, total?}`; **no `'ready'` status exists** — treat pipeline-promise resolution as load-complete
- webextension-polyfill 0.12.0 — `browser.storage.local` persistence via existing `CONFIG.storage.correlations` key (already in `BUDGET_KEYS`)
- Vitest ^2.0.5 + Playwright ^1.62.1 — pure-function tests (`normalizeTicker`, `shouldAutoAnalyze`) + trigger/persistence e2e; **Bun mandatory** (never npm/npx)

### Expected Features

**Must have (table stakes — the milestone's definition of done):**
- Unified ticker/cashtag canonicalization — `$AMZN`, bare `AMZN`, and org name `Amazon` collapse to one canonical key; stock-indicator news correlates with social/news/markets (the headline fix)
- Keyword-form bridging — `extractKeywords` emits bare cashtag forms (or comparison normalizes both sides) so keyword-level Jaccard bridges too
- Terminal-state progress fix — progress scoped by `requestId`; result acceptance no longer deadlocks on `precompute-*` vs `corr-*`; progress clears on success/error/cancel
- Model-download progress events — `progress_callback` wired into pipeline creation, surfaced as a `loading-model` phase
- Result persistence with freshness metadata — every terminal path writes `computedAt` (+ input counts); error results don't clobber fresh good results
- Trigger behavior — no auto-analyze on tab open; run only when no stored analysis; re-analyze when collection completes
- Keyword noise filtering — screener tokens (`vcp`, `2026`, `breakout`) kept out of stock-indicator item keywords
- Unit + equivalence tests — bridged matches appear, existing match sets unchanged, trigger logic covered

**Should have (cheap differentiators):**
- Per-file download progress aggregation (falls out of `progress_callback` wiring)
- Stale-result badge ("results from 14:32") — renders for free once `computedAt` exists

**Defer (v1.0.7+/v2):**
- Bridging diagnostics in source health; full ticker universe beyond `KNOWN_TICKERS`; cross-run embedding-cache persistence

**Anti-features (explicitly rejected by research):** fuzzy/substring ticker matching (false-positive class the entity-confidence system exists to prevent); auto-analyze on every tab open; persisting intermediate progress to storage; loosening `MIN_CONFIDENCE` to force matches.

### Architecture Approach

The architecture is fixed — this milestone repairs hops inside the existing background-orchestrator + storage-as-state + React-dashboard structure. Four patterns govern the fixes: **(1)** canonicalization at the extraction boundary (plus comparison-time canonicalization for legacy stored rows — no data migration); **(2)** storage-as-state for run lifecycle (persist run-state to `chrome.storage.local`; treat broadcasts as fast-path hints — the established `alertState` precedent); **(3)** single-writer persistence helper (`persistCorrelationResult()` owned by the background; both run paths call it — mirrors the `merge.ts`/`alerts.ts` extraction precedent); **(4)** serialize access to the singleton ML worker (promise-chain queue). Anti-patterns to avoid: fixing bridging in the matcher only (the inverted index still keys on decorated keywords — candidates never surface), migrating stored keywords, trusting broadcasts for UI state, and two owners for "when to analyze."

### Critical Pitfalls

1. **One-sided normalization** — normalizing at extraction only leaves days of stored old-format data un-bridged. Normalize at a single choke point **and** at comparison/load time; fixture-test with stored old-format data, not just fresh fixtures.
2. **Inverted-index superset invariant break** — if normalization reaches the similarity functions but not `candidateKeywords()`/index postings (or vice versa), the fast path silently misses what the naive loop finds. Treat any `correlation-equivalence` failure as a real invariant break; never relax the assertions.
3. **Over-bridging** — bare-word tickers collide with English (`ALL`, `ON`, `V`) and screener noise (`vcp`, `2026`). Gate bare-caps recognition on `KNOWN_TICKERS` ∩ length ≥ 2, exclude stop words, keep bridged-match confidence below cashtag's 0.95, and prefer boosting over threshold-bypassing.
4. **Stuck-bar class bugs** — three compounding causes: silent model download (no `progress_callback`), requestId-gated result rejection, and worker death without an error message. Fix: `progress_callback` at the single choke point, requestId-scoped progress **and** results, one `settle()` for every terminal path, and a persisted run-state marker so any tab can reconstruct/clear state.
5. **Trigger races and error-as-exists** — "analysis exists" checked in React state races the storage load; two trigger paths double-fire; persisted error results permanently suppress auto-analysis. Gate on the *loaded* cached correlations, define "exists" as present **and** `!error` **and** fresh, serialize through one guarded trigger function, and let the background own post-collection re-analysis.

Also load-bearing: MV3 service-worker lifetime (persist a run marker `{requestId, engine, startedAt}` before starting; progress events incidentally keep the SW alive, so wiring download progress fixes UX *and* lifetime), and persistence hygiene (trim before persist, await and check every `set()`, idempotent apply via `lastAppliedRequestId` — fixes the existing double-history bug as a side effect).

## Implications for Roadmap

**Ordering note (consensus vs. conflict):** The orchestrator's suggested order was F1 → F2 → F3 → F4. ARCHITECTURE.md and FEATURES.md both identify a hard dependency the other way: the F3 trigger "analyze only if no analysis exists" is only answerable once results carry `computedAt` metadata (F4), and F3's triggers are only race-safe once the ML queue exists (F2). PITFALLS.md groups triggers+persistence as one phase. Synthesis: keep the consensus F1-first and F2-second, but place **F4 before F3** — or merge F4+F3 into a single phase if the roadmap prefers three phases. The phase structure below reflects the dependency-correct order.

### Phase 1: Ticker/Cashtag Bridging (F1)
**Rationale:** Isolated, highest user value (correlation actually working — the v0.1.5 promise), pure functions with an existing equivalence-test harness as safety net; no dependencies on other phases.
**Delivers:** `normalizeTicker` canonical form in `keywords.ts` + `entities.ts` (bare lowercase everywhere), bare all-caps ticker recognition gated on `KNOWN_TICKERS`, `$`-strip in `keywordSimilarity` for legacy stored data, cashtag-boost reworked to entity-type/ticker-set checks, stock-indicator keyword curation in `news.ts`.
**Addresses:** Unified canonicalization, keyword-form bridging, keyword noise filtering.
**Avoids:** Pitfalls 1–3 (one-sided normalization, index superset break, over-bridging).

### Phase 2: ML Run Orchestration + Progress (F2)
**Rationale:** The stuck-progress bug has three compounding causes that must be fixed together; the queue must exist before trigger changes (Phase 4) so triggers are race-safe. Uses the storage-as-state pattern Phase 3 formalizes.
**Delivers:** Serialized ML run queue in `background/index.ts`; persisted run-state record (`trendcast:corr-run-state`, throttled writes); `progress_callback` wired in `createPipelineWithFallback` mapped to a `loading-model` phase; requestId-scoped progress + result acceptance in `useCorrelations`; single `settle()` terminal guarantee; run marker for MV3 SW-death recovery.
**Addresses:** Terminal-state progress fix, model-download progress events.
**Avoids:** Pitfalls 4–6 and 10 (silent download, no terminal state, late progress messages, SW lifetime).

### Phase 3: Correlation Persistence + Freshness Metadata (F4)
**Rationale:** Small, isolated, and a hard prerequisite for Phase 4 — the "analyze only if none exists" check is unanswerable without `computedAt`/error metadata. Also fixes existing bugs (error results clobbering good ones, double-recorded run history).
**Delivers:** `computedAt` + `inputCounts` on `CorrelationResult` (optional fields, backfill on read); single `persistCorrelationResult()` helper (write → broadcast → alert sweep → market-news rebuild) used by both run paths; background-owned run stats; idempotent apply guard; trim-on-persist + quota check.
**Addresses:** Result persistence with freshness metadata.
**Avoids:** Pitfall 9 (quota, serialization, double-apply) and the error-result-clobbers-cache failure.

### Phase 4: Analysis Trigger Behavior (F3)
**Rationale:** Last because it *changes when runs happen* — do it once the run machinery is safe (Phase 2's queue) and the existence check is answerable (Phase 3's metadata). Depends on both.
**Delivers:** `corrInitRef` effect replaced by a gated mount-time check (`shouldAutoAnalyze({hasStoredResult, hasData})` pure function, gated on *loaded* cached correlations, excluding error results); background confirmed as sole owner of post-collection re-analysis (existing precompute path — dashboard adds no second trigger); in-flight guard serializing all trigger paths.
**Addresses:** Trigger behavior (no auto-analyze on open; on-missing; post-collect).
**Avoids:** Pitfalls 7–8 (trigger races, error-as-exists, stale-data re-analyze, double-fire).

### Phase Ordering Rationale

- **F1 first:** isolated, highest user value, zero cross-phase deps; equivalence suites catch regressions immediately.
- **F2 before F3/F4:** the ML queue makes any residual concurrency (mount-time analyze racing a precompute) safe; the run-state record defines the storage shape the trigger logic reads.
- **F4 before F3:** "analyze only if no analysis exists" requires `computedAt` + explicit error semantics on stored results; shipping triggers first would re-create the auto-analyze-on-every-open bug via the load race.
- **Merging option:** Phases 3+4 can merge into one "persistence + triggers" phase (PITFALLS.md's grouping) since the metadata and its consumer are small; keeping them separate gives cleaner verification seams.
- **No stored-data migration anywhere:** comparison-time canonicalization + backfill-on-read let natural eviction retire legacy rows.

### Research Flags

Phases likely needing deeper research during planning:
- **None require a full research-phase.** All four phases are codebase-grounded (HIGH confidence, direct source reads) with pinned edit sites.

Light verification during planning (no research-phase needed):
- **Phase 2:** confirm `progress_callback` event shape against the installed 3.8.1 copy (STACK.md already verified it — HIGH; note ARCHITECTURE.md's `'ready'`-event claim comes from repo `main` and is contradicted by the installed source — **do not gate UI on a `'ready'` event; treat pipeline-promise resolution as load-complete**). Verify Firefox synthetic-100% cache-hit behavior in e2e under `TARGET=firefox`.

Phases with standard patterns (skip research-phase):
- **Phase 1:** pure functions + existing equivalence harness.
- **Phase 3:** existing storage-as-state + `BUDGET_KEYS` patterns.
- **Phase 4:** pure predicate + existing `useSnapshot` `storage.onChanged` pattern to mirror.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero-dep verdict verified against installed `node_modules` (transformers 3.8.1 `progress_callback` API read directly); no version changes |
| Features | HIGH | Every feature mapped to verified edit sites; MVP list is codebase-grounded |
| Architecture | HIGH | Root causes pinned by direct code reads; fix shapes follow established codebase patterns (`alertState`, `merge.ts` extraction) |
| Pitfalls | HIGH | Every pitfall verified against actual source; MV3 lifecycle + storage quota claims verified against Chrome docs |

**Overall confidence:** HIGH — unusually so, because this is a fix milestone on a codebase all four researchers read directly, with external API claims verified against installed sources.

### Gaps to Address

- **Transformers.js `'ready'` event conflict:** STACK.md (installed 3.8.1 source, HIGH) says no `'ready'` status exists; ARCHITECTURE.md (repo `main`, MEDIUM) mentions a terminal `ready` event. Resolve by trusting the installed copy; plan the UI around promise-resolution + run-state, not a `'ready'` event.
- **Legacy-data canonicalization site:** extraction-time + `keywordSimilarity` strip (ARCHITECTURE) vs. load-time/index-build normalization (PITFALLS perf guidance — never normalize inside the pairwise loop). Settle during Phase 1 planning; both are cheap, but pick one comparison-time location and perf-check against PERF-02.
- **Post-collection re-analysis ownership:** research converges on background-owned (existing precompute path), dashboard display-only. Confirm during Phase 4 planning and document it — a dashboard-side duplicate trigger is the exact double-run race Phase 2's queue absorbs.
- **e2e suite known gap:** `tests/e2e/dashboard.spec.ts` asserts 9 tabs vs the app's 11 — may need fixing before Phase 4's trigger e2e assertions.
- **Embedding cache key:** bridging changes keywords, not embedder input text — verify `embedding-equivalence` stays green; if any embedder input changes, bump the cache key/version.
- **Quota at production scale:** max-caps (1000×1000) result + persisted metadata vs the ~7 MB budget needs an explicit unit test (PERF-03 authority).
- **Firefox coverage:** trigger/progress e2e must run under `TARGET=firefox` (message-channel and cache-progress quirks are browser-specific).

## Sources

### Primary (HIGH confidence)
- TrendCast source (direct reads by all four researchers): `src/utils/keywords.ts`, `src/utils/entities.ts`, `src/services/engine/correlation.ts`, `src/services/engine/index.ts`, `src/services/engine/ml/{embedding,types,transformers}.ts`, `src/workers/ml-worker.ts`, `src/background/{index,merge,alerts}.ts`, `src/dashboard/App.tsx`, `src/dashboard/hooks/{useCorrelations,useSnapshot}.ts`, `src/services/collectors/news.ts`, `src/config/index.ts`, `src/types/index.ts`, `src/utils/{storage,source-health}.ts`, `src/messaging/index.ts`
- `node_modules/@huggingface/transformers@3.8.1/src/utils/hub.js` + `src/models.js` — `progress_callback` event lifecycle, Firefox cache-hit synthetic event (installed source of truth)
- `.planning/PROJECT.md` — milestone context, PERF-02/03 constraints, 360-test suite incl. equivalence suites
- Chrome developer docs — service-worker lifecycle (30s idle, 5-min cap), `chrome.storage` quotas — developer.chrome.com

### Secondary (MEDIUM confidence)
- Transformers.js official docs — pipeline `PretrainedModelOptions.progress_callback`, per-file download events — huggingface.co/docs/transformers.js
- Transformers.js GitHub source (`main`) — progress wiring (contradicted by installed copy on the `'ready'` event; installed copy wins)
- Financial NLP entity-resolution convention — canonical ticker space with alias tables, strict cashtag regex, word-boundary guards

### Tertiary (LOW confidence)
- Web-sourced worker progress requestId-scoping and persisted run-state practice (cached research-store keys) — consistent with codebase precedent, no direct verification needed

---
*Research completed: 2026-08-27*
*Ready for roadmap: yes*
