---
phase: 09-news-source-fix
plan: 03
subsystem: testing
tags: [testing, regression, deep-merge, migration]

# Dependency graph
requires:
  - phase: 09-news-source-fix
    provides: deepMergeSettings + migrateEnabledSources helpers
provides:
  - "Full deep-merge regression matrix (9 cases)"
  - "Full migration regression matrix (9 cases)"
  - "Full unit suite green (316 tests, 28 files)"
affects: []

# Actuals
actuals:
  tokens: 0
  tasks: 2
  commits: 0

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Regression matrix: explicit-off + default-on, non-mutation, idempotency, partial backfill"

key-files:
  created: []
  modified:
    - tests/unit/settings-deep-merge.test.ts
    - tests/unit/settings-migration.test.ts

key-decisions:
  - "Deep-merge matrix proves non-mutation (new reference, defaults/stored untouched) and mixed explicit-off + default-on"
  - "Migration matrix proves idempotency (second run returns null), partial backfill, and non-mutation"

patterns-established:
  - "Pattern: regression tests assert concrete output values, not just 'does not throw'"

requirements-completed: [NEWS-03]

coverage:
  - id: D1
    description: "Deep-merge regression matrix proves newer source flags default true, explicit preferences preserved, non-mutating"
    requirement: NEWS-03
    verification:
      - kind: unit
        ref: "tests/unit/settings-deep-merge.test.ts"
        status: pass
  - id: D2
    description: "Migration regression matrix proves backfill, preservation, idempotency, non-mutation"
    requirement: NEWS-03
    verification:
      - kind: unit
        ref: "tests/unit/settings-migration.test.ts"
        status: pass
  - id: D3
    description: "Full unit suite passes with no regressions"
    requirement: NEWS-03
    verification:
      - kind: unit
        ref: "bun run test"
        status: pass
