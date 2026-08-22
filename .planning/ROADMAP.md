# Roadmap: TrendCast

## Overview

TrendCast is a mature, working 100% client-side MV3 browser extension that correlates social sentiment, news, and prediction-market odds. This hardening milestone fixes the two most urgent reliability/performance gaps on the existing foundation: the silent Seeking Alpha / Investing.com news drop-out in the correlation tab (with per-source health visibility), and dashboard UI responsiveness when rendering large datasets. The scope is deliberately narrow — the codebase is sound and should be evolved, not re-architected.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Data Reliability** - Fix Seeking Alpha/Investing news drop-out and add per-source health/staleness indicators
- [ ] **Phase 2: UI Responsiveness** - Eliminate dashboard lag when rendering large datasets

## Phase Details

### Phase 1: Data Reliability

**Mode:** mvp
**Goal**: Users can reliably see Seeking Alpha and Investing.com news in the correlation tab and know when any news source is degraded or stale
**Depends on**: Nothing (first phase)
**Requirements**: REL-01, REL-02
**Success Criteria** (what must be TRUE):

  1. User can see Seeking Alpha and Investing.com news items in the correlation tab (root cause diagnosed and fixed)
  2. User can see a per-source health/staleness indicator for each news source in the dashboard
  3. User can distinguish a source that is degraded/stale from one that simply has no correlated items (fetched vs. correlated is decoupled)

**Plans**: 3 plans
**UI hint**: yes

Plans:
**Wave 1**

- [ ] 01-01-PLAN.md — sourceHealth telemetry tracer: record per-source fetch outcomes, persist in snapshot, render SourceHealthIndicator

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 01-02-PLAN.md — diagnostic regression test for SA/Investing correlation thresholds (D-01/D-03)
- [ ] 01-03-PLAN.md — SourceHealthIndicator 7 UI states + e2e assertion

### Phase 2: UI Responsiveness

**Mode:** mvp
**Goal**: User can interact with the dashboard without lag when rendering large datasets
**Depends on**: Phase 1
**Requirements**: PERF-01
**Success Criteria** (what must be TRUE):

  1. User can scroll through the news/correlation feeds without jank when large datasets are loaded
  2. User can switch between dashboard tabs without noticeable delay
  3. User can click, filter, and hover on dashboard elements without the UI freezing during rendering

**Plans**: 1 plan
**UI hint**: yes

Plans:
- [ ] 02-01-PLAN.md — virtualize HypeFeed + NewsFeed by row with @tanstack/react-virtual (bounded DOM, preserved visuals)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Data Reliability | 0/0 | Not started | - |
| 2. UI Responsiveness | 0/0 | Not started | - |
