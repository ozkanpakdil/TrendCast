---
status: testing
phase: 09-news-source-fix
source: [09-VERIFICATION.md]
started: 2026-08-23T18:30:00Z
updated: 2026-08-23T18:30:00Z
---

## Current Test

number: 2
name: Migration on extension update (SC2)
expected: |
  Update the extension from a version with stale settings (missing seekingalpha/investing/googleFinance)
  and inspect chrome.storage.local after the onInstalled update event. The stored settings object now
  contains seekingalpha/investing/googleFinance = true, and the fix survives a restart.
awaiting: user response

## Tests

### 1. End-to-end collection → render (SC1)
expected: Install the extension with pre-existing saved settings missing seekingalpha/investing, run "Collect now", open the News tab. Seeking Alpha and Investing.com headlines appear in the populated grid.
result: pass

### 2. Migration on extension update (SC2)
expected: Update the extension from a version with stale settings (missing seekingalpha/investing/googleFinance) and inspect chrome.storage.local after the onInstalled update event. The stored settings object now contains seekingalpha/investing/googleFinance = true, and the fix survives a restart.
result: pending

### 3. Popup toggles render checked (ON)
expected: Open the popup with pre-existing saved settings missing the newer flags. The Seeking Alpha and Investing.com toggle rows render checked (ON).
result: pending

### 4. Protected UI states unchanged
expected: Open the News tab and verify the partial, long-text, overflow, zero-one-many, loading, and error states are unchanged. All 6 protected UI states render exactly as before the fix (deep-merge does not touch rendering).
result: pending

## Summary

total: 4
passed: 1
issues: 1
pending: 3
skipped: 0
blocked: 0

## Gaps

- gap_id: G-09-1
  truth: "A healthy-but-quiet news source (304 Not Modified, no new headlines) shows 'Degraded · fetched 0' instead of 'Healthy' even though its stored news is present and correlated"
  status: resolved
  resolved_by: 09-04-PLAN.md
  resolved_at: 2026-08-23
  reason: "User reported: BBC/CNN/Yahoo/Google show 'Degraded · fetched 0 · correlated N' despite having correlated news. Root cause: collectNews records itemCount:0 on a 304-unchanged fetch (consecutiveFailures correctly NOT incremented), but computeHealth labels any itemCount===0 as 'degraded', so a healthy-but-quiet source is mislabeled."
  severity: major
  test: 1
  artifacts: []
  missing: []
