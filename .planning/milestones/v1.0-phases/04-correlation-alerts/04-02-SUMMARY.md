# 04-02 SUMMARY — Background Integration

**Phase:** 04-correlation-alerts · **Plan:** 02 · **Wave:** 2 · **Status:** ✅ Complete

## Goal
Wire the alert engine (`evaluateAlerts` from 04-01) into the background orchestrator so alerts fire after correlation completes and on a periodic sweep, with notification dispatch, badge fallback, and clear/broadcast plumbing.

## What Changed

### `src/manifest.config.ts`
- Added `'notifications'` to the `permissions` array (was `['storage', 'alarms', 'tabs', 'scripting']`).

### `src/background/alerts.ts`
- Added `getAlertHistory()` — reads the persisted capped history.
- Added `broadcastAlerts(records)` — fire-and-forget `ALERTS_UPDATED` runtime message (mirrors `CORRELATION_RESULT` pattern).
- Added `updateBadge(now?)` — sets the toolbar badge to the count of alerts within `CONFIG.alerts.badgeWindowHours`; auto-clears as alerts age out (D-09). Accepts an optional `now` for testability.
- Added `clearAlerts()` — resets `alertHistory` + `alertState`, clears the badge, broadcasts an empty list (D-10).
- Added `dispatchAlerts(records)` — checks `getPermissionLevel()`; on `'granted'` calls `notifications.create()` with a packaged `iconUrl` (`browser.runtime.getURL('icons/icon-128.png')`, never remote — D-07); on `'denied'`/unavailable falls back to `updateBadge()`. Feature-detects `getPermissionLevel` (missing from `@types/webextension-polyfill`).

### `src/background/index.ts`
- Imported `evaluateAlerts, dispatchAlerts, broadcastAlerts, clearAlerts, updateBadge, getAlertHistory`.
- `setupAlarms()`: added the alert-sweep alarm (`CONFIG.alerts.alarmName`, `periodInMinutes: CONFIG.alerts.sweepIntervalMinutes`) and a branch in `onAlarm` that calls `runAlertSweep()`.
- Added `runAlertSweep()` — re-reads the last stored `CorrelationResult`, loads watchlist + settings, calls `evaluateAlerts`, dispatches + broadcasts new alerts, and refreshes the badge. Survives the ephemeral MV3 worker (no timers).
- Hooked `runAlertSweep()` after `runCorrelationPrecompute()` stores its result and after `runCorrelationAsync()` stores + broadcasts (ALERT-01).
- `setupInstallHandler()`: added `browser.notifications.onClicked` listener that opens the dashboard for `trendcast-alert-*` notifications.
- `setupMessageHandlers()`: added `CLEAR_ALERTS` handler calling `clearAlerts()`.

### `tests/unit/alerts.test.ts`
- Extended the `@/messaging/browser` mock with `notifications`, `action`, and `runtime`.
- Added suites for `dispatchAlerts` (granted → create; denied → badge fallback), `updateBadge` (count within window; clear when aged out), `clearAlerts` (reset + broadcast empty), `broadcastAlerts`, and `getAlertHistory`.

## Verification
- `bun run test tests/unit/alerts.test.ts tests/unit/alert-direction.test.ts` → **31/31 pass**.
- Full unit suite → **188/188 pass** (was 180; +8 new tests).
- `bunx tsc --noEmit` → clean for all changed files (only pre-existing test-file errors remain, unrelated to this phase).

## Notes / Deviations
- `getPermissionLevel` is a real browser API but absent from `@types/webextension-polyfill`; feature-detected + cast rather than relying on the missing type.
- `updateBadge` takes an optional `now` param so tests can pin time (consistent with `evaluateAlerts`).
- No git operations performed — user handles all commits.
