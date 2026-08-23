# Milestones

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
