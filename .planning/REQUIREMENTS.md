# Requirements

**Project:** TrendCast
**Milestone:** v1.0 — Speed, Alerts & New Data
**Date:** 2026-08-22

## v1.0 Requirements

### Performance

- [x] **PERF-02**: User can see correlation results faster via an inverted keyword→contract index (O(n×m) → candidate filtering), with results equivalent to the current engine
- [ ] **PERF-03**: User's storage stays within budget via per-key caps + incremental byte estimation (stop unbounded growth)
- [ ] **PERF-04**: User can run ML correlation with quantization (q8/q4) and WebGPU acceleration, falling back to WASM without breaking the engine

### Alerts

- [ ] **ALERT-01**: User receives correlation alerts via `chrome.notifications` + alarms, deduped + throttled, watchlist-scoped
- [ ] **ALERT-02**: User sees alerts with direction (bullish/bearish) + top correlated signal/news

### Market-Driven News

- [ ] **MKT-01**: User can see a "market-driven news" view — important markets → news/direction they imply (finance + politics + tech)
- [ ] **MKT-02**: User sees a consistent category taxonomy (reuse Reddit categories across markets + news)

### Sources

- [ ] **SRC-01**: User can see TikTok social sentiment (best-effort, graceful degradation)
- [ ] **SRC-02**: User can see more data sources (news outlets / market platforms)

### Dashboard

- [ ] **DASH-01**: User can sort/filter watchlist and see correlation status
- [ ] **DASH-02**: User can export data covering new sources

## Completed (Prior Milestone — Hardening v1)

- [x] **REL-01**: User can see Seeking Alpha and Investing.com news in the correlation tab (root cause diagnosed and fixed)
- [x] **REL-02**: User can see per-source health/staleness indicators so they know when a source is degraded or stale
- [x] **PERF-01**: User can interact with the dashboard without lag when rendering large datasets (UI responsiveness)

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

| Requirement | Phase | Status |
|-------------|-------|--------|
| PERF-02 | Phase 3 | Complete |
| PERF-03 | Phase 8 | Pending |
| PERF-04 | Phase 8 | Pending |
| ALERT-01 | Phase 4 | Pending |
| ALERT-02 | Phase 4 | Pending |
| MKT-01 | Phase 5 | Pending |
| MKT-02 | Phase 5 | Pending |
| SRC-01 | Phase 7 | Pending |
| SRC-02 | Phase 7 | Pending |
| DASH-01 | Phase 6 | Pending |
| DASH-02 | Phase 6 | Pending |
