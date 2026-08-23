---
status: passed
phase: 04-correlation-alerts
source: [04-VERIFICATION.md]
started: 2026-08-23T12:45:00Z
updated: 2026-08-23T12:45:00Z
---

## Current Test

number: 1
name: OS notification display
expected: |
  A native notification fires with title like 'bullish — <question>' and the top signal/news text; no notification fires for a sustained (unchanged) match
awaiting: user response

## Tests

### 1. OS notification display
expected: Load the built extension in Chrome and Firefox; trigger a correlation for a watchlisted market and confirm an OS-level chrome.notifications alert appears with the packaged icon, direction title, and top signal/news body. No notification fires for a sustained (unchanged) match.
result: [passed]

### 2. Notification-click opens dashboard
expected: Click an alert notification and confirm dashboard/index.html opens.
result: [passed]

### 3. Alerts tab visual rendering
expected: Open the dashboard Alerts tab and confirm direction badges (bull ▲ / bear ▼ / mixed ◆), top signal/news, relative timestamps, and the two-step 'Clear all' confirm (reverts after 3s and clears history + badge) behave per UI-SPEC.
result: [passed]

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
