# Project Research Summary

**Project:** TrendCast
**Domain:** Client-side prediction-market correlation browser extension (MV3, Chrome + Firefox)
**Researched:** 2026-08-22
**Confidence:** HIGH

## Executive Summary

TrendCast is a mature, working 100% client-side Manifest V3 browser extension that collects social sentiment (X, Reddit, TikTok), news headlines (BBC, CNN, Yahoo, Google News, Seeking Alpha, Investing.com), and prediction-market odds (Polymarket, Kalshi), then correlates them to surface which markets are being driven by real-world discussion. Experts build this class of tool as a **background-orchestrator + storage-as-state + React-UI** MV3 extension: the background service worker orchestrates collection and correlation, `chrome.storage.local` is the single source of truth, and the dashboard/popup read snapshots and send typed messages. The research is unanimous that the existing architecture is sound and should be **evolved, not re-architected** — the milestone is about hardening and adding new capabilities on top of the proven pattern.

The recommended approach is a **dependency-ordered hardening sequence**: (1) fix the silent Seeking Alpha/Investing source failure and establish storage/worker reliability foundations, (2) fix the O(n×m) correlation bottleneck with a hand-rolled inverted keyword→contract index, (3) add the flagship "market-driven news" view and deduped/throttled correlation alerts, then (4) add the fragile TikTok collector and more sources as best-effort differentiators. The single highest-leverage change is the inverted index — it collapses the quadratic correlation loop into near-linear candidate filtering and enables every downstream feature (faster alerts, faster market-driven view). The milestone should add **zero or one** new runtime dependency; everything is implementable with the existing stack plus platform APIs.

The key risks, all with clear mitigations: MV3 service-worker ephemerality silently killing collection (persist all state to storage, use `chrome.alarms`, design idempotent resumable batches); unbounded data accumulation hitting the 10 MB quota (retention budget + per-key caps + `getBytesInUse()`); paywalled sources silently dropping out of correlations (fallback sources + freshness validation + decouple "fetched" from "correlated"); and client-side ML model size/latency (quantize q8/q4, small models, WebGPU with WASM fallback). TikTok is the highest-fragility item and must be scoped as an optional, failure-bounded collector, never a core dependency.

## Key Findings

### Recommended Stack

The existing stack is **unchanged** and correct: TypeScript 5.5 strict, React 18, Vite 5 + @crxjs/vite-plugin, Tailwind 3, @huggingface/transformers 3.7, Vitest, Playwright, Bun. All new capabilities are implementable with the existing stack plus platform APIs. The milestone should add **zero or one** new runtime dependency — adding dependencies to a hardening milestone is an anti-pattern.

**Core technologies:**
- `chrome.notifications` (via `webextension-polyfill`): correlation alerts — the ONLY notification API that works from an MV3 background service worker; requires the `notifications` permission; cross-browser via the existing polyfill.
- `@huggingface/transformers` 3.7.x with `device: 'webgpu'`: faster client-side ML inference — must keep WASM fallback (WebGPU is flag-gated in Firefox); do NOT upgrade to v4.x (breaking major).
- Hand-rolled `Map`-based inverted index: correlation speedup (O(n×m) → candidate filtering) — dependency-free, trivially testable, exactly fits the "only compare candidates sharing keywords" pattern.
- `chrome.storage.local` (keep): storage-as-state — the ~7 MB soft budget is well under the ~10 MB quota; do NOT migrate to IndexedDB at this scale.
- `idb` 8.0.3: IndexedDB wrapper — **defer**, only if a future feature exceeds the storage quota.
- `flexsearch` 0.8.212: fuzzy/full-text search — **only if** the market-driven news view needs typo-tolerant matching; for exact keyword matching the hand-rolled `Map` is simpler and faster.

### Expected Features

The #1 table stake is **data reliability** — a correlation tool that silently drops sources (the current Seeking Alpha/Investing bug) is broken, not "missing a feature." The flagship differentiator is the **"market-driven news" view** (flip the correlation: show important markets → the news/direction they imply), which is the user's stated vision.

**Must have (table stakes):**
- Fix Seeking Alpha/Investing reliability — a correlation tool is worthless if sources silently fail
- Source health / staleness indicators — users need to know when a source is down or stale
- Correlation speed (inverted index) — the "make it faster" ask; enables everything else
- Correlation alerts (deduped + throttled, watchlist-scoped) — the core "surface what's moving" value
- "Market-driven news" view (v1: finance + politics + tech) — the flagship differentiator, scoped to 3 categories

**Should have (competitive):**
- TikTok collector — novel social signal, but high fragility; ship after core is stable
- More data sources — only after per-key storage caps are in place
- Watchlist improvements (sort/filter/correlation) — enhances alerts
- Export coverage for new sources — keep export complete

**Defer (v2+):**
- Full category taxonomy (sports, entertainment, crypto, economics) — expand beyond 3 categories
- WebGPU-accelerated ML — only when the user opts into large models
- Manual "refresh now" + configurable interval — nice-to-have control

**Anti-features to avoid:** real-time/sub-minute polling (MV3 alarm floor is 30s), cloud sync/backend (violates hard constraint), auto-trading (dangerous/out of scope), paywall bypass (legal risk), cross-device push (impossible without backend), alerting on every correlation (fatigue), building own prediction market (out of scope), monetization/ads (out of scope), huge LLMs by default (1.5 GB downloads regress the "fast enough to trust daily" value).

### Architecture Approach

The architecture is a **background-orchestrator + storage-as-state + React-UI** MV3 extension. The background service worker is the single orchestrator; `chrome.storage.local` is the source of truth; the dashboard/popup read snapshots and send typed messages. The research recommends evolving this pattern by splitting the 883-line `background/index.ts` into focused modules and adding a shared inverted index.

**Major components:**
1. Background worker (`src/background/`) — orchestrates collection, correlation, alerts, storage; split into `index.ts`, `correlation.ts`, `alerts.ts`, `correlationNews.ts`
2. Correlation engine (`src/services/engine/`) — candidate-filtered matching; new `index.ts` for the shared keyword→contract inverted index
3. Alert engine (`src/background/alerts.ts`) — detects strong/new correlations, dedupes, dispatches `chrome.notifications`
4. Market-driven news (`src/background/correlationNews.ts`) — aggregates markets → correlated news → directional implication
5. Collectors (`src/services/collectors/`) — one file per platform; new `tiktok.ts` is content-script-driven (no public API)
6. ML Web Worker (`src/workers/ml-worker.ts`) — runs inference off the main thread
7. Dashboard (`src/dashboard/`) — new-tab React app; new `MarketDrivenNews.tsx` component

**Key patterns:** (1) inverted keyword→contract index for candidate pre-filtering (the highest-leverage change); (2) batching + shared result cache across correlation passes; (3) ephemeral-worker-safe alert detection (alarms + storage, not timers); (4) market-driven news as a read-only derived projection over existing data; (5) collector adapter for TikTok (content-script DOM scraping, thin background normalizer).

### Critical Pitfalls

1. **MV3 service worker ephemerality kills long-running collection** — worker dies after ~30s idle; treat it as stateless and restartable, persist all state to storage, use `chrome.alarms`, design idempotent resumable batches. Address in Phase 1.
2. **Unbounded data accumulation vs. the 10 MB storage quota** — establish a retention budget (7 MB soft / 9 MB hard), use `getBytesInUse()` not re-serialization, cap items per collection, dedupe by URL/id. Address in Phase 1.
3. **O(n×m) correlation loops that freeze the UI** — build an inverted index, precompute/cache tokenized lexicons, move heavy compute to a worker, add a complexity guard. Address in Phase 2.
4. **Paywalled/low-yield news sources silently drop out** — don't rely on a single aggregator; add direct source fallbacks; add freshness validation; decouple "fetched" from "correlated." Address in Phase 1.
5. **Client-side ML model size and WASM inference latency** — prefer quantized models (q8/q4), choose small models, detect device capability at runtime (WebGPU with WASM fallback), cache/lazy-load, set a download size budget. Address in Phase 3.
6. **TikTok collection without a backend is fragile and possibly non-compliant** — scope as best-effort optional, use public surfaces, wrap in a resilience boundary, document ToS risk, add a manual fallback. Address in Phase 4.
7. **MV3 notification/alarm misconfiguration** — respect the 30s alarm floor, always pass `iconUrl`, check `getPermissionLevel()`, coalesce missed checks on wake. Address in Phase 5.

## Implications for Roadmap

Based on the combined research, the phase structure follows the dependency graph: reliability and storage foundations first, then the correlation speedup that everything else depends on, then the two flagship features, then the fragile differentiators.

### Phase 1: Core Reliability & Storage Foundations
**Rationale:** The immediate concern is the silent Seeking Alpha/Investing failure, and the foundational architecture decisions (worker ephemerality, storage budget) must be made now — retrofitting them later is a rewrite. Everything downstream depends on reliable sources and bounded storage.
**Delivers:** Fixed Seeking Alpha/Investing root cause; source health/staleness indicators; retention budget + per-key storage caps; incremental byte estimation (`getBytesInUse()`); idempotent/resumable collection.
**Addresses:** FEATURES P1 "Fix Seeking Alpha/Investing reliability" + "Source health/staleness indicators"; PROJECT.md Active items 1, 3.
**Avoids:** Pitfalls 1 (worker ephemerality), 2 (storage quota), 4 (paywalled source drop-out).
**Research flag:** Needs research-phase — the Seeking Alpha/Investing root cause is a live diagnosis (Google News RSS yield, correlation threshold, display truncation) that must be confirmed against the actual feed before the fix is designed.

### Phase 2: Correlation Engine Performance
**Rationale:** The inverted index is the highest-leverage change and the prerequisite for fast alerts and the market-driven news view. It's a pure optimization with no new dependencies.
**Delivers:** Shared keyword→contract inverted index (`services/engine/index.ts`); candidate-filtered correlation across all three passes; shared entity cache; complexity guard.
**Uses:** Hand-rolled `Map` inverted index (STACK.md).
**Implements:** Architecture Pattern 1 (inverted index) + Pattern 2 (batching/shared cache).
**Avoids:** Pitfall 3 (O(n×m) freeze).
**Research flag:** Standard patterns — the inverted index is a well-documented, dependency-free data structure; skip research-phase.

### Phase 3: ML Engine Hardening
**Rationale:** ML inference is the other performance bottleneck (large models, slow WASM). Model selection and quantization are decided here; changing the model later invalidates cached embeddings.
**Delivers:** Quantized models (q8/q4) with a dtype fallback chain; small task-appropriate models; runtime device detection (WebGPU with WASM fallback); lazy/cached model loading; download size budget.
**Avoids:** Pitfall 5 (ML model size/latency).
**Research flag:** Standard patterns — Transformers.js quantization and WebGPU fallback are well-documented; skip research-phase.

### Phase 4: Correlation Alerts
**Rationale:** Alerts are the core "surface what's moving fast" value and depend on the fast correlation engine from Phase 2. They must be built against MV3 constraints from day one.
**Delivers:** `chrome.notifications` + `chrome.alarms` alert engine; dedupe + throttle (anti-fatigue); watchlist-scoped alerting; notification click → dashboard; permission-level handling.
**Uses:** `chrome.notifications` via `webextension-polyfill` (STACK.md).
**Implements:** Architecture Pattern 3 (ephemeral-worker-safe alert detection).
**Avoids:** Pitfall 7 (notification/alarm misconfiguration).
**Research flag:** Standard patterns — MV3 alarm/notification constraints are well-documented; skip research-phase.

### Phase 5: Market-Driven News View
**Rationale:** The flagship differentiator. It depends on reliable sources (Phase 1), the fast correlation engine (Phase 2), and the category taxonomy. It's a read-only derived projection over existing data — no new collection.
**Delivers:** New dashboard view (`MarketDrivenNews.tsx`); category taxonomy (reuse `redditCategories`); volume/price-movement ranking; markets → correlated news → directional implication; `marketNewsView` derived snapshot.
**Features:** FEATURES P1 (market-driven news view, 3 categories).
**Implements:** Architecture Pattern 4 (market-driven news aggregation).
**Research flag:** Medium — the category taxonomy and direction computation (yesPrice delta + news sentiment) need design validation during planning, but the pattern is well-understood.

### Phase 6: Additional Sources & TikTok Collector
**Rationale:** TikTok is high-value but high-fragility; it must ship after the core is stable and after per-key storage caps (Phase 1) are in place. It's a best-effort differentiator, not a core feature.
**Delivers:** TikTok collector (content-script DOM scraping + thin background normalizer); more data sources; export coverage for new sources; watchlist improvements.
**Implements:** Architecture Pattern 5 (collector adapter).
**Avoids:** Pitfall 6 (TikTok fragility) — hard failure boundary, graceful degradation, manual fallback.
**Research flag:** Needs research-phase — TikTok has no public API and is hostile to scraping; the exact DOM-scraping approach and ToS posture need feasibility research before implementation.

### Phase Ordering Rationale

- **Reliability before features:** The market-driven view and alerts are only as good as the sources feeding them. Fixing the silent source failure and establishing storage/worker reliability (Phase 1) is the non-negotiable foundation.
- **Speed before features:** The inverted index (Phase 2) is a prerequisite for fast alerts and a fast market-driven view. Building features on top of a slow engine would bake in the bottleneck.
- **ML before alerts:** Alerts and the market view both consume ML inference; optimizing model size/latency (Phase 3) before building alerting avoids slow, janky notifications.
- **Flagship before differentiators:** The market-driven view (Phase 5) is the user's stated vision and highest-value feature; TikTok (Phase 6) is a fragile nice-to-have that must never block the core.
- **Anti-features avoided throughout:** no sub-minute polling, no backend, no auto-trading, no alert spam, no huge default models.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** Seeking Alpha/Investing root cause is a live diagnosis — verify the actual failure (Google News RSS yield, correlation threshold, display truncation) against the code before designing the fix.
- **Phase 6:** TikTok collection feasibility — no public API, hostile to scraping; needs DOM-scraping strategy and ToS posture research.

Phases with standard patterns (skip research-phase):
- **Phase 2:** Inverted index — well-documented, established pattern.
- **Phase 3:** ML quantization + WebGPU fallback — well-documented Transformers.js patterns.
- **Phase 4:** MV3 alarms/notifications — well-documented constraints.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified against official Chrome/MDN/Hugging Face docs + live npm registry versions |
| Features | HIGH | Based on PROJECT.md requirements, codebase analysis (CONCERNS.md), and competitor analysis |
| Architecture | HIGH | Based on existing codebase map + established MV3 patterns |
| Pitfalls | HIGH | Verified against official docs + observed Google News RSS behavior; some MEDIUM from personal MV3 experience |

**Overall confidence:** HIGH

### Gaps to Address

- **Seeking Alpha/Investing root cause:** The research identifies likely causes (Google News RSS yield, correlation threshold, display truncation, storage pruning) but the exact root cause must be confirmed against the live code in Phase 1. Handle by starting Phase 1 with a diagnosis task.
- **TikTok feasibility:** No public API; the DOM-scraping approach and ToS compliance are unverified. Handle by scoping TikTok as a best-effort optional collector with a hard failure boundary and a manual fallback.
- **Category taxonomy:** The market-driven view needs a shared category model; research recommends reusing the existing `redditCategories` config, but the exact taxonomy for finance/politics/tech needs design validation in Phase 5.
- **WebGPU availability:** ~70% global support; Firefox is flag-gated. The WASM fallback must be the baseline, with WebGPU as an enhancement — never a hard dependency.

## Sources

### Primary (HIGH confidence)
- Chrome extension API docs (storage, alarms, notifications) — developer.chrome.com — verified permissions, quotas, MV3 constraints
- Hugging Face Transformers.js WebGPU + dtypes/quantization guides — huggingface.co/docs/transformers.js — verified `device: 'webgpu'`, q8/q4, WASM fallback
- MDN Notifications API / IndexedDB — verified service-worker constraints and storage options
- npm registry (live) — verified current versions: `@huggingface/transformers` 4.2.0, `onnxruntime-web` 1.27.0, `webextension-polyfill` 0.12.0, `idb` 8.0.3, `flexsearch` 0.8.212
- Google News RSS live query for `site:seekingalpha.com` — observed paywalled source returns stale/non-article pages
- Project context: `.planning/PROJECT.md`, `.planning/codebase/CONCERNS.md` — known issues and requirements

### Secondary (MEDIUM confidence)
- Competitor analysis (Polymarket, Kalshi, Manifold, Bloomberg, Reuters, TradingView, Benzinga) — feature patterns for "what's moving and why," alerts, watchlists
- Personal experience / known MV3 pitfalls — MEDIUM confidence

### Tertiary (LOW confidence)
- TikTok collection approach — no official key-free API; realistic client-side paths are DOM scraping and public RSS proxies — needs phase-specific feasibility research

---
*Research completed: 2026-08-22*
*Ready for roadmap: yes*
