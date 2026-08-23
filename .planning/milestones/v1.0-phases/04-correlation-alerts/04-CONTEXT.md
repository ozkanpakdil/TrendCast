# Phase 4: Correlation Alerts - Context

**Gathered:** 2026-08-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver correlation alerts via `chrome.notifications` + `chrome.alarms` that are deduped, throttled, and scoped to the user's watchlist, with direction (bullish/bearish) and the top correlated signal/news in the alert body. Alerts must survive the ephemeral MV3 service worker (driven by `chrome.alarms` + persisted `alertState`, not timers), fall back to an in-dashboard badge/panel if notification permission is denied, and keep alert history capped (~100) so storage stays bounded.

**In scope:** Alert engine (`evaluateAlerts`) that runs after correlation completes; `notifications` manifest permission; persisted `alertState` (lastNotified, prior yesPrice, alert history); dedup + throttle (global + per-market cooldown); direction derivation (sentiment + Yes-price delta); watchlist scoping; `chrome.action.setBadgeText` fallback + a new dashboard "Alerts" tab; alert history cap (~100).

**Out of scope:** Market-driven news view (Phase 5), watchlist sort/filter/export (Phase 6), TikTok collector (Phase 7), storage caps / ML quantization (Phase 8). No backend, no cross-device push, no auto-trading.

</domain>

<decisions>
## Implementation Decisions

### Alert Trigger & Threshold
- **D-01:** Alert only when a watchlisted market's correlation is **new** or its **direction changed** — never on sustained matches. This is the primary anti-fatigue mechanism. — **Reversibility:** reversible — local to the alert engine's trigger logic.
- **D-02:** **No numeric confidence threshold** gates an alert. Any new/direction-changed correlation for a watchlisted market qualifies; fatigue is controlled by dedupe + cooldown, not a threshold. Do NOT add an `alertThreshold` setting.
- **D-03:** "New" is defined at the **market level**: alert when the contract's overall direction (aggregate of its correlated signals) flips, OR a brand-new signal appears for it. Not per-signal-pair.
- **D-04:** Market-level direction is computed by combining **signal sentiment with the Yes-price delta** vs a prior snapshot. Bullish = positive sentiment AND rising Yes price; bearish = inverse; mixed otherwise.
- **D-05:** The prior Yes-price comes from **storing the last-seen yesPrice per contract in `alertState`** when we evaluate. Self-contained in the alert engine; no dependency on correlation history retention.
- **D-06:** A direction change only triggers an alert when it **crosses a meaningful band** (e.g. sentiment crosses ±0.2, or yesPrice moves >2pts). Filters out minor wobbles and noise.

### Permission Fallback UI
- **D-07:** When notification permission is denied, fall back to **`chrome.action.setBadgeText` count on the toolbar icon + a new dashboard "Alerts" tab** listing recent alert records. — **Reversibility:** reversible — UI-only, no contract.
- **D-08:** The Alerts tab is a **new dedicated tab** (alongside feed/markets/news/correlations/watchlist/history/community/faq/settings), not a section inside the watchlist tab.
- **D-09:** The toolbar badge shows **total alerts in the last N hours and auto-clears on a timer** (time-based), regardless of whether the user opened the Alerts tab.
- **D-10:** The Alerts tab is a **read-only list plus a "Clear all" action** that removes records and resets the badge.

### the agent's Discretion
The user selected only the Alert trigger & threshold and Permission fallback UI areas. The following areas were identified but NOT discussed — the agent has discretion, but should follow the research (FEATURES.md, PITFALLS.md, ARCHITECTURE.md) which already prescribes:
- **Dedup & throttle policy:** Dedup by a stable key (contract + signal + time-bucket); a global max (e.g. 1 alert per N minutes) + a per-market cooldown; respect the MV3 `chrome.alarms` 30-second floor. Research (PITFALLS.md Pitfall 1) mandates dedup + throttle + watchlist scope designed in from the first alert.
- **Alert history cap:** Cap at ~100 records using the established `slice(-N)` ring-buffer pattern (`appendHistoryEntry` in `src/background/index.ts`). Add the new `alertState`/`alertHistory` keys to `BUDGET_KEYS` in `src/utils/storage.ts` so pruning accounts for them.
- **Settings toggle:** Add an `alertsEnabled` toggle (and cooldown minutes) to `ExtensionSettings` + `DEFAULT_SETTINGS` + the Settings UI. The `getSettings()` merge pattern makes new fields safe for existing users.
- **Notification click handler:** Add a handler to open the dashboard when a notification is clicked.
- **`iconUrl`:** Always pass a packaged icon (`browser.runtime.getURL('icons/icon128.png')`), never a remote URL (blocked in MV3). Check `getPermissionLevel()` before creating.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` §ALERT-01, §ALERT-02 — The requirements this phase delivers: deduped+throttled+watchlist-scoped `chrome.notifications` alerts; direction + top signal/news in the alert body.
- `.planning/ROADMAP.md` §Phase 4 — Goal, success criteria (5 items), depends-on (Phase 3), requirements mapping.

### Research (authoritative on approach)
- `.planning/research/FEATURES.md` — Table-stakes section: dedupe + throttle + watchlist-scoping are the minimum for usability; direction from `signal.sentiment` + Yes-price delta; alert payload = market + direction + top signal/news + confidence.
- `.planning/research/PITFALLS.md` §Pitfall 1 (alert fatigue + storage bloat) and §Pitfall 2 (permission denied / `iconUrl` missing) — The two critical pitfalls this phase must design against from day one.
- `.planning/research/ARCHITECTURE.md` §Pattern 3 (Ephemeral-Worker-Safe Alert Detection) — The `evaluateAlerts` design: runs after correlation, reads prior `alertState` from storage, detects new/strong matches, writes new state, fires `chrome.notifications`; a separate `chrome.alarms` "alert sweep" re-checks the last stored correlation result so alerts still fire if the worker was killed mid-correlation.

### Existing Code (the machinery to build on)
- `src/background/index.ts` — The orchestrator. `runCorrelationPrecompute()` (:690-716) and `runCorrelationAsync()` (:548-614) are the two correlation-completion hook points where `evaluateAlerts` should be called. `setupAlarms()` (:222-231) is the existing `chrome.alarms` pattern to extend. `appendHistoryEntry()` (:806-858) is the `slice(-N)` capped-array pattern for alert history. `getSettings()` (:479-486) is the settings-merge pattern.
- `src/types/index.ts` — `CorrelationResult` (:262-290), `CorrelationMatch`/`NewsCorrelationMatch` (:238-261), `MarketContract` (:20-44, yes-price via `outcomes.find(o => o.label.toLowerCase() === 'yes')?.price`), `SocialSignal` (:57-75, `sentiment` -1..+1), `NewsItem` (:113-124), `WatchlistEntry` (:452-466), `ExtensionSettings` (:449-489).
- `src/config/index.ts` — `CONFIG.storage.watchlist` (:205), `CONFIG.storage.settings` (:194), `CONFIG.collection.alarmName`/`defaultIntervalMinutes` (:186-187). New alert storage keys + settings defaults go here.
- `src/manifest.config.ts` — Permissions (:186-191). **`notifications` must be added** (currently only storage/alarms/tabs/scripting).
- `src/utils/storage.ts` — `BUDGET_KEYS` (:15-25) must gain the new `alertState`/`alertHistory` keys so pruning accounts for them.
- `src/messaging/browser.ts` — The `webextension-polyfill` re-export; `browser.notifications` maps to `chrome.notifications` in Chrome and native in Firefox.
- `src/dashboard/App.tsx` — Dashboard tabs (:52); `useCorrelations` hook (`src/dashboard/hooks/useCorrelations.ts`) is the template for a `useAlerts` hook; `Settings` component (`src/popup/components/Settings.tsx`) is where the `alertsEnabled` toggle lives.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `setupAlarms()` in `src/background/index.ts:222-231`: the existing `chrome.alarms` pattern to extend with an "alert sweep" alarm.
- `appendHistoryEntry()` in `src/background/index.ts:806-858`: the `slice(-N)` capped-array / ring-buffer pattern to reuse for alert history (~100).
- `getSettings()` in `src/background/index.ts:479-486`: the settings-merge pattern (`{ ...DEFAULT_SETTINGS, ...stored }`) that makes new settings fields safe for existing users.
- `useCorrelations` hook (`src/dashboard/hooks/useCorrelations.ts`): the template for a `useAlerts` hook (loads cached state on mount, listens for messages).
- `WatchlistEntry` (`src/types/index.ts:452-466`): the watchlist scope mechanism (contractId + platform) — no separate toggle needed.

### Established Patterns
- **Alarm-driven scheduling, not timers:** MV3 worker is ephemeral; all recurring work goes through `chrome.alarms` + persisted state. The alert engine must follow this.
- **Storage-as-state:** `chrome.storage.local` is the source of truth; `alertState` must be persisted there.
- **Capped arrays via `slice(-N)`:** the established idiom for bounded history (used in `appendHistoryEntry`, `persistRunStats`).
- **Settings merge for forward-compat:** new `ExtensionSettings` fields are automatically safe via `getSettings()`.
- **One-file-per-engine / module convention:** a new `src/background/alerts.ts` module for the alert engine follows the codebase shape.

### Integration Points
- `src/background/index.ts` — call `evaluateAlerts()` after `runCorrelationPrecompute()` and `runCorrelationAsync()` complete; register the alert-sweep alarm in `setupAlarms()`; add notification-click handler.
- `src/manifest.config.ts` — add the `notifications` permission.
- `src/config/index.ts` — add alert storage keys + `alertsEnabled`/cooldown defaults.
- `src/utils/storage.ts` — add `alertState`/`alertHistory` to `BUDGET_KEYS`.
- `src/dashboard/App.tsx` — add the new "Alerts" tab + `useAlerts` hook; add `alertsEnabled` toggle to the Settings component.

</code_context>

<specifics>
## Specific Ideas

- The user emphasized **anti-fatigue as the top priority**: alert only on new/direction-changed correlations, no numeric threshold, and rely on dedupe + cooldown rather than a confidence gate.
- The user wants **market-level direction** (aggregate of signals + Yes-price delta), not per-signal alerts — a market-level view of what's moving.
- The user wants a **meaningful-band flip threshold** (sentiment ±0.2 / yesPrice >2pts) to filter out noise.
- The user wants a **dedicated Alerts tab** with a time-based auto-clearing toolbar badge and a "Clear all" action.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 4-Correlation Alerts*
*Context gathered: 2026-08-22*
