---
phase: 10-cross-source-consensus-alerts
plan: 01
subsystem: alerts
tags: [alerts, correlation, consensus, cross-source, background, dashboard]

requires:
  - phase: 04-correlation-alerts
    provides: alert engine (evaluateAlerts, dispatchAlerts, alertHistory ring buffer, AlertRecord)
  - phase: 06-news-social-correlation
    provides: newsSocialMatches correlation output (NewsSocialCorrelationMatch)

provides:
  - evaluateCrossSourceAlerts engine (clusters newsSocialMatches by shared entity keyword, fires crossSource alerts on >=3 distinct source types with social+news mix, empty-watchlist capable)
  - AlertRecord kind discriminator ('watchlist' | 'crossSource') + crossSource fields (topicLabel, sourceTypes)
  - CONFIG.alerts consensus constants (minConsensusSourceTypes, requireSocialAndNews)
  - runAlertSweep hook combining watchlist + crossSource alerts
  - dispatchAlerts title/id fallback for crossSource records
  - AlertsTab cross-source card rendering + empty-state text

affects: [10-02 edge-case hardening, 10-03 UI polish, dashboard, popup]

actuals:
  tokens: 0
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Discriminated-union AlertRecord via required `kind` field"
    - "Union-find clustering of correlation matches by shared entity keyword"
    - "Distinct source-type counting validated against typed unions"

key-files:
  created:
    - tests/unit/cross-source-alerts.test.ts
  modified:
    - src/types/index.ts
    - src/config/index.ts
    - src/background/alerts.ts
    - src/background/index.ts
    - src/dashboard/components/AlertsTab.tsx
    - tests/unit/alerts.test.ts

key-decisions:
  - "Cross-source alerts are NOT watchlist-scoped — they fire on any topic with >=3 distinct source types (D-06)."
  - "Consensus requires >=3 distinct source types AND >=1 social + >=1 news (D-01)."
  - "Cross-source records share the unified alertHistory with watchlist records (D-04)."
  - "Direction derived from mean signal sentiment; any direction fires (D-03)."
  - "Per-topic cooldown keyed by topicId reuses state.lastNotified (D-08)."

patterns-established:
  - "Pattern: cluster newsSocialMatches by shared entity keyword via union-find, then count distinct source types against typed unions before firing."

requirements-completed: [PHASE-10]

coverage:
  - id: D1
    description: "Cross-source consensus alert fires on >=3 distinct source types (social+news mix) with an empty watchlist"
    requirement: PHASE-10
    verification:
      - kind: unit
        ref: "tests/unit/cross-source-alerts.test.ts#fires a crossSource alert with an EMPTY watchlist"
        status: pass
    human_judgment: false
  - id: D2
    description: "Cross-source alerts persist to the unified alertHistory array"
    requirement: PHASE-10
    verification:
      - kind: unit
        ref: "tests/unit/cross-source-alerts.test.ts#persists the alert to alertHistory"
        status: pass
    human_judgment: false
  - id: D3
    description: "AlertsTab renders cross-source alerts as distinct cards and mentions them in the empty state"
    requirement: PHASE-10
    verification:
      - kind: unit
        ref: "src/dashboard/components/AlertsTab.tsx (crossSource card branch + empty-state text)"
        status: pass
    human_judgment: false

duration: 0min
completed: 2025-01-01
status: complete
---

# Phase 10: Cross-Source Consensus Alerts — Plan 01 Summary

**Delivered the end-to-end cross-source consensus alert path: a `kind: 'crossSource'` alert fires when the same topic appears across >=3 distinct source types (mixing social + news), even with an empty watchlist, reusing the existing `newsSocialMatches` correlation output and the shared alert infrastructure.**

## Performance

- **Duration:** ~30 min
- **Tasks:** 2 completed
- **Files modified:** 6

## Accomplishments
- Added `AlertKind` discriminator and crossSource fields (`topicLabel`, `sourceTypes`) to `AlertRecord`.
- Added `evaluateCrossSourceAlerts` engine that clusters `newsSocialMatches` by shared entity keyword (union-find), counts distinct source types, requires a social+news mix, derives direction from mean sentiment, applies global + per-topic cooldowns, and persists to the unified `alertHistory`.
- Wired `runAlertSweep` to combine watchlist + crossSource alerts before dispatch/broadcast.
- Made `dispatchAlerts` notification id/title safe for crossSource records (falls back to `topicLabel`).
- Updated AlertsTab to render cross-source cards distinctly (topicLabel + "Cross-source" badge + source breakdown) and mention both kinds in the empty state.
- Added 8 unit tests covering the happy path, gating, source-type counting, social/news mix, persistence, cooldown, and direction.

## Task Commits

Commits are handled by the user per the mandatory git rules (no `git commit`/`git add` by the agent).

1. **Task 1: End-to-end cross-source consensus alert engine** — pending user commit
2. **Task 2: Cross-source notification title fallback + AlertsTab rendering** — pending user commit
