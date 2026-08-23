# Phase 4: Correlation Alerts — Research

**Researched:** 2026-08-23
**Confidence:** HIGH
**Scope:** How to implement deduped, throttled, watchlist-scoped, direction-aware `chrome.notifications` alerts that survive the ephemeral MV3 service worker.

---

## 1. MV3 Notification & Alarm APIs

### `chrome.notifications` (via `browser` polyfill)

- **Permission:** Requires the `'notifications'` permission in `manifest.config.ts` `permissions` array. Currently the manifest has `['storage', 'alarms', 'tabs', 'scripting']` — **`notifications` must be added** (both Chrome + Firefox builds share this manifest).
- **Permission check:** `browser.notifications.getPermissionLevel()` returns `'granted'` | `'denied'`. Must check before creating; on `'denied'`, fall back to the toolbar badge + dashboard Alerts tab (D-07).
- **`iconUrl` is REQUIRED:** `chrome.notifications.create()` throws if `iconUrl` is omitted. Must always pass a **packaged** icon via `browser.runtime.getURL('icons/icon-128.png')` — remote URLs are blocked in MV3. The packaged icons exist: `public/icons/icon-128.png`, `icon-16.png`, `icon-32.png`, `icon-48.png`, `icon.svg`.
- **Click handler:** `browser.notifications.onClicked.addListener(...)` — open the dashboard tab (new tab) when clicked. Use `browser.tabs.create({ url: browser.runtime.getURL('dashboard/index.html') })` or reuse the existing new-tab override. Must also handle `onClosed` to clear the notification id.
- **Notification id:** Must be unique per notification. Use a stable-ish id like `trendcast-alert-${contractId}-${timestamp}` so a click can map back to the contract.
- **Firefox differences:** The polyfill (`@/messaging/browser`) normalizes the API, but permission behavior differs — test on both browsers. Firefox may require the notification to be created from the background context (it is).

### `chrome.alarms` (30-second floor)

- MV3 `chrome.alarms` minimum period is **30 seconds** in Chrome. Do not attempt sub-30s alerting.
- The existing `setupAlarms()` (`src/background/index.ts:222-231`) creates the collection alarm `CONFIG.collection.alarmName` with `periodInMinutes: CONFIG.collection.defaultIntervalMinutes` (60). Extend this with a second "alert sweep" alarm.
- **Alert sweep alarm:** A periodic alarm (e.g. every 5–15 min) that re-checks the last stored `CorrelationResult` against `alertState` so alerts still fire even if the worker was killed mid-correlation (ARCHITECTURE.md Pattern 3). This is the worker-survival mechanism — alerts are NOT driven by timers.
- **Coalesce on wake:** When the worker wakes from an alarm, it should check whether a correlation result exists that hasn't been evaluated yet.

---

## 2. Dedup + Throttle Design (anti-fatigue — D-01, D-02, D-06)

### Dedup key

- **Stable key:** `contract.id + signal.id + time-bucket`. Bucket by hour (e.g. `Math.floor(correlatedAt / 3600_000)`). Persist a "last alerted" set in `alertState` so the same correlation never alerts twice.
- **Market-level "new" (D-03):** Alert when the contract's **overall direction** flips OR a **brand-new signal** appears for it — NOT per-signal-pair. So the dedup is primarily at the **market level** (contractId), not per signal.

### Throttle

- **Global max:** 1 alert per N minutes (e.g. 5 min) — a global cooldown timestamp in `alertState`.
- **Per-market cooldown:** Each contract has a cooldown window (e.g. 60 min) before it can alert again. Persist `lastAlertAt` per contract in `alertState`.
- **Respect the 30s floor:** cooldowns are minutes-scale, well above the alarm floor.

### Direction-change trigger (D-01, D-04, D-06)

- Alert only when direction is **new** or **changed** — never on sustained matches.
- **Market-level direction** = combine signal sentiment (aggregate) with Yes-price delta vs prior snapshot:
  - Bullish = positive sentiment AND rising Yes price
  - Bearish = inverse
  - Mixed otherwise
- **Meaningful-band flip threshold (D-06):** only trigger when sentiment crosses ±0.2 OR yesPrice moves >2pts (0.02). Filters minor wobbles.
- **No numeric confidence threshold (D-02):** any new/direction-changed correlation for a watchlisted market qualifies. Do NOT add an `alertThreshold` setting.

---

## 3. Direction Derivation

- **Prior Yes-price (D-05):** Store the last-seen `yesPrice` per contract in `alertState` when we evaluate. Self-contained — no dependency on correlation history retention.
- **Yes-price extraction:** `contract.outcomes.find(o => o.label.toLowerCase() === 'yes')?.price` (0–1).
- **Sentiment:** `SocialSignal.sentiment` is already -1..+1. Aggregate across the contract's correlated signals (mean).
- **Direction computation:**
  ```
  sentimentDelta = currentAggregateSentiment - priorAggregateSentiment (or vs 0 baseline)
  yesPriceDelta = currentYesPrice - priorYesPrice
  if sentimentDelta >= +0.2 && yesPriceDelta > +0.02 → bullish
  if sentimentDelta <= -0.2 && yesPriceDelta < -0.02 → bearish
  else → mixed / no alert
  ```

---

## 4. Alert History Cap (~100)

- **Ring-buffer via `slice(-N)`:** Reuse the `appendHistoryEntry` pattern (`src/background/index.ts:806-858`). Cap alert history at ~100 records.
- **New storage keys:** Add `alertState` and `alertHistory` to `BUDGET_KEYS` in `src/utils/storage.ts:15-25` so pruning accounts for them.
- **`alertState` shape:**
  ```ts
  interface AlertState {
    lastNotified: Record<string, number>;   // contractId → last alert timestamp
    priorYesPrice: Record<string, number>;  // contractId → last-seen yesPrice
    lastGlobalAlertAt: number;              // global throttle timestamp
  }
  ```
- **`alertHistory` shape:** array of `AlertRecord` (see §7), capped at 100 via `slice(-100)`.

---

## 5. Settings Toggle

- Add to `ExtensionSettings` (`src/types/index.ts:449-489`) + `DEFAULT_SETTINGS`:
  - `alertsEnabled: boolean` (default `true`)
  - `alertCooldownMinutes: number` (default `60`)
- The `getSettings()` merge pattern (`{ ...DEFAULT_SETTINGS, ...stored }`, `src/background/index.ts:479-486`) makes new fields safe for existing users — no migration needed.
- Add the toggle + cooldown to the Settings UI (`src/popup/components/Settings.tsx`).

---

## 6. Badge Fallback (D-07, D-09)

- When `getPermissionLevel()` returns `'denied'`, fall back to `browser.action.setBadgeText({ text: String(count) })` on the toolbar icon.
- **Time-based auto-clear (D-09):** badge shows total alerts in the last N hours and auto-clears on a timer, regardless of whether the user opened the Alerts tab. Use a `chrome.alarms` sweep to recompute/clear the badge.
- **"Clear all" (D-10):** resets `alertHistory` and clears the badge.

---

## 7. Dashboard "Alerts" Tab (D-08, D-10)

- **New dedicated tab** in `src/dashboard/App.tsx` (`Tab` union at :52) alongside feed/markets/news/correlations/watchlist/history/community/faq/settings.
- **`useAlerts` hook** (template: `src/dashboard/hooks/useCorrelations.ts`): loads cached `alertHistory` from storage on mount, listens for a new `ALERTS_UPDATED` message.
- **Read-only list + "Clear all"** action (D-10).
- **`AlertRecord` type:**
  ```ts
  interface AlertRecord {
    id: string;                 // unique
    contractId: string;
    platform: MarketPlatform;
    question: string;           // cached for display
    direction: 'bullish' | 'bearish' | 'mixed';
    sentiment: number;          // aggregate
    yesPrice: number;
    topSignalText?: string;     // top correlated signal
    topNewsHeadline?: string;   // top correlated news
    confidence: number;
    alertedAt: number;          // epoch ms
  }
  ```

---

## 8. Integration Points (from CONTEXT.md canonical refs)

| File | Change |
|------|--------|
| `src/manifest.config.ts` | Add `'notifications'` to `permissions` (:186-191) |
| `src/background/alerts.ts` | **NEW** — `evaluateAlerts()` engine + notification dispatch + badge fallback |
| `src/background/index.ts` | Call `evaluateAlerts()` after `runCorrelationPrecompute()` (:690-716) and `runCorrelationAsync()` (:548-614); register alert-sweep alarm in `setupAlarms()` (:222-231); add notification-click handler; add `ALERTS_UPDATED` broadcast |
| `src/config/index.ts` | Add `alertState`/`alertHistory` storage keys + `alertsEnabled`/`alertCooldownMinutes` defaults + alert-sweep alarm name |
| `src/utils/storage.ts` | Add `alertState`/`alertHistory` to `BUDGET_KEYS` (:15-25) |
| `src/types/index.ts` | Add `AlertRecord`, `AlertState`, `alertsEnabled`/`alertCooldownMinutes` to `ExtensionSettings`, `ALERTS_UPDATED` message variant |
| `src/dashboard/App.tsx` | Add "Alerts" tab (:52) |
| `src/dashboard/hooks/useAlerts.ts` | **NEW** — alert state hook (template: `useCorrelations.ts`) |
| `src/dashboard/components/AlertsTab.tsx` | **NEW** — read-only list + "Clear all" |
| `src/popup/components/Settings.tsx` | Add `alertsEnabled` toggle + cooldown |

---

## 9. Key Design Decisions (from CONTEXT.md)

- **D-01:** Alert only on new/direction-changed correlation (primary anti-fatigue).
- **D-02:** No numeric confidence threshold — no `alertThreshold` setting.
- **D-03:** "New" at market level (direction flip OR brand-new signal).
- **D-04:** Direction = signal sentiment + Yes-price delta.
- **D-05:** Prior yesPrice stored in `alertState`.
- **D-06:** Meaningful-band flip threshold (sentiment ±0.2 / yesPrice >2pts).
- **D-07:** Permission-denied fallback = toolbar badge + dashboard Alerts tab.
- **D-08:** Alerts tab is a new dedicated tab.
- **D-09:** Badge shows total alerts in last N hours, time-based auto-clear.
- **D-10:** Alerts tab read-only list + "Clear all".

---

## 10. Pitfalls to Design Against (from PITFALLS.md)

- **Pitfall 1 (alert fatigue + storage bloat):** Dedup + throttle + watchlist scope from the FIRST alert, not retrofitted. Cap history at 100.
- **Pitfall 2 (permission denied / iconUrl missing):** Always pass packaged `iconUrl`; check `getPermissionLevel()`; fall back to badge. Test on Chrome AND Firefox.

---

## Validation Architecture

**Test framework:** Vitest (`vitest run`). Existing unit tests live in `tests/unit/*.test.ts` (e.g. `correlation.test.ts`, `source-health.test.ts`). The alert engine is a pure module (`src/background/alerts.ts`) — unit-testable without a browser.

**Key testable units:**
- `evaluateAlerts()` — pure logic: dedup, throttle, direction derivation, meaningful-band flip, watchlist scoping. Test with synthetic `CorrelationResult` + `alertState` fixtures.
- Direction derivation — sentiment + Yes-price delta → bullish/bearish/mixed; band thresholds (±0.2 sentiment / >2pts yesPrice).
- Alert history cap — `slice(-100)` ring-buffer behavior.
- `BUDGET_KEYS` — `alertState`/`alertHistory` included in storage budget.

**Manual-only verifications (browser APIs):**
- `chrome.notifications.create()` + `getPermissionLevel()` — requires a real extension context; verify on Chrome AND Firefox.
- `chrome.alarms` alert-sweep survival across worker restarts — requires a live MV3 worker.
- Badge fallback (`chrome.action.setBadgeText`) + time-based auto-clear — requires a real toolbar.

**Suggested test files:**
- `tests/unit/alerts.test.ts` — evaluateAlerts dedup/throttle/direction/history-cap logic.
- `tests/unit/alert-direction.test.ts` — direction derivation + band thresholds.

---

*Phase: 4-Correlation Alerts*
*Researched: 2026-08-23*
