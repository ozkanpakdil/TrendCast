---
phase: 13-settings-migration-regression-tests
plan: 01
subsystem: settings
tags: [settings, migration, deep-merge, storage, regression, testing]

# Dependency graph
requires:
  - phase: 11
    provides: the three new stock-indicator source flags (`usaStocksIndicator`, `stockScreener`, `stockScreener2`) in `DEFAULT_SETTINGS.enabledSources`, plus the generic `deepMergeSettings`/`migrateEnabledSources` helpers and their unit tests
  - phase: 12
    provides: end-to-end wiring of the three new sources through config, types, collector, background, dashboard, and popup
provides:
  - Testable storage-I/O layer for settings (`getSettingsFromStorage`, `migrateEnabledSourcesFromStorage`)
  - Integration tests proving the real read → deep-merge → migrate → conditional-write path for the three new flags
  - Full regression suite green (unit + e2e + typecheck)
affects: [future settings changes, source-flag additions, storage refactors]

# Actuals (#2632)
actuals:
  tokens: 4200
  tasks: 2
  commits: 0

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Storage I/O extracted into testable functions taking a narrow `SettingsStorage` interface (structurally satisfied by `browser.storage.local`), enabling integration tests without `vi.mock` of the messaging layer"

key-files:
  created:
    - tests/unit/settings-storage.test.ts
  modified:
    - src/utils/settings.ts
    - src/background/index.ts

key-decisions:
  - "No re-implementation: the pure-function helpers and their unit tests already cover the three new flags; the plan only filled the identified gap (module-private storage I/O wiring had zero direct coverage)."
  - "No behavior change: `getSettings`/`migrateEnabledSourcesDefault` keep their exact signatures and non-fatal try/catch behavior; all call sites unchanged."
  - "No new packages: threat T-13-SC accepted (no install tasks)."

patterns-established:
  - "Storage I/O functions accept a `SettingsStorage` parameter so they are directly unit-testable with an in-memory mock, mirroring the `alerts.test.ts` store pattern."

requirements-completed: [SRC-05]

coverage:
  - id: S1
    description: "Existing users' stored settings get the three new source flags backfilled to `true` through the background `getSettings()` path"
    requirement: SRC-05
    verification:
      - kind: integration
        ref: "tests/unit/settings-storage.test.ts#getSettingsFromStorage backfills the three new source flags to true when absent"
        status: pass
  - id: S2
    description: "An explicit user preference (e.g. `stockScreener: false`) is never overwritten by the deep-merge or the migration"
    requirement: SRC-05
    verification:
      - kind: integration
        ref: "tests/unit/settings-storage.test.ts#getSettingsFromStorage preserves an explicit stockScreener:false while backfilling the other new flags"
        status: pass
      - kind: integration
        ref: "tests/unit/settings-storage.test.ts#migrateEnabledSourcesFromStorage preserves an explicit stockScreener:false in storage while backfilling the other new flags"
        status: pass
  - id: S3
    description: "The migration persists the backfilled flags to storage on update, and is idempotent (no storage write when nothing is missing)"
    requirement: SRC-05
    verification:
      - kind: integration
        ref: "tests/unit/settings-storage.test.ts#migrateEnabledSourcesFromStorage writes the backfilled settings to storage"
        status: pass
      - kind: integration
        ref: "tests/unit/settings-storage.test.ts#migrateEnabledSourcesFromStorage is idempotent — no write when nothing to migrate"
        status: pass
  - id: S4
    description: "The storage I/O wiring in the background is covered by an integration test"
    requirement: SRC-05
    verification:
      - kind: integration
        ref: "tests/unit/settings-storage.test.ts"
        status: pass
  - id: S5
    description: "The full regression suite passes: `bun run test`, `bun run test:e2e`, `bun run typecheck`"
    requirement: SRC-05
    verification:
      - kind: unit
        ref: "bun run test (357 passed)"
        status: pass
      - kind: e2e
        ref: "bun run test:e2e (137 passed)"
        status: pass
      - kind: other
        ref: "bun run typecheck (clean)"
        status: pass

## Accomplishments

- Extracted the storage I/O settings wiring from `src/background/index.ts` into testable functions `getSettingsFromStorage` and `migrateEnabledSourcesFromStorage` in `src/utils/settings.ts`, behind a narrow `SettingsStorage` interface.
- Rewired `getSettings()` and `migrateEnabledSourcesDefault()` in `src/background/index.ts` to delegate to the new functions with identical behavior (signatures and non-fatal try/catch preserved).
- Added `tests/unit/settings-storage.test.ts` with 6 integration tests proving the real read → deep-merge → migrate → conditional-write path for the three new flags, including explicit-preference preservation and idempotency.
- Ran the full regression gate: 357 unit tests, 137 e2e tests, and typecheck all green.
