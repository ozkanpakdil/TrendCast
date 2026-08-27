# Roadmap: TrendCast

## Milestones

- ✅ **v1.0 Speed, Alerts & New Data** — Phases 3-8 (shipped 2026-08-23)
- ✅ **v1.1 News Source Fix** — Phases 9-10 (shipped 2026-08-24)
- 🔄 **0.1.5 Stock Indicator News Sources** — Phases 11-13 (in progress)

## Phases

<details>
<summary>✅ v1.0 Speed, Alerts & New Data (Phases 3-8) — SHIPPED 2026-08-23</summary>

- [x] Phase 3: Correlation Speedup (4/4 plans) — completed 2026-08-23
- [x] Phase 4: Correlation Alerts (3/3 plans) — completed 2026-08-23
- [x] Phase 5: Market-Driven News (3/3 plans) — completed 2026-08-23
- [x] Phase 6: Watchlist & Export (3/3 plans) — completed 2026-08-23
- [x] Phase 7: TikTok Collector (3/3 plans) — completed 2026-08-23
- [x] Phase 8: Storage & ML Hardening (3/3 plans) — completed 2026-08-23

</details>

<details>
<summary>✅ v1.1 News Source Fix (Phases 9-10) — SHIPPED 2026-08-24</summary>

- [x] Phase 9: News Source Fix (4/4 plans) — completed 2026-08-24
- [x] Phase 10: Cross-Source Consensus Alerts (3/3 plans) — completed 2026-08-24

</details>

<details open>
<summary>🔄 0.1.5 Stock Indicator News Sources (Phases 11-13) — IN PROGRESS</summary>

- [x] Phase 11: Stock Indicator Source Collection & Health (1/1 plans) — complete
- [x] Phase 12: End-to-End Wiring & UI (1/1 plans) — complete
- [x] Phase 13: Settings Migration & Regression Tests (1/1 plans) — complete

</details>

## Phase Details

### Phase 11: Stock Indicator Source Collection & Health
**Goal**: Users see headlines from the three stock-indicator RSS feeds collected and tracked for health/staleness
**Depends on**: Nothing (first phase of 0.1.5)
**Requirements**: SRC-03, SRC-06
**Success Criteria** (what must be TRUE):
  1. User sees headlines from usa-stocks-indicator (layoff/award reports), top-us-stock-tickers breakout screener, and VCP screener-2 in the news tab
  2. Each new source is collected via the rss2json proxy and stored under its own key with per-key caps
  3. Each new source shows a correct health/staleness indicator (healthy, degraded, or stale) based on last fetch
  4. Unit tests cover collection of the three new sources (news-collector.test.ts)
**Plans**: 1 plan

Plans:
- [x] 11-01-PLAN.md — Collect the three stock-indicator feeds (guid-based ids), wire into background/alerts, backfill settings flags

### Phase 12: Stock Indicator End-to-End Wiring & UI
**Goal**: Users can toggle each new source on/off and see it labeled/colored consistently across the dashboard
**Depends on**: Phase 11
**Requirements**: SRC-04
**Success Criteria** (what must be TRUE):
  1. User can toggle each new source on/off in the popup settings
  2. New sources appear with correct labels/colors in the dashboard NewsFeed, SourceHealthIndicator, and HistoryChart
  3. New sources are wired end-to-end (config, types, collector, background, dashboard, popup)
**Plans**: 1 plan

Plans:
- [x] 12-01-PLAN.md — Wire the three new sources into popup settings toggles, NewsFeed labels/colors, and HistoryChart labels

### Phase 13: Settings Migration & Regression Tests
**Goal**: Existing users' settings migrate so the new source flags default to `true` without overwriting explicit preferences
**Depends on**: Phase 12
**Requirements**: SRC-05
**Success Criteria** (what must be TRUE):
  1. Existing users' settings are migrated so the new source flags default to `true` (deep-merge `enabledSources` + settings migration)
  2. Explicit user preferences are preserved (deep-merge never overwrites a user-set value)
  3. Unit tests cover the deep-merge and migration behavior for the new source flags (settings-deep-merge.test.ts, settings-migration.test.ts)
**Plans**: 1 plan

Plans:
- [x] 13-01-PLAN.md — Extract storage I/O settings wiring into testable functions, add integration tests, run full regression suite

## Progress

**Execution Order:**
Phases execute in numeric order: 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 3. Correlation Speedup | v1.0 | 4/4 | Complete | 2026-08-23 |
| 4. Correlation Alerts | v1.0 | 3/3 | Complete | 2026-08-23 |
| 5. Market-Driven News | v1.0 | 3/3 | Complete | 2026-08-23 |
| 6. Watchlist & Export | v1.0 | 3/3 | Complete | 2026-08-23 |
| 7. TikTok Collector | v1.0 | 3/3 | Complete | 2026-08-23 |
| 8. Storage & ML Hardening | v1.0 | 3/3 | Complete | 2026-08-23 |
| 9. News Source Fix | v1.1 | 4/4 | Complete | 2026-08-24 |
| 10. Cross-Source Consensus Alerts | v1.1 | 3/3 | Complete | 2026-08-24 |
| 11. Stock Indicator Source Collection & Health | 0.1.5 | 1/1 | Complete | 2026-08-25 |
| 12. Stock Indicator End-to-End Wiring & UI | 0.1.5 | 1/1 | Complete | 2026-08-25 |
| 13. Settings Migration & Regression Tests | 0.1.5 | 1/1 | Complete | 2026-08-25 |
