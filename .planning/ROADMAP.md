# Roadmap: TrendCast

## Milestones

- ✅ **v1.0 Speed, Alerts & New Data** — Phases 3-8 (shipped 2026-08-23)
- ✅ **v1.1 News Source Fix** — Phases 9-10 (shipped 2026-08-24)
- ✅ **v0.1.5 Stock Indicator News Sources** — Phases 11-13 (shipped 2026-08-27)
- 🔄 **v0.1.6 fix correlation** — Phases 14-16 (current)

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

<details>
<summary>✅ v0.1.5 Stock Indicator News Sources (Phases 11-13) — SHIPPED 2026-08-27</summary>

- [x] Phase 11: Stock Indicator Source Collection & Health (1/1 plans) — completed 2026-08-25
- [x] Phase 12: End-to-End Wiring & UI (1/1 plans) — completed 2026-08-25
- [x] Phase 13: Settings Migration & Regression Tests (1/1 plans) — completed 2026-08-25

</details>

### v0.1.6 fix correlation (Phases 14-16)

- [ ] **Phase 14: Ticker/Cashtag Bridging** - Unify `$AMZN`/`AMZN`/`Amazon` into one canonical entity space so stock-indicator news correlates with social/news/markets
- [ ] **Phase 15: ML Run Orchestration & Progress** - Fix stuck-progress: requestId-scoped progress/results, serialized worker queue, model-download progress events, guaranteed terminal state
- [ ] **Phase 16: Correlation Persistence & Analysis Triggers** - Persist results with `computedAt` freshness metadata; no auto-analyze on tab open, analyze only when none exists, re-analyze after collectNow

## Phase Details

### Phase 14: Ticker/Cashtag Bridging

**Goal**: Stock-indicator news items correlate with social/news/market signals about the same company — `$AMZN`, bare `AMZN`, and org name `Amazon` resolve to one canonical entity, and keyword-level correlation bridges the forms too
**Depends on**: Nothing (first phase of milestone)
**Requirements**: CORR-01, CORR-02, CORR-03, CORR-04
**Success Criteria** (what must be TRUE):

  1. A stock-indicator news item about Amazon and a social signal carrying `$AMZN` produce a correlation match (entity and keyword level), where none existed before
  2. Bare all-caps tickers (`AMZN`) resolve to entities only when they match `KNOWN_TICKERS` — English words (`ALL`, `ON`, `V`) and screener noise (`vcp`, `2026`, `breakout`) never create matches
  3. Screener template tokens (source labels, dates, `vcp`/`breakout` boilerplate) are absent from stock-indicator item keywords
  4. Existing correlation match sets are unchanged for non-bridged data — `correlation-equivalence` and `embedding-equivalence` suites pass without relaxed assertions
  5. Source health shows bridging coverage: count of stock-indicator items that produced a canonical ticker entity vs total

**Plans**: 2 plans

Plans:
**Wave 1**

- [ ] 14-01-PLAN.md — Keyword/entity canonicalization: bare cashtag emission, strip-$ legacy bridge, bare-caps ticker recognition with gates, ticker↔org entity unification, boost-detection rework (CORR-01, CORR-02)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 14-02-PLAN.md — Stock-indicator keyword curation + bridging coverage projection and SourceHealthIndicator display (CORR-03, CORR-04)

### Phase 15: ML Run Orchestration & Progress

**Goal**: ML correlation progress always reaches a terminal state and reflects reality — progress is scoped per run, the worker is serialized, model downloads are visible, and no path leaves the UI stuck
**Depends on**: Phase 14 (bridging changes keyword inputs; fix progress on the post-bridging pipeline)
**Requirements**: MLPROG-01, MLPROG-02
**Success Criteria** (what must be TRUE):

  1. Progress bar always settles: on success, ML error, and cancel, the loading state clears — no stuck bar even when a `precompute-*` run overlaps a `corr-*` run
  2. Progress and result acceptance are scoped by `requestId` — a late/overlapping run's messages never update or settle another run's UI
  3. First-run model download shows a `loading-model` progress phase driven by `progress_callback` events (per-file `initiate`/`download`/`progress`/`done`), instead of silence
  4. ML runs are serialized through the background worker — overlapping requests queue rather than overwrite each other's resolver
  5. A run interrupted by MV3 service-worker death leaves a persisted run-state marker any tab can use to reconstruct/clear stale progress

**Plans**: TBD

### Phase 16: Correlation Persistence & Analysis Triggers

**Goal**: Correlation results survive restarts with visible freshness, and analysis runs at the right times — cached results show instantly on tab open, fresh analysis runs only when none exists, and collection completion triggers re-analysis
**Depends on**: Phase 15 (trigger changes need the serialized run queue to be race-safe; existence check needs `computedAt` metadata)
**Requirements**: TRIG-01, TRIG-02, TRIG-03, TRIG-04
**Success Criteria** (what must be TRUE):

  1. Every terminal run path (success, ML error, cancel) writes `CONFIG.storage.correlations` with `computedAt` + input metadata; results survive tab/session restart
  2. An error result never clobbers a fresh good cached result, and a persisted error result never suppresses future auto-analysis
  3. Opening the dashboard shows cached results instantly with no auto-analyze; analysis auto-runs only when no stored (non-error) analysis exists
  4. Completing collectNow triggers re-analysis via `storage.onChanged` on snapshot keys, and the Correlations header shows `computedAt` + engine so live vs cached is distinguishable

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 14 → 15 → 16

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 14. Ticker/Cashtag Bridging | 0/2 | Not started | - |
| 15. ML Run Orchestration & Progress | 0/TBD | Not started | - |
| 16. Correlation Persistence & Analysis Triggers | 0/TBD | Not started | - |

---
_Archived roadmap details: [milestones/v0.1.5-ROADMAP.md](milestones/v0.1.5-ROADMAP.md)_
