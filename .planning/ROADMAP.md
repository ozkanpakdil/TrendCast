# Roadmap: TrendCast

## Overview

TrendCast is a mature, working 100% client-side MV3 browser extension that correlates social sentiment, news, and prediction-market odds. This milestone — **v1.0 Speed, Alerts & New Data** — makes it faster and more useful as a daily decision aid: speed up correlation with an inverted index, add deduped/throttled/watchlist-scoped correlation alerts, surface a flagship "market-driven news" view, expand data sources (TikTok + more), and polish the dashboard (watchlist + export). The scope is dependency-light hardening on the proven stack — zero new runtime dependencies, one manifest permission (`notifications`). The inverted keyword→contract index is the enabler: it collapses the O(n×m) correlation loop and unblocks both alerts and the market-driven view.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 3: Correlation Speedup** - Inverted keyword→contract index collapses O(n×m) to near-linear candidate filtering across heuristic + ML paths
- [ ] **Phase 4: Correlation Alerts** - Deduped, throttled, watchlist-scoped, direction-aware `chrome.notifications` alerts
- [ ] **Phase 5: Market-Driven News** - Read-only derived view: important markets → correlated news → directional implication (finance/politics/tech)
- [ ] **Phase 6: Watchlist & Export** - Watchlist sort/filter/correlation-status badges + export coverage for new sources
- [ ] **Phase 7: TikTok Collector** - Best-effort content-script-driven TikTok sentiment with hard timeout + graceful degradation
- [ ] **Phase 8: Storage & ML Hardening** - Per-key storage caps + incremental byte estimation; ML quantization (q8/q4) + WebGPU with WASM fallback

## Phase Details

### Phase 3: Correlation Speedup

**Mode:** mvp
**Goal**: Users see correlation results faster via an inverted keyword→contract index, with results equivalent to the current engine
**Depends on**: Nothing (first phase of this milestone)
**Requirements**: PERF-02
**Success Criteria** (what must be TRUE):

  1. User sees correlation results computed from a candidate-filtered inverted index instead of the O(n×m) nested loop, with no visible latency regression on large datasets
  2. Correlation results are equivalent to the previous engine (golden-test equivalence vs the naive loop) — no silent result drift
  3. Both the heuristic and ML correlation paths use the same tokenization source and index, so results stay consistent across engines
  4. The index is built incrementally (cached by data version) and falls back to the naive loop for tiny inputs without breaking correlation

**Plans**: 4 plans
**UI hint**: no

Plans:
- [ ] 03-01-PLAN.md — Build shared InvertedIndex + unit tests + shared fixtures
- [ ] 03-02-PLAN.md — Convert heuristic path to candidate-filtered + equivalence test
- [ ] 03-03-PLAN.md — Route zeroshot/sentiment/LLM through the index + per-engine equivalence
- [ ] 03-04-PLAN.md — Embedding/NER equivalence tests (naive-loop oracle, index not applicable)

### Phase 4: Correlation Alerts

**Goal**: Users receive correlation alerts via `chrome.notifications` + alarms that are deduped, throttled, and scoped to their watchlist, with direction and top signal/news
**Depends on**: Phase 3
**Requirements**: ALERT-01, ALERT-02
**Success Criteria** (what must be TRUE):

  1. User receives a `chrome.notifications` alert when a strong correlation appears for a watchlisted market, without notification fatigue (deduped by stable key + throttled with global/per-market cooldown)
  2. User sees the alert's direction (bullish/bearish) derived from signal sentiment + Yes-price delta
  3. User sees the top correlated signal/news in the alert body
  4. Alerts survive the ephemeral MV3 service worker (driven by `chrome.alarms` + persisted `alertState`, not timers), and fall back to an in-dashboard badge if notification permission is denied
  5. Alert history is capped (~100) so storage stays bounded

**UI**: yes

### Phase 5: Market-Driven News

**Goal**: Users can see a "market-driven news" view — important prediction markets and the news/direction they imply, organized by a consistent category taxonomy
**Depends on**: Phase 3
**Requirements**: MKT-01, MKT-02
**Success Criteria** (what must be TRUE):

  1. User can open a "market-driven news" view that surfaces notable markets and the news/direction they imply across finance, politics, and technology
  2. User sees a consistent category taxonomy (reusing the existing Reddit categories) applied to both markets and news, with deterministic precedence (politics > finance > tech)
  3. The view is a read-only derived projection over existing markets + news + correlations — no new collection, and it renders without regressing dashboard responsiveness

**UI**: yes

### Phase 6: Watchlist & Export

**Goal**: Users can organize their watchlist (sort/filter/correlation status) and export data covering all sources including new ones
**Depends on**: Phase 4
**Requirements**: DASH-01, DASH-02
**Success Criteria** (what must be TRUE):

  1. User can sort and filter the watchlist and see a correlation status badge per market at a glance
  2. User can export data that covers new sources (TikTok, market-driven categories) in a backward-compatible format — existing columns unchanged, new sections appended
  3. Existing stored watchlist data loads correctly after the schema change (migration + backfill on read), and dashboard virtualization is preserved

**UI**: yes

### Phase 7: TikTok Collector

**Goal**: Users can see TikTok social sentiment as a best-effort source that degrades gracefully without breaking the collection pipeline
**Depends on**: Phase 6
**Requirements**: SRC-01, SRC-02
**Success Criteria** (what must be TRUE):

  1. User can see TikTok social sentiment in the dashboard when the discover page is reachable
  2. TikTok collection is isolated with a hard timeout and never degrades other sources (BBC/CNN/Polymarket/Kalshi keep working even if TikTok fails)
  3. User sees a graceful degradation state (source health indicator) when TikTok is unavailable, with a manual URL-paste fallback
  4. User can see additional data sources beyond TikTok (more news outlets / market platforms) wired end-to-end

**UI**: yes

### Phase 8: Storage & ML Hardening

**Goal**: Users' storage stays within budget via per-key caps + incremental byte estimation, and ML correlation runs with quantization/WebGPU falling back to WASM
**Depends on**: Phase 7
**Requirements**: PERF-03, PERF-04
**Success Criteria** (what must be TRUE):

  1. User's storage stays within the ~7 MB soft budget under sustained collection (per-key caps + `getBytesInUse()`-authoritative budget, no unbounded growth)
  2. User can run ML correlation with quantization (q8/q4) and WebGPU acceleration when available
  3. ML correlation falls back to WASM without breaking the engine when WebGPU is unavailable (e.g., Firefox flag-gated), and quantized results are equivalent to fp32 (golden-test equivalence)

**UI**: no

## Progress

**Execution Order:**
Phases execute in numeric order: 3 → 4 → 5 → 6 → 7 → 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 3. Correlation Speedup | 0/4 | Not started | - |
| 4. Correlation Alerts | 0/TBD | Not started | - |
| 5. Market-Driven News | 0/TBD | Not started | - |
| 6. Watchlist & Export | 0/TBD | Not started | - |
| 7. TikTok Collector | 0/TBD | Not started | - |
| 8. Storage & ML Hardening | 0/TBD | Not started | - |
