---
status: passed
phase: 10-cross-source-consensus-alerts
source: [10-VERIFICATION.md]
started: 2026-08-24T22:10:00Z
updated: 2026-08-24T22:42:00Z
audit_acknowledged:
  milestone: v1.1
  at: 2026-08-24
  gap_snapshot: "passed::scenarios=0"
---

## Current Test

number: 2
name: Watchlist card rendering unchanged
expected: |
  A watchlist alert (kind === 'watchlist' or undefined) renders alert.question as the title, exactly as before Phase 10.
awaiting: none — all tests complete

## Fixes Applied During UAT

- **Links (22:24Z)**: Added `topSignalUrl`/`topNewsUrl` to `AlertRecord`, populated from the top match, and rendered clickable "Source ↗" / "Social post ↗" links in AlertsTab. Old persisted alerts are immutable — only new alerts carry links.
- **Single-alert bug (22:34Z)**: Global cooldown was evaluated against `state.lastGlobalAlertAt`, which was advanced *inside* the cluster loop — so the first consensus topic suppressed every other distinct topic in the same sweep (WR-02). Fixed by evaluating the global throttle once against persisted state before the loop and advancing `lastGlobalAlertAt` only after the loop if any alert fired. Added a multi-topic unit test. 340/340 tests pass, typecheck + lint clean, extension rebuilt.

## Tests

### 1. Cross-source alert card rendering

expected: A crossSource alert shows topicLabel as the title, an indigo "Cross-source" badge, and sourceTypes joined with " · " as a muted line, plus clickable "Source ↗" and "Social post ↗" links.
result: pass

### 2. Watchlist card rendering unchanged

expected: A watchlist alert (kind === 'watchlist' or undefined) renders alert.question as the title, exactly as before Phase 10.
result: pass

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

  artifacts: []
  missing: []
