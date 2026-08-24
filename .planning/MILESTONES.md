# Milestones

## v1.1 News Source Fix (Shipped: 2026-08-24)

**Phases completed:** 2 phases, 7 plans, 4 tasks

**Key accomplishments:**

- News Source Fix: deep-merge `enabledSources` so newer source flags (seekingalpha/investing/googleFinance) default to `true` for existing users, plus a settings migration to backfill missing flags on load — preserving explicit user preferences (NEWS-01/02/03).
- Health quirk fix: a healthy-but-quiet news source (304 Not Modified) no longer shows "Degraded · fetched 0" when its stored news is present and correlated (G-09-1).
- Cross-source consensus alerts: surface important topics even with an empty watchlist by detecting when the same topic appears across >=3 distinct source types (mixing social + news), reusing the existing `newsSocialMatches` correlation output and the shared alert infrastructure (PHASE-10).
- Cross-source alert engine: union-find clustering of correlation matches by shared entity keyword, distinct source-type counting, any-direction firing, per-topic cooldown, and `alertsEnabled` gating (D-01..D-10).
- Kind-aware AlertsTab UI: cross-source cards with topic label, indigo "Cross-source" badge, source breakdown, and clickable Source/Social links; watchlist cards unchanged.

**Known verification overrides:** 2 newly acknowledged, 3 carried forward from a prior close (see STATE.md Deferred Items).

---

## v1.0 Speed, Alerts & New Data (Shipped: 2026-08-23)

**Phases completed:** 6 phases, 19 plans, 10 tasks

**Key accomplishments:**

- Correlation speedup: inverted keyword→contract index collapses O(n×m) to candidate filtering across heuristic + ML paths, with equivalence tests proving no result drift (PERF-02).
- Correlation alerts: pure `evaluateAlerts()` + `deriveDirection()` engine — deduped, throttled, watchlist-scoped, direction-aware `chrome.notifications` alerts surviving the MV3 service worker via alarms (ALERT-01/02).
- Market-driven news: read-only derived view surfacing important markets → correlated news → directional implication, organized by a consistent category taxonomy (MKT-01/02).
- Watchlist & export: sort/filter/correlation-status badges + export coverage for new sources in a backward-compatible format (DASH-01/02).
- TikTok collector: best-effort content-script-driven TikTok sentiment with hard timeout + graceful degradation + manual URL-paste fallback (SRC-01/02).
- Storage & ML hardening: per-key caps (1000/1000/1000) + `getBytesInUse()`-authoritative budget; ML quantization (q8/q4) + WebGPU with WASM fallback (PERF-03/04).

**Known verification overrides:** 0 newly acknowledged, 3 carried forward from a prior close (see STATE.md Deferred Items).

---
