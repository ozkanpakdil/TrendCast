# Stack Research

**Domain:** Browser-extension bugfix/hardening milestone (correlation matching, ML progress UI, analysis triggers, result persistence) for an existing 100% client-side MV3 extension
**Researched:** 2026-08-27
**Confidence:** HIGH

## Executive Verdict

**Zero new runtime dependencies.** All four v0.1.6 capabilities are fixes to existing code paths in the existing stack. Every feature is achievable with TypeScript 5.5 strict + the already-installed libraries. The only "new" surface is a verified API of an existing dependency (`progress_callback` in `@huggingface/transformers` 3.8.1, verified against the installed copy in `node_modules`). Adding any library for these fixes would be overbuilding.

## Recommended Stack

### Core Technologies (unchanged — verified current)

| Technology | Version (installed) | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| TypeScript | ^5.5.4 | All fix logic (ticker normalization, trigger state machine) | Existing; strict mode already enforced via `tsc --noEmit` gate |
| React | ^18.3.1 | Dashboard trigger behavior + progress UI fix | Existing; `useCorrelations` hook and `corrInitRef` effect are the exact edit sites |
| @huggingface/transformers | ^3.7.5 → **3.8.1 installed** | Embedding pipeline + `progress_callback` for model-load progress | Existing dep; 3.8.1's `progress_callback` API verified in `node_modules/@huggingface/transformers/src/utils/hub.js` (see Version Compatibility) |
| webextension-polyfill | ^0.12.0 | `browser.storage.local` persistence of correlation results | Existing; storage-as-state pattern already reads/writes `CONFIG.storage.correlations` |
| Vite + @crxjs/vite-plugin | ^5.4.2 / ^2.0.0-beta.28 | Build; worker bundling for `ml-worker.ts` | Existing; no config changes needed |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none — no additions) | — | — | All four features are pure-TS fixes in existing modules |

### Development Tools (unchanged)

| Tool | Purpose | Notes |
|------|---------|-------|
| Vitest ^2.0.5 | Unit tests for ticker normalization + trigger logic | New pure functions (`normalizeTicker`, trigger predicate) are ideal unit-test targets; follow existing `*.test.ts` colocated pattern |
| Playwright ^1.62.1 | E2E for trigger behavior + persistence across reload | Existing `tests/e2e/dashboard.spec.ts` extends; note known gap: e2e asserts 9 tabs vs app's 11 |
| Bun 1.4 | Package manager + script runner | **Mandatory** — never npm/npx (project constraint) |

## Feature-by-Feature Stack Mapping

### 1. Ticker/cashtag bridging — pure TypeScript, no deps

**Edit sites (all existing):**
- `src/utils/keywords.ts` — `extractKeywords()` cashtag regex `\$[A-Z]{2,}` requires the literal `$` prefix; stock-indicator keywords arrive as bare tickers (`amzn`, `vcp`). Add a canonicalization step: strip `$`/`#`, lowercase → `amzn` matches `$AMZN`.
- `src/utils/entities.ts` — `extractEntities()` already has `KNOWN_TICKERS` set + cashtag regex `\$([A-Z]{1,6})\b`; reuse the same canonical form so entity and keyword paths agree.
- `src/services/engine/correlation.ts` — `candidateKeywords()` feeds the inverted index; canonicalized keywords flow through automatically once extraction is fixed.

**Recommended approach:** a single `normalizeTicker(token: string): string` helper (strip leading `$`, lowercase, uppercase-length guard) applied at extraction time in both keyword and entity paths — NOT at match time. Normalizing at extraction keeps the inverted index (`PERF-02`) correct without re-touching match scoring. Equivalence tests (existing `correlation-equivalence.test.ts` pattern) must prove no result drift for already-matching pairs.

**Why not a ticker-mapping library (e.g. stock-symbol dictionaries):** the bridge is form-normalization (`$AMZN` ↔ `amzn`), not symbol resolution. A company-name→ticker mapping adds ~100 KB+ of data for marginal gain and risks false positives (e.g. "A" for Agilent). The existing `KNOWN_TICKERS` curated set suffices for confidence boosting.

### 2. ML progress UI fix — wire existing `progress_callback`, no deps

**Root cause (verified in code):** `createPipelineWithFallback()` in `src/services/engine/ml/transformers.ts` calls `lib.pipeline(task, model, options)` **without** `progress_callback`, so model-download/load progress never reaches the worker → background → dashboard. The dashboard's progress bar only updates on batch-level `onProgress` callbacks (`embedding-contracts`, etc.), which fire *after* the pipeline resolves — so during model load the UI shows a stale/stuck bar.

**Fix using the verified 3.8.1 API:**
- Pass `progress_callback` through `PretrainedModelOptions` in `createPipelineWithFallback()`.
- Event shape (verified in `node_modules/@huggingface/transformers/src/utils/hub.js`): `{ status: 'initiate' | 'download' | 'progress' | 'done', name, file, progress?, loaded?, total? }`. There is **no** `'ready'` status — treat the pipeline promise resolving as load-complete.
- Map download events to a new phase (e.g. `loading-model` with `current = loaded`, `total = total`, aggregated across files) and forward through the existing worker `progress` message → `CORRELATION_PROGRESS` broadcast → `useCorrelations` state. The plumbing already exists end-to-end; only the pipeline-construction hop is missing.
- Also emit a terminal progress event when batch loops complete with zero uncached texts (all-cached case currently reports nothing), so the bar never appears stuck at 0.

### 3. Analysis trigger behavior — pure logic, no deps

**Edit site:** `src/dashboard/App.tsx` `corrInitRef` effect (currently auto-runs `runCorrelation` on every dashboard open when a snapshot exists).

**Fix:** gate on stored correlation state — read `CONFIG.storage.correlations` (already loaded by `useCorrelations` on mount); auto-analyze only when no stored result exists. Re-analyze after `triggerCollection()` (collectNow) completes — the existing `useSnapshot` hook exposes `lastCollectionAt`; key the re-run off its change. No state library; a `useRef` + effect-dependency change suffices. Unit-test the predicate as a pure function (`shouldAutoAnalyze(hasStoredResult, lastCollectionAt, prevLastCollectionAt)`).

### 4. Correlation result persistence — existing storage layer, no deps

**Current state (verified):** the background already writes results to `CONFIG.storage.correlations` (`runCorrelationAsync` in `src/background/index.ts`), and `useCorrelations` already loads that key on mount. Persistence largely works; the gaps are (a) `requestId` gating can discard a stored result whose requestId doesn't match the (absent) active request on a fresh mount, and (b) the storage-polling fallback only runs while `loading` is true.

**Fix:** on mount, accept a stored result when there is no active `requestIdRef.current` (already partially handled — tighten the stale-result check in `applyResult`); keep the result keyed in `BUDGET_KEYS` (already present in `src/utils/storage.ts`) so budget pruning accounts for it. No new storage abstraction — the storage-as-state pattern and `SettingsStorage`-style narrow-interface test pattern (from SRC-05) apply if a persistence helper is extracted.

## Installation

```bash
# No new packages. Existing stack only. If lockfile drift is suspected:
bun install
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Canonical-form ticker normalization at extraction time | Fuzzy string matching (e.g. Levenshtein/`fuse.js`) for ticker bridging | Never for this fix — tickers are exact tokens; fuzzy matching would create false correlations between similar tickers |
| Wire `progress_callback` from the existing transformers lib | Poll `browser.storage.local` byte deltas to infer model download | Never — the callback API is first-class in 3.8.1 and already plumbed to the UI |
| Company-name→ticker map in `KNOWN_TICKERS` (curated, tiny) | Full symbol dictionary package (e.g. `stock-ticker-symbol`) | Only if users report missed matches on obscure tickers; defer — adds bundle weight to a 7 MB-budget extension |
| Gate auto-analyze on stored-result presence (pure TS predicate) | State machine library (xstate) for trigger logic | Never — a two-state predicate; a library is overbuilding |
| Reuse `CONFIG.storage.correlations` key | New dedicated persistence key with versioning | Only if correlation schema changes shape in a future milestone and old results must coexist; not needed now |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Any new runtime dependency for these four fixes | All are fixes to existing code paths; deps add audit surface to a privacy-focused extension | Existing TS modules + existing libs |
| npm/npx for any install or script | Hard project constraint | Bun only (`bun install`, `bun run test`) |
| Fuzzy matching libraries for ticker bridging | Ticker forms are exact (`$AMZN` vs `amzn`); fuzziness produces wrong correlations in a decision-aid product | Deterministic `normalizeTicker()` + existing Jaccard similarity |
| `localStorage` / `IndexedDB` for correlation persistence | Not shared with the MV3 service worker; breaks the storage-as-state architecture and budget pruning | `browser.storage.local` via existing `CONFIG.storage.correlations` key |
| A separate "analysis state" store (zustand/redux) | Trigger logic is one effect + one predicate; React state + refs already in place | `useRef`/`useState` in `App.tsx` + pure predicate function |
| Upgrading React/Vite/TypeScript in this milestone | Milestone is fix-scoped; upgrades risk regressions across 357 unit + 137 e2e tests | Keep pinned versions; upgrades belong to a dedicated milestone |

## Stack Patterns by Variant

**If the ML progress bar must show per-file download detail:**
- Aggregate `progress_callback` events by `file` into a single `loaded/total` sum before posting one worker `progress` message per tick — because the worker→background→dashboard channel is message-per-progress and per-file events fire many times per second.
- Because: unfiltered forwarding floods the message channel (observed pattern: `CORRELATION_PROGRESS` broadcast per event) and makes the bar jitter.

**If Firefox shows no download progress at all:**
- Accept it — verified in installed `hub.js`: Firefox cache hits skip streaming progress and fire a single synthetic `progress: 100` event (Firefox bug workaround in the library itself). The UI must treat a jump from 0→100 as valid, not stuck.
- Because: this is library-intended behavior, not a TrendCast bug.

**If stored correlation results grow the storage budget:**
- `CONFIG.storage.correlations` is already in `BUDGET_KEYS` (pruning order: history → signals → news → markets); do not add a second unbounded key for run history — `correlationRunHistory` is already capped at `MAX_RUN_HISTORY = 50`.
- Because: PERF-03's `getBytesInUse()` authority only sees keys it tracks.

**If auto-analyze must also fire after background alarm-driven collection:**
- Keep the trigger in the dashboard (UI-driven) for this milestone; background pre-compute after collection already exists (`preComputeCorrelations` path). Adding an alarm-triggered analyze duplicates the existing pre-compute path.
- Because: the dashboard gate ("analyze only if no analysis exists") is a UI concern; the background already self-heals via `corrInitRef` on load.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| @huggingface/transformers 3.8.1 (installed; package.json `^3.7.5`) | progress_callback API | **Verified against installed copy**: `hub.js` emits `initiate`/`download`/`progress`/`done` with `{name, file, progress?, loaded?, total?}`; `models.js` forwards `progress_callback` (lines 1111/1125). No `'ready'` status exists. API is stable across 3.7→3.8. |
| @huggingface/transformers 3.8.1 | Firefox cache progress | Firefox cache hits emit a single synthetic 100% progress event (library workaround for a Firefox bug) — do not build UI logic assuming smooth per-file progress on Firefox. |
| webextension-polyfill 0.12.0 | chrome.storage.local in MV3 SW + dashboard | Existing persistence path; `onChanged` listener pattern already used in `App.tsx` for social health — reuse for correlation-result reactivity if needed. |
| Vitest 2.0.5 | Pure-function tests for `normalizeTicker` / trigger predicate | Colocated `*.test.ts` pattern; no config change. |
| TypeScript 5.5 strict | All new helpers | `tsc --noEmit` gate runs in every build script — new code must pass strict mode. |

## Sources

- `node_modules/@huggingface/transformers@3.8.1/src/utils/hub.js` — progress_callback event lifecycle (`initiate`/`download`/`progress`/`done`), Firefox cache-progress workaround — **HIGH** (installed source of truth)
- `node_modules/@huggingface/transformers@3.8.1/src/models.js` — `progress_callback` forwarding into model construction — **HIGH**
- Hugging Face Transformers.js official docs (pipelines API, dtype/device options) — **MEDIUM** (context7 provider)
- TrendCast source: `src/utils/keywords.ts`, `src/utils/entities.ts`, `src/services/engine/correlation.ts`, `src/services/engine/ml/transformers.ts`, `src/services/engine/ml/embedding.ts`, `src/workers/ml-worker.ts`, `src/background/index.ts`, `src/dashboard/hooks/useCorrelations.ts`, `src/dashboard/App.tsx`, `src/utils/storage.ts`, `src/config/index.ts` — **HIGH** (direct code inspection)
- `.planning/PROJECT.md` — milestone context, constraints, prior decisions — **HIGH**

---
*Stack research for: TrendCast v0.1.6 fix correlation*
*Researched: 2026-08-27*
