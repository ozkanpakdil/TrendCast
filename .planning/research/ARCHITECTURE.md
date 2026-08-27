# Architecture Research

**Domain:** Manifest V3 browser extension — correlation pipeline fixes (ticker bridging, ML progress, analysis triggers, result persistence)
**Researched:** 2026-08-27
**Confidence:** HIGH (codebase-read-derived; external API facts MEDIUM, verified against Transformers.js source)

## Scope

This is a **subsequent-milestone architecture study** for v0.1.6 "fix correlation". The architecture is fixed (background-orchestrator + storage-as-state + React dashboard); this document maps how the four target features integrate into the *existing* structure — what changes, what's new, and the build order that respects dependencies. No stack changes.

---

## Current Architecture (as-is, relevant slice)

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Dashboard (new-tab, React)            Popup (toolbar)                    │
│  App.tsx                              App.tsx                            │
│   ├─ useSnapshot()  ── storage.onChanged ─┐                               │
│   ├─ useCorrelations() ◄─ CORRELATION_PROGRESS / _RESULT broadcasts      │
│   │    ├─ mount: read CONFIG.storage.correlations from storage           │
│   │    ├─ corrInitRef effect: auto runCorrelation() on load  ← (F3)      │
│   │    └─ storage-poll fallback while loading                            │
│   └─ CorrelationPanel (graph + list views)                               │
├──────────────────────────────────────────────────────────────────────────┤
│ Background service worker (orchestrator, EPHEMERAL)                      │
│  index.ts                                                                │
│   ├─ alarms: hourly collect + 10-min alert sweep                         │
│   ├─ TRIGGER_COLLECTION → runCollection()                                │
│   │     └─ runCorrelationPrecompute()  (fire-and-forget, after collect)  │
│   ├─ CORRELATE_ALL → runCorrelationAsync() (fire-and-forget)             │
│   │     ├─ runCorrelationWithEngine()                                    │
│   │     │    ├─ heuristic: correlate/correlateNews/correlateNewsSocial   │
│   │     │    └─ ML: runMLCorrelation() → mlWorker (module singleton)     │
│   │     ├─ write CONFIG.storage.correlations                             │
│   │     ├─ broadcast CORRELATION_RESULT                                  │
│   │     └─ runAlertSweep() + rebuildMarketNewsView()                     │
│   └─ mlWorker manager: mlWorker / mlWorkerResolvers / mlWorkerRequestId  │
│        (single module-level slot — one run at a time, unguarded) ← (F2)  │
├──────────────────────────────────────────────────────────────────────────┤
│ Engines                                                                  │
│  services/engine/correlation.ts   heuristic (NER + keyword, inverted idx)│
│  services/engine/index.ts         InvertedIndex (keyword→item postings)  │
│  services/engine/ml/*             embedding/sentiment/zeroshot/ner/llm   │
│  workers/ml-worker.ts             posts {progress|result|error} to host  │
├──────────────────────────────────────────────────────────────────────────┤
│ Extraction (shared by collectors + engine)                               │
│  utils/keywords.ts    extractKeywords (hashtags/cashtags/words)          │
│  utils/entities.ts    extractEntities (cashtag→bare ticker, aliases)     │
├──────────────────────────────────────────────────────────────────────────┤
│ chrome.storage.local (storage-as-state)                                  │
│  trendcast:correlations ← CorrelationResult (already persisted) ← (F4)   │
│  trendcast:latest-snapshot / collected-* / settings / history / ...      │
└──────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities (relevant slice)

| Component | Responsibility | File |
|-----------|----------------|------|
| `extractKeywords` | Tokenize text → keywords array (stored on items at collect time) | `src/utils/keywords.ts` |
| `extractEntities` | NER: cashtags → ticker entities with **bare** normalized form | `src/utils/entities.ts` |
| `correlate*Pair` | Score signal/news ↔ contract/news pairs (entity + keyword blend) | `src/services/engine/correlation.ts` |
| `InvertedIndex` | Candidate filtering; built from `keywords` + entity keywords | `src/services/engine/index.ts` |
| `runCorrelationAsync` / `runCorrelationPrecompute` | Orchestrate a run, persist result, broadcast, sweep alerts | `src/background/index.ts` |
| ML worker manager | Own the single `Worker`, route progress/result/error via one resolver slot | `src/background/index.ts` |
| `useCorrelations` | Load cached result, run/cancel, track progress, persist run stats | `src/dashboard/hooks/useCorrelations.ts` |

---

## Feature 1 — Ticker/Cashtag Bridging

### Root Cause (verified by code read)

Stock-indicator news items carry keywords like `[amzn, vcp, 2026, stock, indicator]` (bare ticker from `extractKeywords("AMZN — Stock Indicator 2026-08-27 AMZN")`), while social signals carry `$amzn` (cashtag regex `/\$[A-Z]{2,}/` keeps the `$` prefix in `keywords`). Three concrete mismatches:

1. **Keyword mismatch:** `keywordSimilarity` compares `$amzn` vs `amzn` — no overlap.
2. **Entity gap on the news side:** `extractEntities("AMZN — Stock Indicator")` produces **nothing** — the bare-ticker path doesn't exist. Cashtag regex requires `$`; the proper-noun regexes require mixed case (`[A-Z][a-z]+`). So `entSim = 0` (empty map short-circuit in `cachedEntitySimilarity`).
3. **Keyword noise:** stock-indicator items include `2026`, `stock`, `indicator`, `vcp`, `breakout` in keywords, inflating the Jaccard denominator and diluting real matches even when the ticker does bridge.

Note the asymmetry: `extractEntities("$AMZN")` already normalizes to bare `amzn` (entities.ts cashtag handler). The entity layer is half-bridged; the keyword layer is not.

### Recommended Fix Shape: canonical bare-ticker form everywhere

**What:** Canonicalize all ticker-like tokens to the bare lowercase form (`amzn`) at both extraction and comparison time.

| Change | File | New/Modified | Rationale |
|--------|------|--------------|-----------|
| Cashtag extraction adds **bare** form (drop `$`) | `src/utils/keywords.ts` | Modified | Single canonical form; index and Jaccard then bridge naturally |
| Bare all-caps ticker recognition: `KNOWN_TICKERS`-gated `\b[A-Z]{2,6}\b` → ticker entity | `src/utils/entities.ts` | Modified | Gives stock-indicator headlines a ticker entity; KNOWN_TICKERS gating avoids false positives (`USA`, `CEO`, `GDP`) |
| `keywordSimilarity` strips leading `$` from both sides before set ops | `src/utils/keywords.ts` | Modified | **Legacy stored items** (keywords already persisted with `$amzn`) bridge without a data migration |
| Cashtag-boost detection: replace `k.startsWith('$')` with entity-type/ticker-set check | `src/services/engine/correlation.ts` | Modified | Boost logic breaks if keywords lose the `$` prefix |
| Curate stock-indicator item keywords to ticker (+ optional company alias), drop date/screener noise | `src/services/collectors/news.ts` | Modified | Shrinks union sets → higher Jaccard for genuine matches; fewer false candidates in the index |

**Why extraction+comparison (not a stored-data migration):** items in `chrome.storage.local` keep their old keyword arrays until evicted by the merge caps. Re-extraction on read would touch every read path. Canonicalizing inside `keywordSimilarity` (a pure function, already unit-tested) fixes legacy data for free; extraction-time canonicalization fixes all future data and the inverted index (which is built from stored `keywords`).

**Inverted index impact:** none structurally. `candidateKeywords()` already unions `item.keywords` with `extractEntityKeywords(text)`; once entities recognize bare tickers and keywords are bare, postings unify under `amzn`. The `getIncrementalIndex` version hash includes keyword content, so cached indexes rebuild automatically.

**Equivalence guard:** existing `correlation-equivalence.test.ts` / `embedding-equivalence.test.ts` patterns must be extended — bridging *intentionally* changes results (more matches). New tests: `$AMZN` signal ↔ `AMZN` stock-indicator news item must correlate; `keywordSimilarity(['$amzn'], ['amzn']) === 1`; bare non-ticker caps (`NASA`) must not become ticker entities.

---

## Feature 2 — ML Progress UI Fix

### Root Cause (verified by code read)

Three compounding defects, all in the background↔UI progress path:

1. **Single-slot resolver race.** `mlWorker`, `mlWorkerResolvers`, `mlWorkerRequestId` are one module-level slot. `runCorrelationPrecompute` (fires after every collection) and a dashboard-initiated `CORRELATE_ALL` can overlap; the second call **overwrites** `mlWorkerResolvers`, so the first run's result resolves the wrong promise or is dropped. The worker *finishes* (its result reaches storage via whichever run won), but the dashboard's `requestId` never receives `CORRELATION_RESULT` → `loading` stays `true`, progress bar frozen → "stuck even though the worker finished."
2. **Progress is not requestId-scoped in the UI.** `useCorrelations` applies every `CORRELATION_PROGRESS` unconditionally (`setProgress(data.payload)`), while results *are* requestId-filtered. Stale progress from the precompute run paints the active run's bar.
3. **No model-download progress at all.** `createPipelineWithFallback` never passes `progress_callback` to `lib.pipeline(...)`, so the longest phase (first-run model download, 23–30 MB for gte-small) shows only the static "Loading ML model…" spinner. Transformers.js v3 emits a full lifecycle — per-file `initiate` → `progress` (`{progress 0–100, loaded, total, file, name}`) → `done`, aggregate `progress_total` events with a `files` map, and a terminal `ready` event — that is currently discarded. (MEDIUM confidence: verified against transformers.js `main` source; API is stable across v3.x but pin-check 3.7.0 during implementation. Firefox cache-hits emit a single synthetic 100% event — handle that.)

### Recommended Fix Shape

| Change | File | New/Modified |
|--------|------|--------------|
| **Serialize ML runs**: promise-chain queue (or busy-reject) around `runCorrelationWithEngine` ML branch so only one run owns the worker slot at a time | `src/background/index.ts` | Modified |
| **Persist a run-state record** `trendcast:corr-run-state`: `{ requestId, engine, model, phase, current, total, startedAt, status: 'running'\|'done'\|'error' }` — written on start, each progress, and terminal | `src/background/index.ts` + `src/config/index.ts` (new storage key) | New |
| Forward Transformers.js `progress_callback` through `get*Pipeline()` → map to `phase: 'loading-model'`, `current = loaded`, `total = total bytes` | `src/services/engine/ml/transformers.ts`, `ml-worker.ts` | Modified |
| UI: ignore progress whose `requestId ≠ requestIdRef.current`; on mount read run-state from storage to reconstruct/clear state; clear loading on `status: 'done'` even if the broadcast was missed | `src/dashboard/hooks/useCorrelations.ts` | Modified |
| Terminal-state guarantee: `runCorrelationAsync` already writes result + broadcasts on both success and error paths — keep, and make the queue's finally-block always write run-state `done`/`error` | `src/background/index.ts` | Modified |

**Why storage-backed run-state (not just messages):** the MV3 worker is ephemeral and the dashboard tab can mount mid-run or after the broadcast was missed (existing storage-poll fallback covers results, not progress). A persisted run-state record is the single source of truth any tab can reconstruct from — this is the established storage-as-state pattern of the codebase (same shape as `alertState`).

**Data flow after fix:**

```
ml-worker ──progress(requestId)──► background queue owner
    ├─ update run-state in storage (throttled, e.g. ≥250ms)
    ├─ broadcast CORRELATION_PROGRESS {requestId,…}
    └─ (model-download events) phase='loading-model', bytes
Dashboard:
    mount → read run-state → if running && requestId matches → show bar
    live  → apply progress ONLY if requestId === active
    terminal → CORRELATION_RESULT or run-state.status='done' → clear loading
```

---

## Feature 3 — Analysis Trigger Behavior

### Current Behavior (verified)

`App.tsx` `corrInitRef` effect fires `runCorrelation()` on **every** dashboard load once a snapshot with data exists — regardless of whether a stored result is present or fresh. Requirement: no auto-analyze on tab open; analyze only if no analysis exists; re-analyze after collectNow.

### Recommended Fix Shape

| Change | File | New/Modified |
|--------|------|--------------|
| Replace `corrInitRef` effect: on mount, after cached load resolves — if **no stored `CorrelationResult` exists** → send `CORRELATE_ALL` once; else display cached only | `src/dashboard/App.tsx` | Modified |
| After `triggerCollection()` resolves (collectNow), explicitly call `runCorrelation()` (or rely on background precompute — pick **one** owner, see below) | `src/dashboard/hooks/useSnapshot.ts` or `App.tsx` | Modified |
| Extract the decision into a pure, testable helper: `shouldAutoAnalyze({ hasStoredResult, hasData })` | `src/dashboard/hooks/` or `src/utils/` | New |

**Ownership decision (opinionated):** keep the **background as the re-analyze owner** — `runCollection()` already calls `runCorrelationPrecompute` after every collection (alarm path *and* TRIGGER_COLLECTION path, since both go through `runCollection`). The dashboard's collectNow handler then needs **no** extra trigger; it just needs the result to surface, which Feature 4's persistence + existing `CORRELATION_RESULT` broadcast already provide. The dashboard's only trigger responsibility becomes the mount-time "no analysis exists" case. This avoids double-runs (dashboard trigger + background precompute racing — exactly the race Feature 2's queue must then absorb).

**Interaction with Feature 2:** the queue makes any residual concurrency safe (a mount-time analyze racing a precompute serializes instead of corrupting the resolver slot).

---

## Feature 4 — Correlation Result Persistence

### Current State (verified)

Results **are already written** to `CONFIG.storage.correlations` by both `runCorrelationAsync` and `runCorrelationPrecompute`, and `useCorrelations` loads them on mount. The real gaps:

1. **No staleness/existence metadata.** `CorrelationResult` has `requestId?`, `engine?`, `error?` — no `computedAt`, no input counts. "An analysis exists" (Feature 3's check) and "is it stale vs the latest snapshot?" are unanswerable.
2. **Run stats persisted by the wrong layer.** `persistRunStats` lives in the dashboard hook; if the tab closes before `applyResult`, stats are lost, and the background precompute path never records stats at all.
3. **Two write paths** (`runCorrelationAsync`, `runCorrelationPrecompute`) duplicate the persist→broadcast→sweep→rebuild sequence — drift risk (this is exactly how the stuck-progress bug class arose).

### Recommended Fix Shape

| Change | File | New/Modified |
|--------|------|--------------|
| Extend `CorrelationResult`: `computedAt?: number`, `inputCounts?: { markets: number; signals: number; news: number }` (optional → old stored results typecheck; backfill on read) | `src/types/index.ts` | Modified |
| Single persist helper `persistCorrelationResult(result)` in the background: write storage → broadcast → `runAlertSweep()` → `rebuildMarketNewsView()`; both run paths call it | `src/background/index.ts` (or `src/background/correlationPersist.ts` for testability, mirroring the `alerts.ts`/`merge.ts` extraction pattern) | New/Modified |
| Move run-stats persistence into the background persist helper (single writer); dashboard keeps read-only display | `src/background/*`, `src/dashboard/hooks/useCorrelations.ts` | Modified |
| Dashboard staleness display (optional, cheap): compare `computedAt` vs `lastCollectionAt` → "results from previous collection" hint | `CorrelationPanel.tsx` | Modified |

**Storage budget:** `trendcast:correlations` is already in `BUDGET_KEYS` and is *not* pruned (pruner touches history/signals/news/markets only). Adding ~40 bytes of metadata is negligible. The new `trendcast:corr-run-state` key is tiny; add it to `BUDGET_KEYS` for completeness.

---

## Data Flow Changes (summary)

### Flow A: Collection → Correlation → UI (after all fixes)

```
collectNow / hourly alarm
    ↓
runCollection()  ──► snapshot + history + prune
    ↓
runCorrelationPrecompute()  ──► [ML queue: serialized]
    ↓                             ├─ run-state: running (storage)
persistCorrelationResult()         ├─ progress: requestId-scoped broadcast
    ├─ storage.correlations (+computedAt, inputCounts)
    ├─ run-state: done (storage)
    ├─ CORRELATION_RESULT broadcast
    ├─ runAlertSweep()
    └─ rebuildMarketNewsView()
    ↓
Dashboard (any mount time):
    storage.correlations → display (exists? fresh?)
    run-state → reconstruct progress or clear loading
```

### Flow B: Keyword bridging (collect time → match time)

```
Stock-indicator RSS item
    ↓ extractStockSymbols → "AMZN — Stock Indicator 2026-08-27"
extractKeywords → [amzn, …]           (bare, curated)
extractEntities → ticker{amzn, 0.95}  (NEW: bare-caps path)
    ↓ stored on NewsItem.keywords
Social signal "$AMZN ripping"
extractKeywords → [amzn, …]           (NEW: bare, was $amzn)
extractEntities → ticker{amzn}        (unchanged)
    ↓
keywordSimilarity: strip-$ canonical compare → overlap ✓
InvertedIndex: postings unify under 'amzn' → candidate ✓
correlateNewsSocialPair: entSim > 0 → entity threshold path ✓
```

---

## Architectural Patterns to Follow

### Pattern 1: Canonicalization at the extraction boundary
**What:** Normalize decorated forms (`$AMZN`, `AMZN`) to one canonical form where data enters the system; compare only canonical forms.
**When:** Multiple producers (collectors) feed one consumer (correlation/index).
**Trade-offs:** Extraction-time canonicalization keeps the index and matchers dumb; comparison-time canonicalization additionally rescues already-stored legacy data. Do both — they're two lines each.

### Pattern 2: Storage-as-state for cross-context run state
**What:** Persist run lifecycle (`running/done/error` + progress) to `chrome.storage.local`; treat broadcasts as an optimization, storage as truth.
**When:** Any state that must survive ephemeral MV3 workers and arbitrary tab mount timing.
**Trade-offs:** Slightly more writes (throttle progress updates); eliminates an entire class of "UI missed the message" bugs. Matches the existing `alertState` precedent.

### Pattern 3: Single-writer persistence helpers extracted for testability
**What:** One `persistCorrelationResult()` (and one run-state writer) owned by the background; UI reads only.
**When:** Two+ code paths produce the same artifact (async run + precompute).
**Trade-offs:** One more indirection; eliminates the drift that caused this milestone's bugs. Mirrors `merge.ts`/`alerts.ts` extraction precedent (v1.0/v0.1.5 decisions).

### Pattern 4: Serialize access to a singleton resource
**What:** Promise-chain queue around the ML worker slot.
**When:** Module-level singleton (`mlWorker` + resolver) can receive overlapping requests.
**Trade-offs:** A queued run waits (fine — dashboard shows queued state via run-state); alternative (busy-reject) needs UI handling for rejection. Queue is simpler for users.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Fixing bridging in the matcher only
**What people do:** Add `$`-stripping inside `correlatePair`/`correlateNewsPair` ad hoc.
**Why it's wrong:** The inverted index still keys on decorated keywords → candidates never surface → matcher fix never fires. Divergent tokenization also violates the index's "single tokenization source" anti-drift guard.
**Do this instead:** Canonicalize in `keywords.ts`/`entities.ts` (extraction + `keywordSimilarity`), keep matchers untouched.

### Anti-Pattern 2: Migrating stored keywords
**What people do:** One-time rewrite of all stored `NewsItem.keywords`/`SocialSignal.keywords`.
**Why it's wrong:** Large storage rewrite, migration bookkeeping, and unnecessary — comparison-time canonicalization covers legacy rows until natural eviction.
**Do this instead:** Canonical compare; let caps/eviction retire old rows.

### Anti-Pattern 3: Trusting broadcasts for UI state
**What people do:** Rely solely on `CORRELATION_PROGRESS`/`CORRELATION_RESULT` messages.
**Why it's wrong:** Tabs mount mid-run; Firefox message channels drop; worker restarts. Loading state then never clears (this bug).
**Do this instead:** Persist run-state; broadcast is a fast-path hint.

### Anti-Pattern 4: Two owners for "when to analyze"
**What people do:** Dashboard auto-runs on mount *and* background precomputes after collection.
**Why it's wrong:** Duplicate ML runs (minutes of WASM CPU), resolver races, flickering results.
**Do this instead:** Background owns post-collection re-analysis; dashboard owns only the "nothing exists yet" mount case.

---

## Integration Points

### Internal Boundaries

| Boundary | Communication | Change |
|----------|---------------|--------|
| `keywords.ts` ↔ collectors (7 call sites) | `extractKeywords(text)` return shape unchanged | Behavior change only (bare cashtags); no collector edits except stock-indicator keyword curation in `news.ts` |
| `keywords.ts` ↔ `correlation.ts` | `keywordSimilarity(a, b)` | Canonical compare inside; signature unchanged |
| `entities.ts` ↔ `InvertedIndex` / `EntityCache` | `extractEntityKeywords(text)` | New bare-ticker entities flow through unchanged APIs |
| ml-worker ↔ background | `{progress\|result\|error}` posts | Add model-download progress mapping; protocol types extended |
| background ↔ dashboard | `CORRELATION_PROGRESS`/`CORRELATION_RESULT` broadcasts + storage | Add requestId-scoped progress handling + run-state reads |
| background ↔ storage | `CONFIG.storage.*` keys | + `corrRunState` key; `CorrelationResult` gains optional metadata |
| dashboard mount ↔ background | `CORRELATE_ALL` | Trigger condition changes (only when no stored result) |

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Transformers.js 3.7 `progress_callback` | Passed via `pipeline(task, model, { progress_callback })` options in `transformers.ts` | Emits `initiate/download/progress/done` per file + `progress_total` aggregates + terminal `ready`; Firefox cache-hit fires one synthetic 100% event. MEDIUM confidence (verified vs repo `main`; confirm against pinned 3.7.0 at implementation) |
| Hugging Face CDN | unchanged (model downloads) | Download progress now surfaced instead of invisible |

---

## Suggested Build Order (dependency-driven)

```
Phase 1: Ticker/cashtag bridging          (F1)
   keywords.ts + entities.ts + correlation boost fix + news.ts curation
   └─ no deps; unblocks trustworthy correlation results; pure functions, easy tests
Phase 2: Correlation persistence + metadata  (F4)
   CorrelationResult metadata + single persist helper + background-owned run stats
   └─ no deps on F1; defines the storage shapes F3's existence-check reads
Phase 3: ML run orchestration + progress  (F2)
   ML queue + run-state record + progress_callback wiring + UI requestId scoping
   └─ uses F4's storage patterns; must land before trigger changes (safety)
Phase 4: Analysis trigger behavior        (F3)
   corrInitRef replacement + shouldAutoAnalyze helper + collectNow ownership
   └─ depends on F4 (existence check) and F2 (queue makes triggers race-safe)
```

**Rationale:** F1 is isolated and highest user value (correlation actually working). F2 before F4 means the "analyze if none exists" trigger can't corrupt a running precompute; F4 last because it *changes when runs happen* — do it once the run machinery is safe.

**Test seams per phase:** F1 → keyword/entity/correlation equivalence tests (new bridge cases + non-ticker-caps negative). F2 → run-state persistence + queue serialization unit tests (extract queue into a testable module, mirroring `merge.ts`). F3 → `shouldAutoAnalyze` pure-function tests. F4 → trigger decision + persistence metadata tests.

---

## Pitfalls Specific to This Integration

| Pitfall | Mitigation |
|---------|-----------|
| Bare-caps ticker regex over-matching (`ALL`, `IT`, `USA`, `V` — Visa) | Gate on `KNOWN_TICKERS` ∩ length ≥ 2; exclude `KNOWN_LOCATIONS`/stop words; keep confidence below cashtag's 0.95 |
| Stripping `$` breaks `CASHTAG_BOOST` and `signal.text.includes('#'+k)` checks | Rework boost detection to use entity type (`ticker`) or a ticker-set membership check, not keyword prefix |
| `getIncrementalIndex` cache staleness after keyword change | Already handled — version hash includes keyword content; verify with an equivalence test |
| Queue starves interactive runs behind a long precompute (LLM on WASM = minutes) | Run-state exposes `status: 'running'` + engine so UI can show "queued behind precompute"; consider letting an explicit user `CORRELATE_ALL` supersede a *precompute* run (cancel + restart), never vice-versa |
| `CorrelationResult` metadata optional → old stored results lack `computedAt` | Backfill on read (`computedAt ?? 0`); treat missing as "exists but stale" for the F3 check |
| Progress write amplification (per-token/per-file events → storage writes) | Throttle run-state persistence (≥250–500 ms); broadcast every event, persist coarsely |
| Firefox `runtime.sendMessage` to dashboard can be missed while tab backgrounded | Already mitigated for results (storage poll); extend the same pattern to run-state |

---

## Sources

- Codebase (HIGH — read directly): `src/utils/keywords.ts`, `src/utils/entities.ts`, `src/services/engine/correlation.ts`, `src/services/engine/index.ts`, `src/services/engine/ml/{embedding,types,transformers}.ts`, `src/workers/ml-worker.ts`, `src/background/{index,merge,alerts}.ts`, `src/dashboard/App.tsx`, `src/dashboard/hooks/{useCorrelations,useSnapshot}.ts`, `src/services/collectors/news.ts`, `src/config/index.ts`, `src/types/index.ts`, `src/utils/storage.ts`, `src/messaging/index.ts`
- Transformers.js progress_callback lifecycle (MEDIUM — verified against `huggingface/transformers.js` source: `utils/core.js` `ProgressInfo` typedefs, `DefaultProgressCallback`, `pipelines.js` files_loading wiring, `hub.js` initiate/download/progress/done dispatch, Firefox cache-hit synthetic event): https://github.com/huggingface/transformers.js
- Ticker canonicalization practice (MEDIUM — web): canonical bare-ticker entity resolution standard in financial NER; cached in research-store key `360b45d4…`
- Worker progress requestId-scoping + persisted run-state practice (MEDIUM — web): cached keys `aac83fb3…`, `7ef66d85…`

---
*Architecture research for: TrendCast v0.1.6 fix-correlation milestone*
*Researched: 2026-08-27*
