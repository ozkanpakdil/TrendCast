# Requirements

**Project:** TrendCast
**Milestone:** Hardening v1 — fix Seeking Alpha/Investing reliability + UI responsiveness
**Date:** 2026-08-22

## v1 Requirements

### Data Reliability

- [ ] **REL-01**: User can see Seeking Alpha and Investing.com news in the correlation tab (root cause diagnosed and fixed — feed reliability, correlation threshold, or display truncation)
- [ ] **REL-02**: User can see per-source health/staleness indicators so they know when a source is degraded or stale

### Performance

- [ ] **PERF-01**: User can interact with the dashboard without lag when rendering large datasets (UI responsiveness)

## v2 Requirements (Deferred)

- [ ] **PERF-02**: Correlation speedup via inverted keyword→contract index (O(n×m) → candidate filtering)
- [ ] **PERF-03**: Per-key storage caps + incremental byte estimation (stop unbounded growth)
- [ ] **PERF-04**: ML hardening — quantization (q8/q4) + WebGPU with WASM fallback
- [ ] **ALERT-01**: Correlation alerts via `chrome.notifications` + alarms, deduped + throttled, watchlist-scoped
- [ ] **ALERT-02**: Alerts with direction (bullish/bearish) + top correlated signal/news
- [ ] **MKT-01**: "Market-driven news" view — important markets → news/direction they imply (finance + politics + tech)
- [ ] **MKT-02**: Category taxonomy (reuse Reddit categories across markets + news)
- [ ] **SRC-01**: TikTok collector (best-effort, graceful degradation)
- [ ] **SRC-02**: More data sources (news outlets / market platforms)
- [ ] **DASH-01**: Watchlist improvements (sort/filter/correlation status)
- [ ] **DASH-02**: Export coverage for new sources

## Out of Scope

- Backend server / cloud sync / accounts — violates the hard 100% client-side constraint
- Auto-trading / order execution — legal/regulatory risk; correlation is a decision aid, not a guarantee
- Paywall bypass / full-text scraping — legal/ToS risk; headlines + summaries only
- Real-time / sub-minute polling — MV3 alarm min is 30s; hourly is fine for a daily decision aid
- Push notifications to phone / cross-device — MV3 can't do this without a backend
- Build own prediction market — out of scope, huge legal surface
- Monetization / ads — internal tool
- Over-engineered ML (huge LLMs by default) — regresses the "fast enough to trust daily" value

## Traceability

<!-- Filled by roadmap: maps each v1 requirement to a phase -->
