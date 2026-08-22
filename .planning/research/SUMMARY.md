# Project Research Summary

**Project:** TrendCast — Milestone v1.0 (Speed, Alerts & New Data)
**Domain:** Prediction-market correlation browser extension (Manifest V3, Chrome + Firefox, 100% client-side)
**Researched:** 2026-08-22
**Confidence:** HIGH

## Executive Summary

TrendCast is a 100% client-side MV3 browser extension that correlates social sentiment, news, and prediction-market odds to answer "what's moving and why." Experts build this as a **background-orchestrator + storage-as-state + React-UI** extension: the background service worker orchestrates collection and correlation, `chrome.storage.local` is the source of truth, and the dashboard/popup read snapshots and send typed messages. This milestone adds **speed, alerts, and new data** on top of a proven, working system — the research is unanimous that we must **not re-architect** the existing stack (TypeScript 5.5 strict, React 18, Vite 5 + @crxjs, Tailwind 3, @huggingface/transformers 3.7, Vitest, Playwright, Bun).

The recommended approach is a **dependency-light hardening milestone**: add **zero new runtime dependencies**. The four flagship capabilities — inverted-index correlation speedup, deduped/throttled/watchlist-scoped correlation alerts, a market-driven news view, and a TikTok collector — are all implementable with the existing stack plus platform APIs (`chrome.notifications`, `chrome.alarms`, `chrome.storage.local`, DOM scraping). The single highest-leverage change is the **inverted keyword→contract index**, which collapses the O(n×m) correlation loop into near-linear candidate filtering and *enables* both faster alerts and a faster market-driven view. The only manifest change is adding the `notifications` permission.

The key risks are all **"looks done but isn't"** failure modes: alert fatigue from un-deduped notifications, silent alert failure from a missing `iconUrl`/permission check, category-taxonomy drift, TikTok breaking the whole collection pipeline, and an inverted index that silently changes correlation results. Every one is preventable with a specific guard (dedup+throttle+watchlist scope, `getPermissionLevel()` + packaged icon, single-source taxonomy, hard timeout + isolation, golden-test equivalence). The research flags TikTok collection as the only MEDIUM-confidence area — it has no public API and needs phase-specific feasibility research.

## Key Findings

### Recommended Stack

The existing stack is **unchanged** — this milestone adds zero new runtime dependencies. The only "installation" change is adding `'notifications'` to the `permissions` array in `src/manifest.config.ts` (triggers a one-time permission prompt, expected for alerts).

**Core technologies:**
- `chrome.notifications` (via `webextension-polyfill`): correlation alerts — the ONLY notification API that works from an MV3 background service worker; cross-browser via the existing polyfill; use `basic`/`list` templates (avoid deprecated `image`).
- `@huggingface/transformers` 3.7.x `device:'webgpu'` + `dtype`: ML acceleration — extend the existing LLM WebGPU-detection + WASM-fallback pattern (`llm.ts` lines 256–287) to embedding/sentiment/zero-shot/NER pipelines. **Do NOT upgrade to v4.x** (breaking major).
- Hand-rolled `Map`-based inverted keyword→contract index: correlation speedup — generalize the zero-shot engine's `findCandidateContracts` into a shared `Map<keyword, contractId[]>`; dependency-free, trivially testable.
- `chrome.storage.local` (keep) + per-key caps + incremental byte estimation: storage hardening — fix `estimateBytes` (re-serializes the whole store via `Blob` on every check); use `getBytesInUse()` as the authoritative budget. Do NOT migrate to IndexedDB at this scale.
- TikTok DOM scraping (content script): TikTok collection — no official key-free API; the manifest already has `*://tiktok.com/*` host perms; the gap is a missing collector function + barrel export. Best-effort with graceful degradation.
- Category taxonomy (reuse `redditCategories`): market-driven news view — reuse the existing finance/crypto/economics/sports/entertainment/technology/politics taxonomy; no new dep.

**Deferred stack:** `flexsearch` (only if fuzzy news matching needed), `idb` (only if data exceeds ~10 MB quota), `onnxruntime-web` explicit pin (already transitive). All deferred — not needed this milestone.

### Expected Features

**Must have (table stakes):**
- Correlation alerts that don't spam — dedupe + throttle + watchlist-scoping are the *minimum* for usability, not polish.
- Watchlist-scoped alerting — alert only on watchlisted markets; the highest-value, lowest-fatigue model.
- Direction-aware alerts (bullish/bearish) — derived from signal sentiment + Yes-price delta.
- Watchlist sort/filter/correlation status — organize tracked markets and see movement at a glance.
- Export coverage for new sources — keep export complete as TikTok + market-driven data grow.

**Should have (competitive):**
- **"Market-driven news" view** (flagship differentiator) — flip the correlation: important markets → their news → directional implication. Scoped to 3 categories (finance, politics, tech) for v1.
- **Correlation alerts with direction** — "market X is moving up and the news is bullish."
- **TikTok collector** — novel social signal; high value but high fragility.
- **Inverted-index correlation speedup** — collapses O(n×m) to near-linear; enables alerts + market-driven view.
- **Category coverage** — organize the market-driven view by category.

**Defer (v2+):**
- Full category taxonomy (sports, entertainment, crypto, economics) — expand beyond 3 categories.
- WebGPU-accelerated ML — only when the user opts into large models.
- Manual "refresh now" + configurable interval — nice-to-have control.

### Architecture Approach

Evolve the existing **background-orchestrator + storage-as-state + React-UI** pattern without abandoning it. Split the 883-line `src/background/index.ts` into focused modules (`correlation.ts`, `alerts.ts`, `correlationNews.ts`); add a shared `services/engine/index.ts` inverted index; add `services/collectors/tiktok.ts` following the one-file-per-platform convention; implement the empty `src/content/socials/index.ts` for TikTok DOM scraping; add `MarketDrivenNews.tsx` + `useAlerts.ts` to the dashboard.

**Major components:**
1. **Inverted keyword→contract index** (`services/engine/index.ts`) — shared candidate pre-filtering for heuristic AND ML correlation paths; single tokenization source.
2. **Alert engine** (`background/alerts.ts`) — runs after correlation, reads persisted `alertState`, dedupes, dispatches `chrome.notifications`; ephemeral-worker-safe via alarms + storage, not timers.
3. **Market-driven news aggregator** (`background/correlationNews.ts`) — read-only derived projection over markets + news + correlations; no new collection.
4. **TikTok collector** (`services/collectors/tiktok.ts` + `content/socials/index.ts`) — content-script-driven DOM scraping reported via `REPORT_SOCIAL_DATA`; thin background normaliser.
5. **Storage budget** (`utils/storage.ts`) — `getBytesInUse()` as authority + per-key caps + incremental byte deltas.

### Critical Pitfalls

1. **Correlation alerts fire on every match → notification fatigue + storage bloat** — dedupe by stable key (contract+signal+time-bucket), throttle (global + per-market cooldown), watchlist-scope, cap alert history (~100), direction-aware. Design in from the first alert, not retrofitted.
2. **Notification permission denied / `iconUrl` missing → silent alert failure** — always pass a packaged `iconUrl` (remote URLs blocked in MV3), check `getPermissionLevel()` and fall back to an in-dashboard badge, declare `notifications` permission, test on BOTH Chrome and Firefox.
3. **"Market-driven news" category taxonomy drifts → inconsistent classification** — define the taxonomy once in a single module with deterministic precedence (politics > finance > tech), persist category on the NewsItem at collection time, version the taxonomy, scope v1 to 3 categories.
4. **TikTok collector breaks the whole pipeline → no graceful degradation** — hard timeout (5s), isolate as an optional step, best-effort contract (never degrade BBC/CNN/Polymarket/Kalshi), document ToS risk, manual URL-paste fallback.
5. **Inverted index returns wrong results (or is never built) → correlation regresses** — single tokenization source shared by index + matcher, incremental index (cache by data version), apply to ALL paths (heuristic AND ML), golden-test equivalence vs the naive loop, keep naive fallback for tiny inputs.
6. **Per-key storage caps + incremental byte estimation break the budget model** — use `chrome.storage.local.getBytesInUse()` as the authoritative total (cheap + exact), enforce per-key max item count + byte estimate at write time, track running byte deltas, account for UTF-16 serialization, test sustained collection stays under the 7 MB budget.
7. **ML quantization / WebGPU breaks the WASM fallback (or regresses quality)** — device-detection + fallback chain (WebGPU → WASM), use `get_available_dtypes()` with a `["q4","q8","fp16","fp32"]` chain, golden-test quantized vs fp32 correlation equivalence, keep the worker WASM path working, stay on v3.7.x.
8. **Watchlist/export improvements break existing data or regress the dashboard** — schema migration (version field + backfill on read), backward-compatible export (append sections, don't change columns), keep export complete for all sources, preserve virtualization (`VirtualizedGrid`), test against old-format stored data.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Correlation Speedup (Inverted Index)
**Rationale:** The inverted index is the highest-leverage change and a hard dependency for both alerts and the market-driven view — faster correlation means alerts fire promptly and the view renders quickly. It's a pure optimization with no new deps, so it de-risks everything downstream.
**Delivers:** O(n×m) → near-linear candidate-filtered correlation across heuristic AND ML paths.
**Addresses:** Inverted-index correlation speedup (P1).
**Avoids:** Pitfall 5 (index drift) — golden-test equivalence vs the naive loop; single tokenization source; incremental index.

### Phase 2: Correlation Alerts
**Rationale:** The core "surface what's moving" value. Depends on the speedup (Phase 1) and the existing correlation engine. Requires the `notifications` permission + `chrome.alarms` + persisted `alertState`.
**Delivers:** Deduped, throttled, watchlist-scoped, direction-aware `chrome.notifications` alerts with an in-dashboard fallback.
**Addresses:** Correlation alerts (P1), watchlist-scoped alerting, direction-aware alerts.
**Avoids:** Pitfalls 1 (fatigue) and 2 (silent failure) — dedup/throttle/scope from day one; `iconUrl` + `getPermissionLevel()` + packaged icon.

### Phase 3: Market-Driven News View
**Rationale:** The flagship differentiator. Depends on the speedup (Phase 1) and the correlation engine's `newsMatches`/`newsSocialMatches` outputs. Reuses the `redditCategories` taxonomy.
**Delivers:** A read-only derived view: notable markets → correlated news → directional implication, scoped to 3 categories (finance, politics, tech).
**Addresses:** Market-driven news view (P1), category coverage.
**Avoids:** Pitfall 3 (taxonomy drift) — single-source taxonomy module with deterministic precedence, category persisted at collection time.

### Phase 4: Watchlist Improvements + Export Coverage
**Rationale:** Enhances alerts and daily use; keeps export complete as sources grow. Low cost, high daily value.
**Delivers:** Watchlist sort/filter/correlation-status badges; export extended for TikTok + market-driven categories (backward-compatible).
**Addresses:** Watchlist improvements (P2), export coverage (P2).
**Avoids:** Pitfall 8 (schema drift / dashboard regression) — schema migration, backward-compatible export, preserve virtualization.

### Phase 5: TikTok Collector
**Rationale:** Novel social signal — a differentiator, not a table stake. Ship after the core is stable because it's the most fragile source.
**Delivers:** Best-effort content-script-driven TikTok discover-page scraping → `SocialSignal`s, isolated with a hard timeout and graceful degradation.
**Addresses:** TikTok collector (P2).
**Avoids:** Pitfall 4 (pipeline break) — hard timeout, isolation, best-effort contract, ToS documentation, manual fallback.

### Phase 6: Storage Caps + ML Quantization/WebGPU (Hardening)
**Rationale:** Bounds the budget and accelerates ML — the two remaining hardening items. Storage caps are a prerequisite for adding more data sources later.
**Delivers:** Per-key caps + `getBytesInUse()`-authoritative budget; WebGPU→WASM fallback chain for ML pipelines.
**Addresses:** Storage caps, WebGPU ML acceleration (P3).
**Avoids:** Pitfalls 6 (budget model) and 7 (quantization/WebGPU fallback).

### Phase Ordering Rationale

- **Speed first:** The inverted index is a pure optimization with no dependencies and enables both flagship features — it must precede alerts and the market-driven view.
- **Alerts before market-driven view:** Alerts are the core "surface what's moving" value and are lower complexity than the flagship view; the view's aggregation reuses the same correlation outputs.
- **Low-cost wins before fragile sources:** Watchlist/export (LOW cost) ship before TikTok (HIGH cost, HIGH fragility) so the milestone delivers stable value before risking the fragile collector.
- **Hardening last:** Storage caps + ML quantization are the final hardening pass that bounds the budget and quality before the milestone closes.
- **Pitfall-driven grouping:** Each phase pairs with the specific pitfall it must avoid (fatigue, silent failure, taxonomy drift, pipeline break, index drift, budget, quantization, schema) — the research maps each pitfall to its prevention phase.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 5 (TikTok collector):** MEDIUM confidence — no public API, hostile to scraping; needs phase-specific feasibility research on DOM selectors, anti-bot behavior, and ToS risk.
- **Phase 6 (ML quantization/WebGPU):** MEDIUM — WebGPU support is flag-gated in Firefox; needs verification of the WASM fallback chain and golden-test equivalence.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Correlation speedup):** Well-documented pattern (inverted index); the zero-shot engine already proves it via `findCandidateContracts`.
- **Phase 2 (Correlation alerts):** `chrome.notifications` + `chrome.alarms` are well-documented platform APIs.
- **Phase 3 (Market-driven news):** Reuses existing correlation outputs + taxonomy; standard derived-view pattern.
- **Phase 4 (Watchlist/export):** Standard React dashboard + export extension; established patterns.
- **Phase 6 (Storage caps):** `getBytesInUse()` is a documented, exact API.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified against official Chrome/MDN/Hugging Face docs + live npm registry + codebase inspection. |
| Features | HIGH | Grounded in PROJECT.md requirements, competitor analysis, and codebase concerns. |
| Architecture | HIGH | Based on existing codebase patterns (zero-shot index, collector convention, worker protocol). |
| Pitfalls | HIGH | Each pitfall tied to a specific codebase location + official API contract. |

**Overall confidence:** HIGH

### Gaps to Address

- **TikTok feasibility (MEDIUM):** No public API; the DOM-scraping approach needs phase-specific validation of selectors, anti-bot behavior, and ToS risk. Flag for `/gsd-plan-phase --research-phase` during Phase 5.
- **WebGPU on Firefox (MEDIUM):** Flag-gated; the WASM fallback chain must be verified on both browsers. Flag for research during Phase 6.
- **Storage budget calibration:** `estimateBytes` (UTF-8) diverges from `chrome.storage.local` (UTF-16); the budget must be calibrated against real `getBytesInUse()` readings during Phase 6.
- **Schema migration scope:** Exact fields added to `WatchlistEntry`/`NewsItem` and the migration strategy need definition during Phase 4 planning.
- **Transformers v4.x upgrade:** Explicitly deferred; a dedicated upgrade milestone should be planned separately, not within this hardening milestone.

## Sources

### Primary (HIGH confidence)
- Chrome `chrome.notifications` API reference — permission, templates, methods, events.
- MDN Notifications API / `Notification` — `Notification()` not available in service workers; `requestPermission` requires user gesture.
- Hugging Face Transformers.js WebGPU guide — `device: 'webgpu'` usage and Firefox flag-gating.
- Chrome "Storage and cookies" — `chrome.storage.local` quota, `unlimitedStorage`, IndexedDB in workers.
- MDN IndexedDB API — large structured data + indexes, available in workers.
- npm registry (live) — current versions: `@huggingface/transformers` 4.2.0, `onnxruntime-web` 1.27.0, `webextension-polyfill` 0.12.0, `idb` 8.0.3, `flexsearch` 0.8.212.
- Codebase verification — `llm.ts` (WebGPU+fallback), `transformers.ts` (pipelines), `zeroshot.ts` (`findCandidateContracts`), `storage.ts` (`estimateBytes`), `manifest.config.ts` (TikTok perms), `config/index.ts` (`redditCategories`), `correlation.ts` (O(n×m)), `ml-worker.ts` (WASM path), `news.ts` (`Promise.allSettled`), `background/index.ts` (ephemeral worker), `Watchlist.tsx`, `export.ts`.
- Competitor analysis — Polymarket, Kalshi, Manifold, Metaculus, Bloomberg Terminal, Reuters, TradingView, Benzinga, Seeking Alpha.

### Secondary (MEDIUM confidence)
- TikTok collection approach — no official key-free API; realistic client-side paths are DOM scraping and public RSS proxies. Needs phase-specific feasibility research.

### Tertiary (LOW confidence)
- None — all findings trace to official docs, codebase inspection, or live registry data.

---
*Research completed: 2026-08-22*
*Ready for roadmap: yes*
