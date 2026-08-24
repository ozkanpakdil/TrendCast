---
phase: 09-news-source-fix
plan: 02
subsystem: settings
tags: [settings, migration, enabledSources, install-handler]

# Dependency graph
requires:
  - phase: 09-news-source-fix
    provides: deepMergeSettings helper in src/utils/settings.ts
provides:
  - "migrateEnabledSources() pure helper in src/utils/settings.ts"
  - "migrateEnabledSourcesDefault() wired into background update handler"
  - "Unit test coverage for migrateEnabledSources"
affects: [09-03 (regression matrix)]

# Actuals
actuals:
  tokens: 0
  tasks: 2
  commits: 0

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure, idempotent migration helper (mirrors backfillWatchlist / migrateTikTokDefault)"

key-files:
  created:
    - tests/unit/settings-migration.test.ts
  modified:
    - src/utils/settings.ts
    - src/background/index.ts

key-decisions:
  - "migrateEnabledSources backfills as { ...DEFAULT_SETTINGS.enabledSources, ...storedEnabled } — defaults fill missing keys, present stored keys win (never overwrites a preference)"
  - "Returns null when nothing to migrate (undefined stored, non-object enabledSources, or no missing keys) so the caller skips the write"
  - "Migration runs only on extension update (not fresh install), mirroring migrateTikTokDefault, wrapped in try/catch non-fatal warning"

patterns-established:
  - "Pattern: migrateEnabledSources(stored) — pure idempotent backfill returning null when unchanged"

requirements-completed: [NEWS-02]

coverage:
  - id: D1
    description: "migrateEnabledSources backfills missing source flags into stored settings, preserving explicit preferences, idempotently"
    requirement: NEWS-02
    verification:
      - kind: unit
        ref: "tests/unit/settings-migration.test.ts"
        status: pass
  - id: D2
    description: "Background update handler persists the backfilled settings via migrateEnabledSourcesDefault()"
    requirement: NEWS-02
    verification:
      - kind: unit
        ref: "tests/unit/settings-migration.test.ts"
        status: pass
