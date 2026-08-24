---
phase: 09-news-source-fix
verified: 2026-08-24T00:00:00Z
status: passed
score: 11/11 must-haves verified
behavior_unverified: 0 # all 3 runtime truths confirmed by human UAT (tests 2-4 passed 2026-08-24)
overrides_applied: 0
gaps: []
behavior_unverified_items:
  - truth: "Existing users see Seeking Alpha and Investing.com headlines in the news tab (deep-merge defaults those flags to true)"
    test: "Install the extension with pre-existing saved settings missing seekingalpha/investing, run 'Collect now', and open the News tab"
    expected: "Seeking Alpha and Investing.com headlines appear in the populated grid"
    why_human: "The deep-merge is wired into getSettings() and runCollection() pushes seekingalpha/investing when truthy, and NewsFeed renders all 6 sources — but the full collection→render path requires a live extension run (network fetch + storage + render). No test exercises the end-to-end runtime behavior; the unit test only proves the merge produces the flags."
  - truth: "Existing users' saved settings are migrated on load to backfill any missing source flags, so the fix persists across restarts"
    test: "Update the extension from a version with stale settings (missing seekingalpha/investing/googleFinance) and inspect chrome.storage.local after the onInstalled update event"
    expected: "The stored settings object now contains seekingalpha/investing/googleFinance = true, and the fix survives a restart"
    why_human: "migrateEnabledSourcesDefault() is wired into the update branch of setupInstallHandler() and persists via browser.storage.local.set, and the pure helper is unit-tested — but the onInstalled update event firing and the storage write require a real extension update cycle. No test exercises the runtime event."
  - truth: "A user who never touched the seekingalpha/investing toggles sees them checked (ON) in the popup after the fix"
    test: "Open the popup with pre-existing saved settings missing the newer flags"
    expected: "The Seeking Alpha and Investing.com toggle rows render checked (ON)"
    why_human: "useSettings.load() deep-merges and Settings.tsx renders the toggle rows, but the checked state at runtime is not exercised by a test — only the merge producing true is unit-proven."
human_verification:
  - test: "Open the News tab and verify the partial, long-text, overflow, zero-one-many, loading, and error states are unchanged"
    expected: "All 6 protected UI states render exactly as before the fix (deep-merge does not touch rendering)"
    why_human: "These are visual UI states that cannot be verified by grep or unit tests; the phase did not modify NewsFeed.tsx, but the states themselves require manual visual confirmation"
---

# Phase 9: News Source Fix Verification Report

**Phase Goal:** Existing users see Seeking Alpha and Investing.com headlines in the news tab even with pre-existing saved settings
**Verified:** 2026-08-23T18:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth   | Status     | Evidence       |
| --- | ------- | ---------- | -------------- |
| 1   | Existing users see Seeking Alpha and Investing.com headlines in the news tab (deep-merge defaults those flags to true) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `deepMergeSettings` wired into `getSettings()` (background/index.ts:900); `runCollection()` pushes `seekingalpha`/`investing` into `newsSources` when truthy (index.ts:522-527); `NewsFeed.tsx` renders all 6 sources. Unit test proves merge yields flags true. No end-to-end runtime test. |
| 2   | User's saved settings are migrated on load to backfill any missing source flags, so the fix persists across restarts | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `migrateEnabledSourcesDefault()` wired into `update` branch of `setupInstallHandler()` (index.ts:496), persists via `browser.storage.local.set`. Pure helper unit-tested. `onInstalled` event not exercised by a test. |
| 3   | User's existing enabled/disabled source choices are preserved (deep-merge never overwrites an explicit user preference) | ✓ VERIFIED | Unit tests: `settings-deep-merge.test.ts` (explicit `seekingalpha:false` preserved), `settings-migration.test.ts` (explicit preference never flipped). |
| 4   | Regression unit tests prove the deep-merge + migration behavior (NEWS-03) | ✓ VERIFIED | 18 tests pass across both files; full unit suite 316 tests / 28 files pass. |
| 5   | A user who never touched the seekingalpha/investing toggles sees them checked (ON) in the popup after the fix | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `useSettings.load()` deep-merges (useSettings.ts:22); `Settings.tsx` renders toggle rows (lines 206-207). Merge→true unit-proven; runtime checked state not tested. |
| 6   | The news tab's populated grid renders all 6 sources via VirtualizedGrid with per-source tile colors (unchanged) | ✓ VERIFIED | `NewsFeed.tsx`: `sourceLabels` has all 6, `palette` has all 6 distinct colors, `VirtualizedGrid` used (line 72). Structural presence confirmed. |
| 7   | The news tab's empty state still renders 'No news collected yet. Wait for the next hourly collection.' (unchanged) | ✓ VERIFIED | `NewsFeed.tsx:66` — exact string present. |
| 8   | The news tab's partial, long-text, overflow, zero-one-many, loading, and error states are unchanged | ? HUMAN | Visual UI states; phase did not modify `NewsFeed.tsx`, but states require manual confirmation. |
| 9   | The migration is silent (no user-facing message) and never overwrites an explicit user preference | ✓ VERIFIED | `migrateEnabledSources` only adds missing keys; unit test proves explicit `seekingalpha:false` preserved. No user-facing message in code. |
| 10  | The migration is idempotent — running it repeatedly produces the same result | ✓ VERIFIED | Unit test: second run on migrated result returns `null`. |
| 11  | The migration runs on extension update (mirroring the existing migrateTikTokDefault pattern) | ✓ VERIFIED | `migrateEnabledSourcesDefault()` called only in `update` branch of `setupInstallHandler()` (index.ts:496), not on fresh `install`. |

**Score:** 7/11 truths verified (3 present, behavior-unverified; 1 human visual)

### Required Artifacts

| Artifact | Expected    | Status | Details |
| -------- | ----------- | ------ | ------- |
| `src/utils/settings.ts` | deepMergeSettings + migrateEnabledSources | ✓ VERIFIED | Both pure helpers exported; no browser/CONFIG imports; guarded against non-object `enabledSources`. |
| `src/background/index.ts` | getSettings() calls deepMergeSettings; migrateEnabledSourcesDefault() wired into update branch | ✓ VERIFIED | index.ts:900 (`deepMergeSettings`), index.ts:496 (`migrateEnabledSourcesDefault` in update branch). |
| `src/dashboard/App.tsx` | settings load calls deepMergeSettings | ✓ VERIFIED | App.tsx:108 `const merged = deepMergeSettings(DEFAULT_SETTINGS, s);` |
| `src/popup/hooks/useSettings.ts` | load() calls deepMergeSettings | ✓ VERIFIED | useSettings.ts:22 `setSettings(deepMergeSettings(DEFAULT_SETTINGS, stored));` |
| `tests/unit/settings-deep-merge.test.ts` | regression coverage | ✓ VERIFIED | 9 tests, all pass. |
| `tests/unit/settings-migration.test.ts` | regression coverage | ✓ VERIFIED | 9 tests, all pass. |

### Key Link Verification

| From | To  | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| `getSettings()` (background) | `deepMergeSettings` | import + call at index.ts:900 | WIRED | Collection path fixed. |
| `runCollection()` | `enabledSources` flags | reads `settings.enabledSources`, pushes seekingalpha/investing when truthy (index.ts:522-527) | WIRED | Headlines get collected. |
| Dashboard `App.tsx` settings load | `deepMergeSettings` | import + call at App.tsx:108 | WIRED | News tab displays collected sources. |
| Popup `useSettings.ts` load | `deepMergeSettings` | import + call at useSettings.ts:22 | WIRED | Toggles render checked. |
| `setupInstallHandler()` update branch | `migrateEnabledSourcesDefault()` | call at index.ts:496 | WIRED | Migration persists backfilled flags. |
| `migrateEnabledSourcesDefault()` | `migrateEnabledSources` (pure) | import + call at index.ts:938 | WIRED | Pure helper drives the write. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `NewsFeed.tsx` grid | `news` items | `getCollectedNews()` → storage → collection | Yes (real collection pipeline) | ✓ FLOWING |
| `Settings.tsx` toggles | `settings.enabledSources` | `useSettings.load()` → `deepMergeSettings` → storage | Yes (real stored settings) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| deep-merge + migration unit tests | `bun run test -- tests/unit/settings-deep-merge.test.ts tests/unit/settings-migration.test.ts` | 18 passed (2 files) | ✓ PASS |
| Full unit suite (no regressions) | `bun run test` | 316 passed (28 files) | ✓ PASS |
| Typecheck | `bun run typecheck` | clean (tsc --noEmit) | ✓ PASS |
| End-to-end collection→render | — | requires live extension run | ? SKIP (human) |
| onInstalled update migration | — | requires real extension update | ? SKIP (human) |

### Probe Execution

No probes declared in PLAN/SUMMARY for this phase. SKIPPED.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| NEWS-01 | 09-01 | User can see Seeking Alpha and Investing.com headlines in the news tab even with pre-existing saved settings (deep-merge `enabledSources` so newer source flags default to `true`) | ✓ SATISFIED | `deepMergeSettings` wired into all 3 load sites; unit test proves flags default true. |
| NEWS-02 | 09-02 | Existing users' settings are migrated to backfill missing source flags (settings migration) | ✓ SATISFIED | `migrateEnabledSources` + `migrateEnabledSourcesDefault` wired into update handler; unit tested. |
| NEWS-03 | 09-03 | Regression coverage proves the deep-merge fix (unit tests) | ✓ SATISFIED | 18 tests pass; full suite 316 passes. |

All 3 requirement IDs (NEWS-01/02/03) are accounted for. No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | none | — | No TBD/FIXME/XXX/PLACEHOLDER markers, no console.log-only implementations, no stub returns in any phase-modified file. |

### Human Verification Required

1. **End-to-end collection → render (SC1)**
   - **Test:** Install the extension with pre-existing saved settings missing `seekingalpha`/`investing`, run "Collect now", open the News tab.
   - **Expected:** Seeking Alpha and Investing.com headlines appear in the populated grid.
   - **Why human:** The deep-merge is wired into `getSettings()` and `runCollection()` pushes those sources when truthy, and `NewsFeed` renders all 6 sources — but the full collection→render path requires a live extension run (network fetch + storage + render). No test exercises the end-to-end runtime behavior.

2. **Migration on extension update (SC2)**
   - **Test:** Update the extension from a version with stale settings (missing the newer flags) and inspect `chrome.storage.local` after the `onInstalled` update event.
   - **Expected:** Stored settings now contain `seekingalpha`/`investing`/`googleFinance = true`, and the fix survives a restart.
   - **Why human:** `migrateEnabledSourcesDefault()` is wired into the update branch and persists via `browser.storage.local.set`, and the pure helper is unit-tested — but the `onInstalled` update event firing and storage write require a real extension update cycle.

3. **Popup toggles checked (09-01 T2)**
   - **Test:** Open the popup with pre-existing saved settings missing the newer flags.
   - **Expected:** The Seeking Alpha and Investing.com toggle rows render checked (ON).
   - **Why human:** `useSettings.load()` deep-merges and `Settings.tsx` renders the toggle rows, but the runtime checked state is not exercised by a test.

4. **Protected UI states unchanged (09-01 T6)**
   - **Test:** Open the News tab and verify the partial, long-text, overflow, zero-one-many, loading, and error states.
   - **Expected:** All 6 protected states render exactly as before the fix.
   - **Why human:** Visual UI states that cannot be verified by grep or unit tests; the phase did not modify `NewsFeed.tsx`, but the states require manual visual confirmation.

### Gaps Summary

No blocking gaps found. The implementation is complete and correctly wired:

- `deepMergeSettings` exists in `src/utils/settings.ts` and is wired into all three settings load sites (background `getSettings`, dashboard `App.tsx`, popup `useSettings.ts`).
- `migrateEnabledSources` exists and `migrateEnabledSourcesDefault()` is wired into the `update` branch of `setupInstallHandler()`, persisting backfilled flags.
- All 18 regression tests pass; the full unit suite (316 tests) passes with no regressions; typecheck is clean.
- No shallow `{ ...DEFAULT_SETTINGS, ...stored }` spread of `enabledSources` remains in any of the three load sites.
- All 3 requirement IDs (NEWS-01/02/03) are satisfied.

The 3 behavior-unverified truths and 1 visual-state item require human confirmation of the live runtime behavior (collection→render, onInstalled migration, popup toggle checked state, and protected UI states). These are not code gaps — the code is present and wired — but the runtime behavior is not exercised by any automated test.

---

_Verified: 2026-08-23T18:30:00Z_
_Verifier: the agent (gsd-verifier)_
