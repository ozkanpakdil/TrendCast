# Milestones

## v0.1.6 v0.1.6 (Shipped: 2026-08-30)

**Phases completed:** 3 phases, 6 plans, 10 tasks

**Key accomplishments:**

- Ticker-identity bridging shipped: `$NVDA` social posts, `NVDA — Stock Indicator` news, and Nvidia contracts now unify on one entity key, with ticker-aware boost and hardened embedding pipeline.
- Stock-indicator news items now carry ticker-only keywords (label/date tokens can no longer dilute keyword Jaccard), and the source-health sidebar shows per-source bridging coverage (bridged/total) in its tooltip.
- ML correlation runs are now serialized through a FIFO queue, every terminal result is stamped with its requestId, and a persisted run-state marker lets the dashboard detect (and settle) a run whose service worker died mid-flight.
- First-run model downloads now surface per-file progress through the existing `loading-model` phase instead of a silent spinner — the dashboard shows which file is downloading and how far along it is.

---

## v0.1.5 Stock Indicator News Sources (Shipped: 2026-08-27)

**Phases completed:** 3 phases, 3 plans, 3 tasks

**Key accomplishments:**

- Three personal stock-indicator RSS feeds (usa-stocks-indicator layoff/award reports, breakout screener, VCP screener-2) added as first-class news sources via rss2json, with `GUID_BASED_SOURCES` guid-derived ids so feeds whose items share a single `link` aren't collapsed by `mergeNews` dedup (SRC-03).
- Health/staleness tracking for the new sources in `SourceHealthIndicator`, wired into the background collection cycle and the cross-source alert engine's `NEWS_SOURCES` set (SRC-06).
- End-to-end UI wiring: popup settings toggles, NewsFeed labels/colors, HistoryChart platform labels — consistent with existing source conventions (SRC-04).
- Settings deep-merge + migration backfills the three new flags to `true` for existing users without overwriting explicit preferences (SRC-05).
- Storage I/O extracted into testable functions taking a narrow `SettingsStorage` interface, with 6 integration tests proving the read → deep-merge → migrate → conditional-write path.

**Known verification overrides:** 0 newly acknowledged, 5 carried forward from a prior close (see STATE.md Deferred Items).

---

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
