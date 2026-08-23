---
phase: 04-correlation-alerts
reviewed: 2026-08-22T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - src/background/alerts.ts
  - src/background/index.ts
  - src/config/index.ts
  - src/types/index.ts
  - src/utils/storage.ts
  - src/manifest.config.ts
  - src/dashboard/hooks/useAlerts.ts
  - src/dashboard/components/AlertsTab.tsx
  - src/dashboard/App.tsx
  - src/popup/components/Settings.tsx
findings:
  critical: 0
  warning: 1
  info: 3
  total: 4
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-08-22
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Reviewed the Phase 4 (Correlation Alerts) implementation: the pure alert engine (`src/background/alerts.ts`), its background integration (`src/background/index.ts`), the config/types/storage/manifest data foundation, and the two UI surfaces (dashboard `AlertsTab` + `useAlerts` hook, popup `Settings` Alerts section).

The core design is sound and well-documented. The engine is a clean read-modify-write over `chrome.storage.local` that correctly implements the design decisions from `04-CONTEXT.md`: D-01 (new/direction-changed only, never sustained matches), D-02 (no confidence gate), D-03 (market-level "new"), D-04/D-05 (direction from sentiment + Yes-price delta vs `priorYesPrice`), D-06 (meaningful-band flip), D-07 (notification permission gate with badge fallback), D-09 (time-window badge auto-clear), and D-10 (clear + broadcast). The `deriveDirection` pure function is cleanly separated and unit-tested in isolation. The `getPermissionLevel` feature-detect + cast is a correct workaround for the missing `@types/webextension-polyfill` definition. The packaged `iconUrl` (`browser.runtime.getURL('icons/icon-128.png')`) is verified to exist and be declared in the manifest.

The test coverage is strong: 31 tests in `alerts.test.ts` (dedup, no-confidence-gate, market-level new, direction, prior-price, band flip, watchlist scoping, global + per-market throttle, history cap, persistence, BUDGET_KEYS, dispatch/badge/clear/broadcast/history) plus 7 in `alert-direction.test.ts`. The `@/messaging/browser` mock with an in-memory `store` Map is a clean pattern.

The only genuine concern is a narrow read-modify-write race in `evaluateAlerts` when two sweeps overlap (alarm + post-correlation). The remaining findings are informational.

## Warnings

### WR-01: `evaluateAlerts` read-modify-write on alert state is not concurrency-safe across overlapping sweeps

**File:** `src/background/alerts.ts:150-152, 260-266`
**Issue:** `evaluateAlerts` reads `state` and `history` via `Promise.all`, mutates `state` in the loop, then writes both back. `runAlertSweep` is invoked from two independent paths: the alert-sweep alarm (`setupAlarms`) and after each correlation completes (`runCorrelationAsync` / `runCorrelationPrecompute`). Because the MV3 worker is single-threaded, these can interleave at the `await` points: sweep A reads state, sweep B reads the same state, both compute, and the last writer clobbers the other's `lastNotified`/`priorYesPrice`/history. The consequence is a possible duplicate alert or a lost `lastNotified` update — low severity, but a genuine correctness gap in a read-modify-write pattern.
**Fix:** Serialize sweeps with a module-level promise chain (e.g., `let sweepChain = Promise.resolve(); function runAlertSweep() { sweepChain = sweepChain.then(doSweep); return sweepChain; }`), or guard `evaluateAlerts` with a simple in-flight flag. Given the sweep is quick and the window is narrow, this is a hardening improvement rather than a blocking defect.

## Info

### IN-01: `setTimeout` in `AlertsTab.handleClear` has no cleanup on unmount

**File:** `src/dashboard/components/AlertsTab.tsx:52-58`
**Issue:** The 3s confirm-revert `setTimeout(() => setConfirming(false), 3000)` is not cleared if the component unmounts (e.g., the user switches tabs) before it fires. React 18+ handles the post-unmount `setState` gracefully (no warning), so this is cosmetic, but a `useRef` + `clearTimeout` in a cleanup effect would be tidier.
**Fix:** Optional — store the timer id in a ref and clear it in a `useEffect` cleanup.

### IN-02: `useAlerts.clearAlerts` double-clears local state

**File:** `src/dashboard/hooks/useAlerts.ts:44-52`
**Issue:** The hook's `clearAlerts` calls `setAlerts([])` locally AND the background `CLEAR_ALERTS` handler broadcasts `ALERTS_UPDATED` with an empty list, which the `ALERTS_UPDATED` listener also applies. The result is correct (both paths converge on `[]`), just redundant. Harmless.
**Fix:** Optional; rely solely on the broadcast, or drop the local `setAlerts([])`.

### IN-03: `dispatchAlerts` awaits `notifications.create` sequentially

**File:** `src/background/alerts.ts:283-296`
**Issue:** The loop `for (const record of records) { await browser.notifications.create(...) }` serializes notification creation. Given the global (5 min) and per-market (60 min) throttles, a single sweep produces at most a handful of alerts, so this is not a practical bottleneck. Noted for completeness.
**Fix:** Optional; `Promise.all` the creates if a large batch ever becomes possible.

---

_Reviewed: 2026-08-22_
_Reviewer: the agent (gsd-code-reviewer, inline fallback)_
_Depth: standard_
