---
phase: 09-news-source-fix
plan: 04
type: execute
wave: 1
gap_closure: true
gap_ids:
  - G-09-1
requirements:
  - NEWS-01
status: complete
completed: 2026-08-23T19:16:00Z
---

# Plan 09-04 Summary — Fix health quirk (G-09-1)

## Objective

Close gap G-09-1: a healthy-but-quiet news source (304 Not Modified, no new headlines) was mislabeled 'Degraded · fetched 0' instead of 'Healthy' even though its stored news was present and correlated.

## Root Cause

`collectNews()` recorded `itemCount: 0` when a source returned 304 (unchanged) — correctly NOT incrementing `consecutiveFailures` — but `computeHealth()` labeled any entry with `itemCount === 0` as `'degraded'`. So a healthy-but-quiet source (304, itemCount 0, consecutiveFailures 0) was mislabeled.

## Changes

### Task 1: Record the 304-unchanged signal

- **`src/types/index.ts`** — added optional `lastUnchanged?: boolean` to `SourceHealthEntry` ("True when the last fetch returned 304 Not Modified (no new content)").
- **`src/services/collectors/news.ts`** — `collectNews` fulfilled branch now sets `lastUnchanged: unchanged` on the health entry, so a 304 is recorded distinctly from a genuinely empty fetch. The rejected branch and `consecutiveFailures` logic are untouched.

### Task 2: Treat unchanged as healthy + tests

- **`src/utils/source-health.ts`** — `computeHealth` degraded rule changed from `if (entry.itemCount === 0) return 'degraded'` to `if (entry.itemCount === 0 && !entry.lastUnchanged) return 'degraded'`. `consecutiveFailures > 0` still checked first (an unchanged-then-failed source stays degraded). Doc-comment updated.
- **`tests/unit/source-health.test.ts`** — added 3 cases:
  - `itemCount: 0, lastUnchanged: true` → `'healthy'`
  - `itemCount: 0, lastUnchanged: true, consecutiveFailures: 1` → `'degraded'`
  - `itemCount: 0, lastUnchanged: true, stale` → `'stale'`
  - Existing `returns degraded when itemCount is 0` test preserved (proves a genuinely empty, non-304 fetch is still degraded).

## Verification

| Check | Result |
|-------|--------|
| `bun run test -- tests/unit/source-health.test.ts` | ✅ 11 passed |
| `bun run typecheck` | ✅ clean |
| `bun run test` (full suite) | ✅ 319 passed / 28 files (no regressions) |

## Must-Haves

- ✅ A 304-unchanged news source with stored news shows 'Healthy' (not 'Degraded')
- ✅ A genuinely failed source (consecutiveFailures > 0) still shows 'Degraded'
- ✅ A genuinely empty fetch (0 items, not 304) still shows 'Degraded'
- ✅ Full unit suite passes with no regressions

## Done

Gap G-09-1 closed. A 304-unchanged source with stored news now projects 'healthy' (or 'stale' when old), while genuinely empty/failed sources remain 'degraded'.
