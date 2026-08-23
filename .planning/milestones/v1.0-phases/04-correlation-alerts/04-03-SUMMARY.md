# 04-03 SUMMARY — Dashboard Alerts Tab + Popup Settings

**Phase:** 04-correlation-alerts · **Plan:** 03 · **Wave:** 3 · **Status:** ✅ Complete

## Goal
Add the dashboard "Alerts" tab (D-08) with a read-only `AlertRecord` list + "Clear all" action (D-10), a `useAlerts` hook that loads cached `alertHistory` and listens for `ALERTS_UPDATED`, and the `alertsEnabled`/`alertCooldownMinutes` settings in the popup Settings UI.

## What Changed

### `src/dashboard/hooks/useAlerts.ts` (new)
- `useAlerts()` returns `{ alerts, loading, error, clearAlerts }`.
- Loads cached `alertHistory` from `browser.storage.local.get(CONFIG.storage.alertHistory)` on mount.
- Listens for `ALERTS_UPDATED` runtime messages and updates `alerts` from `payload.alerts`.
- `clearAlerts()` sends `CLEAR_ALERTS` and clears local state.

### `src/dashboard/components/AlertsTab.tsx` (new)
- `AlertsTabImpl` + `memo` export (mirrors `Watchlist`).
- Renders read-only `AlertRecord` rows: direction badge (bull `#16a34a` ▲ / bear `#dc2626` ▼ / mixed `#6b7280` ◆), market `question`, `topSignalText`/`topNewsHeadline` (2-line clamp), relative timestamp ("2h ago") with absolute tooltip.
- Empty state "No alerts yet" + body; loading "Loading alerts…"; error "Couldn't load alerts." per UI-SPEC copywriting contract.
- De-emphasized destructive "Clear all" button with two-step inline confirm ("Clear all" → "Confirm clear?", reverts after 3s).
- Theme-aware via `isDark` prop.

### `src/dashboard/App.tsx`
- Added `'alerts'` to the `Tab` union.
- Added `['alerts', '🔔 Alerts']` to the tab nav (after Watchlist).
- Wired `useAlerts()` and rendered `<AlertsTab>` in the `activeTab === 'alerts'` block inside the existing `<main>` container.

### `src/popup/components/Settings.tsx`
- Added an "Alerts" `Section` with an `alertsEnabled` checkbox (mirrors theme toggle) and an `alertCooldownMinutes` number input (mirrors collection-interval input), with UI-SPEC helper copy.

### `src/types/index.ts`
- Verified `alertsEnabled` + `alertCooldownMinutes` already present in `ExtensionSettings` and `DEFAULT_SETTINGS` (added in Plan 01) — no change needed.

## Verification
- `bunx tsc --noEmit` → clean for all changed files.
- `bun run test` → **188/188 pass**.
- `bun run build` → **BLOCKED by pre-existing type errors** in untouched prior-phase test files: `tests/unit/index.test.ts` (unused `toIndexable`), `tests/unit/llm-equivalence.test.ts`, `tests/unit/sentiment-equivalence.test.ts`, `tests/unit/zeroshot-equivalence.test.ts` (`'reuters'` not assignable to `NewsSource`; unused `text`). These are NOT in this phase's modified set and predate this work.

## Notes / Deviations
- The `bun run build` gate cannot pass until the pre-existing test-file type errors are resolved. These are outside Phase 4 scope (untouched prior-phase files). Flagged for the post-merge gate.
- No git operations performed — user handles all commits.
