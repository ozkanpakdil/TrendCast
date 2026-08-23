# Roadmap: TrendCast

## Overview

TrendCast is a mature, working 100% client-side MV3 browser extension that correlates social sentiment, news, and prediction-market odds. The **v1.0 Speed, Alerts & New Data** milestone shipped: inverted-index correlation speedup, deduped/throttled/watchlist-scoped correlation alerts, a flagship "market-driven news" view, expanded data sources (TikTok + more), and dashboard polish (watchlist + export). Storage & ML hardening (per-key caps, quantization + WebGPU→WASM fallback) completed the milestone.

The **v1.1 News Source Fix** milestone is a focused bug fix: existing users with pre-existing saved settings have a partial `enabledSources` object missing the newer `seekingalpha`/`investing`/`googleFinance` keys, so those sources are never collected and never appear in the news tab. The fix deep-merges `enabledSources` and adds a settings migration to backfill missing flags, with unit-test regression coverage.

## Milestones

- ✅ **v1.0 Speed, Alerts & New Data** — Phases 3-8 (shipped 2026-08-23)
- 🚧 **v1.1 News Source Fix** — Phase 9 (in progress)

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

### 🚧 v1.1 News Source Fix (In Progress)

**Milestone Goal:** Fix the news tab so Seeking Alpha and Investing.com headlines actually appear for existing users.

#### Phase 9: News Source Fix

**Goal**: Existing users see Seeking Alpha and Investing.com headlines in the news tab even with pre-existing saved settings
**Depends on**: Phase 8
**Requirements**: NEWS-01, NEWS-02, NEWS-03
**Success Criteria** (what must be TRUE):

  1. User with pre-existing saved settings sees Seeking Alpha and Investing.com headlines in the news tab (deep-merged `enabledSources` defaults those flags to `true`)
  2. User's saved settings are migrated on load to backfill any missing source flags, so the fix persists across restarts
  3. User's existing enabled/disabled source choices are preserved (deep-merge never overwrites an explicit user preference)
  4. Regression unit tests prove the deep-merge + migration behavior (NEWS-03)

**Plans**: 3 plans

Plans:
**Wave 1**

- [ ] 09-01: Deep-merge `enabledSources` in `getSettings` (background) and dashboard settings load

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 09-02: Settings migration to backfill missing source flags on load

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 09-03: Unit-test regression coverage for the deep-merge + migration fix

## Progress

**Execution Order:**
Phases execute in numeric order: 3 → 4 → 5 → 6 → 7 → 8 → 9

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 3. Correlation Speedup | v1.0 | 4/4 | Complete | 2026-08-23 |
| 4. Correlation Alerts | v1.0 | 3/3 | Complete | 2026-08-23 |
| 5. Market-Driven News | v1.0 | 3/3 | Complete | 2026-08-23 |
| 6. Watchlist & Export | v1.0 | 3/3 | Complete | 2026-08-23 |
| 7. TikTok Collector | v1.0 | 3/3 | Complete | 2026-08-23 |
| 8. Storage & ML Hardening | v1.0 | 3/3 | Complete | 2026-08-23 |
| 9. News Source Fix | v1.1 | 0/3 | Not started | - |
