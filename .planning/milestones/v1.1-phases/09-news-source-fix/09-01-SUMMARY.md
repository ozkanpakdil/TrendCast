---
phase: 09-news-source-fix
plan: 01
subsystem: settings
tags: [settings, deep-merge, enabledSources, news-sources]

# Dependency graph
requires: []
provides:
  - "deepMergeSettings() pure helper in src/utils/settings.ts"
  - "Deep-merge wired into all three settings load sites (background getSettings, dashboard App.tsx, popup useSettings.ts)"
  - "Unit test coverage for deepMergeSettings"
affects: [09-02 (migration), 09-03 (regression matrix)]

# Actuals
actuals:
  tokens: 0
  tasks: 2
  commits: 0

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure, storage-free settings helper module (mirrors backfillWatchlist pattern)"

key-files:
  created:
    - src/utils/settings.ts
    - tests/unit/settings-deep-merge.test.ts
  modified:
    - src/background/index.ts
    - src/dashboard/App.tsx
    - src/popup/hooks/useSettings.ts

key-decisions:
  - "Deep-merge only enabledSources; all other top-level fields use shallow spread (only the nested source-flag object needs backfilling)"
  - "Guard deep-merge against non-object stored.enabledSources (corruption) by falling back to defaults.enabledSources"
  - "Keep settings.ts pure (no browser/CONFIG imports) so it is trivially unit-testable"

patterns-established:
  - "Pattern: deepMergeSettings(defaults, stored) — shallow top-level merge + deep enabledSources merge, present keys win"

requirements-completed: [NEWS-01]

coverage:
  - id: D1
    description: "deepMergeSettings backfills missing enabledSources flags (seekingalpha/investing/googleFinance) to true while preserving explicit user preferences"
    requirement: NEWS-01
    verification:
      - kind: unit
        ref: "tests/unit/settings-deep-merge.test.ts"
        status: pass
  - id: D2
    description: "All three settings load sites (background getSettings, dashboard App.tsx, popup useSettings.ts) read settings through deepMergeSettings"
    requirement: NEWS-01
    verification:
      - kind: unit
        ref: "tests/unit/settings-deep-merge.test.ts"
        status: pass
