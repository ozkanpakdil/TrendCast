---
status: testing
phase: 16-correlation-persistence-analysis-triggers
source: [16-VERIFICATION.md]
started: 2026-08-29T22:35:00Z
updated: 2026-08-30T08:55:00Z
audit_acknowledged:
  milestone: v0.1.7
  at: 2026-08-30
  gap_snapshot: "testing::scenarios=0"
---

## Current Test

[testing complete]

All 4 UAT tests executed and passed (2026-08-30).

## Tests

### 1. Extension reload with existing data — cached results render instantly, no auto-run

expected: Opening the dashboard with stored non-error correlations renders them instantly with no auto-analyze; header badge shows computedAt + engine.
result: [pass] (2026-08-30) Evidence: dashboard open on Correlations tab rendered 35 cached matches instantly (test-results/trendcast-test1-correlations.png, 3840×1876); freshness badge "⏱ computed 2m ago · heuristic · Xenova/all-MiniLM-L6-v2" + header "v0.1.6+2026-08-29T23:47:50.397Z · Last: 00:48"; zero CORRELATE_ALL messages in post-reconnect log captures; runState idle {"marker":null,"live":false,"activeRequestId":null,"queuedRequestIds":[]}.

### 2. Forced offline ML error — cached good result survives

expected: With a stored good correlation result, force an ML error (e.g. offline / model unavailable) and run analysis manually. The error shows in the UI for the active run, but the stored good result is NOT clobbered — reopening the dashboard still shows the previous good cached result.
result: [pass] (2026-08-30) Evidence: forced real ML error via `correlate embedding=nonexistent/model-xyz` (new CLI model-override in scripts/log-server.ts); background logged "ML worker error: Could not locate file …tokenizer.json" + "Kept existing non-error correlation result; incoming result not persisted"; focused dashboard showed active-run error state (⚠️ ML Engine Error banner, badge "computed 1m ago · embedding · nonexistent/model-xyz", Matches 0 — test-results/trendcast-test2-error-state.png); getCorrelations before AND after returned identical stored result (requestId corr-1788072498964, computedAt 1788072500399, error:null); closed dashboard tab and opened fresh one → Correlations tab rendered cached good result instantly (badge "computed 54m ago · heuristic · Xenova/all-MiniLM-L6-v2", 60 nodes · 55 edges, no error banner — test-results/trendcast-test2-cached-survives.png).

### 3. Real Collect Now with dashboard open — exactly one auto re-run, fresh badge

expected: With the dashboard open on the Correlations tab, complete a real collection. Exactly one automatic re-analysis fires (no double-run), and the header badge updates to the new computedAt.
result: [pass] (2026-08-30) Evidence: pre-state captured (badge "computed 56m ago · heuristic", stored computedAt 1788072500399, runState idle, dashboard tab 114 on Correlations tab); real `collectNow` via bridge (Reddit 100, Polymarket 100, Kalshi 1034, TikTok 9, News 1295 → snapshot 1000/135/1000); log shows exactly ONE dashboard CORRELATE_ALL ("CORRELATE_ALL received: {requestId:\"corr-1788075914914\"}" — the TRIG-03 auto-trigger, no manual click; the second computation is the pre-existing Phase 4 background precompute path, requestId precompute-*, which is separate from the dashboard trigger and not a double-run); getCorrelations after → new computedAt 1788075916457 (ageMs 8104), error:null; dashboard badge updated to "⏱ computed 0m ago · heuristic · Xenova/all-MiniLM-L6-v2" with Matches 183, Avg Conf 46%, header "Last: 08:45" (test-results/trendcast-test3-fresh-badge.png); runState idle after completion.

### 4. Full browser restart — results persist via storage.local

expected: After a complete browser restart, previously computed correlation results are still present and render instantly on dashboard open (persistence across sessions).
result: [pass] (2026-08-30) Evidence: full Firefox quit + relaunch; worker dormant on first pings ("Extension not connected") — user opened dashboard + ran Collect Now to wake it (bridge needed one extension reload due to debug-toggle off after restart; log-forwarder has no auto-reconnect by design); getCorrelations after reconnect → stored result survived restart (computedAt 1788076237070, error:null, heuristic, counts 10/142/9/15); closed dashboard tab (Cmd+W) and opened fresh tab 21 → clicked Correlations → cached result rendered instantly (badge "⏱ computed 1m ago · heuristic · Xenova/all-MiniLM-L6-v2", no error banner — test-results/trendcast-test4-restart-persistence.png); runState idle {"marker":null,"live":false,"activeRequestId":null,"queuedRequestIds":[]} — no auto re-run on open.

## Summary

total: 4
passed: 4
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
