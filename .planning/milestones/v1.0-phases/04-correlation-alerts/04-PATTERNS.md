# Phase 4: Correlation Alerts — Pattern Map

**Mapped:** 2026-08-23
**Files analyzed:** 11 (5 new, 6 modified)
**Analogs found:** 10 / 11

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/background/alerts.ts` (NEW) | service/engine | event-driven | `src/background/index.ts` (appendHistoryEntry, getSettings) | role-match |
| `src/background/index.ts` | orchestrator | event-driven | itself (existing hook points) | exact |
| `src/types/index.ts` | model | — | itself (CorrelationResult, ExtensionSettings, Message) | exact |
| `src/config/index.ts` | config | — | itself (CONFIG.storage, CONFIG.collection) | exact |
| `src/utils/storage.ts` | utility | — | itself (BUDGET_KEYS) | exact |
| `src/manifest.config.ts` | config | — | itself (permissions array) | exact |
| `src/dashboard/App.tsx` | component | request-response | itself (Tab union + tab rendering) | exact |
| `src/dashboard/hooks/useAlerts.ts` (NEW) | hook | event-driven | `src/dashboard/hooks/useCorrelations.ts` | exact |
| `src/dashboard/components/AlertsTab.tsx` (NEW) | component | request-response | `src/dashboard/components/Watchlist.tsx` | role-match |
| `src/popup/components/Settings.tsx` | component | request-response | itself (Section + toggle pattern) | exact |
| `tests/unit/alerts.test.ts` (NEW) | test | — | `tests/unit/source-health.test.ts` | exact |

---

## Pattern Assignments

### `src/background/alerts.ts` (NEW — service/engine, event-driven)

**Analog:** `src/background/index.ts` — `appendHistoryEntry()` (:806-858), `getSettings()` (:479-486), `setupAlarms()` (:222-231)

**Imports pattern** (from `src/background/index.ts:1-20`):
```typescript
import { browser } from '@/messaging/browser';
import { CONFIG } from '@/config';
import type { CorrelationResult, ExtensionSettings, MarketContract, SocialSignal, NewsItem } from '@/types';
```

**Settings-merge pattern** (from `src/background/index.ts:479-486`) — use to read `alertsEnabled`/`alertCooldownMinutes` safely:
```typescript
/** Get extension settings (merged with defaults for forward-compat). */
async function getSettings(): Promise<ExtensionSettings> {
  const result = await browser.storage.local.get(CONFIG.storage.settings);
  const stored = result[CONFIG.storage.settings] as Partial<ExtensionSettings> | undefined;
  // Merge with defaults so newly-added fields (e.g. redditSubreddits)
  // are always present even if the user has older saved settings.
  return { ...DEFAULT_SETTINGS, ...stored };
}
```

**Ring-buffer / capped-array pattern** (from `src/background/index.ts:806-858`) — reuse for alert history cap (~100):
```typescript
const result = await browser.storage.local.get(CONFIG.storage.history);
const history = (result[CONFIG.storage.history] as HistoryEntry[]) ?? [];
// ... build entry ...
history.push(entry);
// Trim to max entries (keep most recent)
const trimmed = history.slice(-maxEntries);
await browser.storage.local.set({ [CONFIG.storage.history]: trimmed });
```

**Storage-as-state read/write pattern** (from `src/background/index.ts:470-478`):
```typescript
const result = await browser.storage.local.get(CONFIG.storage.collectedMarkets);
return (result[CONFIG.storage.collectedMarkets] as MarketContract[]) ?? [];
```

**Yes-price extraction** (from `src/background/index.ts:838-844`):
```typescript
yesPrice: m.outcomes.find((o) => o.label.toLowerCase() === 'yes')?.price,
```

**Error handling pattern** (from `src/background/index.ts:548-614` catch block):
```typescript
} catch (err) {
  console.error(`[TrendCast] runCorrelationAsync FAILED:`, err);
  const errorResult: CorrelationResult = { matches: [], newsMatches: [], newsSocialMatches: [], engine, error: err instanceof Error ? err.message : String(err) };
  await browser.storage.local.set({ [CONFIG.storage.correlations]: errorResult });
}
```

**Notification dispatch** — no existing analog; use `browser.notifications` via the polyfill (`src/messaging/browser.ts`). Always pass packaged `iconUrl` via `browser.runtime.getURL('icons/icon-128.png')` and check `browser.notifications.getPermissionLevel()` before creating (Pitfall 2). Fall back to `browser.action.setBadgeText({ text: String(count) })` on `'denied'`.

---

### `src/background/index.ts` (orchestrator, event-driven)

**Analog:** itself — the existing hook points are the integration surface.

**Alarm setup pattern** (from `src/background/index.ts:236-246`) — extend with an "alert sweep" alarm:
```typescript
function setupAlarms(): void {
  browser.alarms.create(CONFIG.collection.alarmName, {
    periodInMinutes: CONFIG.collection.defaultIntervalMinutes,
  });

  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== CONFIG.collection.alarmName) return;
    console.log('[TrendCast] Alarm fired — starting hourly collection');
    await runCollection();
  });
}
```
Add a second `browser.alarms.create(CONFIG.alerts.alarmName, { periodInMinutes: ... })` + a branch in the `onAlarm` listener for the alert sweep.

**Correlation-completion hook points** — call `evaluateAlerts()` after:
- `runCorrelationPrecompute()` completes (`src/background/index.ts:690-716`) — the `await browser.storage.local.set({ [CONFIG.storage.correlations]: result })` line is where the result is available.
- `runCorrelationAsync()` completes (`src/background/index.ts:548-614`) — after the `CORRELATION_RESULT` broadcast.

**Broadcast pattern** (from `src/background/index.ts:585-592`) — reuse for `ALERTS_UPDATED`:
```typescript
browser.runtime.sendMessage({
  type: 'CORRELATION_RESULT',
  payload: result,
}).catch((err) => {
  console.error('[TrendCast] CORRELATION_RESULT sendMessage failed:', err);
});
```

---

### `src/types/index.ts` (model)

**Analog:** itself — `CorrelationResult` (:262-290), `ExtensionSettings` (:449-489), `Message` (:391-433), `WatchlistEntry` (:365-372).

**Message union pattern** (from `src/types/index.ts:391-433`) — add `ALERTS_UPDATED` variant:
```typescript
export type Message =
  // ...
  | { type: 'CORRELATION_RESULT'; payload: CorrelationResult }
  | { type: 'CORRELATION_PROGRESS'; payload: { requestId: string; phase: string; current: number; total: number; engine: string; model: string } }
  // ... add:
  | { type: 'ALERTS_UPDATED'; payload: { alerts: AlertRecord[] } };

export type MessageType = Message['type'];
```

**Settings interface pattern** (from `src/types/index.ts:449-489`) — add `alertsEnabled`/`alertCooldownMinutes`:
```typescript
export interface ExtensionSettings {
  // ... existing fields ...
  redditSubreddits: string[];
  // NEW:
  alertsEnabled: boolean;
  alertCooldownMinutes: number;
}
```

**DEFAULT_SETTINGS pattern** (from `src/types/index.ts:489-520`) — add defaults:
```typescript
export const DEFAULT_SETTINGS: ExtensionSettings = {
  // ...
  redditSubreddits: ['investing', 'stocks', 'wallstreetbets', 'UKInvesting'],
  // NEW:
  alertsEnabled: true,
  alertCooldownMinutes: 60,
};
```

**WatchlistEntry shape** (from `src/types/index.ts:365-372`) — the model for `AlertRecord` (contractId + platform + cached question):
```typescript
export interface WatchlistEntry {
  contractId: string;
  platform: MarketPlatform;
  question: string;   // cached for display
  addedAt: number;
}
```

**New types to add:** `AlertRecord` (id, contractId, platform, question, direction, sentiment, yesPrice, topSignalText?, topNewsHeadline?, confidence, alertedAt), `AlertState` (lastNotified, priorYesPrice, lastGlobalAlertAt).

---

### `src/config/index.ts` (config)

**Analog:** itself — `CONFIG.storage` (:205-215), `CONFIG.collection` (:186-193).

**Storage keys pattern** (from `src/config/index.ts:205-215`) — add `alertState`/`alertHistory`:
```typescript
storage: {
  settings: 'trendcast:settings',
  // ...
  watchlist: 'trendcast:watchlist',
  // NEW:
  alertState: 'trendcast:alert-state',
  alertHistory: 'trendcast:alert-history',
},
```

**Alarm config pattern** (from `src/config/index.ts:186-193`) — add alert-sweep alarm name + interval:
```typescript
collection: {
  alarmName: 'trendcast-collect',
  defaultIntervalMinutes: 60,
  minIntervalMinutes: 5,
  // ...
},
// NEW:
alerts: {
  alarmName: 'trendcast-alert-sweep',
  sweepIntervalMinutes: 10,
  historyCap: 100,
  globalCooldownMinutes: 5,
  perMarketCooldownMinutes: 60,
  sentimentBand: 0.2,
  yesPriceBand: 0.02,
},
```

---

### `src/utils/storage.ts` (utility)

**Analog:** itself — `BUDGET_KEYS` (:15-25).

**BUDGET_KEYS pattern** (from `src/utils/storage.ts:15-25`) — add the two new keys so pruning accounts for them:
```typescript
const BUDGET_KEYS = [
  CONFIG.storage.latestSnapshot,
  CONFIG.storage.collectedMarkets,
  CONFIG.storage.collectedSignals,
  CONFIG.storage.collectedNews,
  CONFIG.storage.correlations,
  CONFIG.storage.history,
  CONFIG.storage.watchlist,
  CONFIG.storage.settings,
  CONFIG.storage.lastCollectionAt,
  // NEW:
  CONFIG.storage.alertState,
  CONFIG.storage.alertHistory,
] as const;
```

---

### `src/manifest.config.ts` (config)

**Analog:** itself — `permissions` array (:149-155).

**Permissions pattern** (from `src/manifest.config.ts:149-155`) — add `'notifications'`:
```typescript
permissions: [
  'storage', // persist settings, collected data, correlation state
  'alarms', // scheduled hourly collection (replaces setInterval in MV3)
  'tabs', // open background tabs for collection, detect active tab URL
  'scripting', // programmatic content script injection for bg tab collection
  'notifications', // NEW: correlation alerts (Phase 4)
],
```

---

### `src/dashboard/hooks/useAlerts.ts` (NEW — hook, event-driven)

**Analog:** `src/dashboard/hooks/useCorrelations.ts` (exact template).

**Imports pattern** (from `useCorrelations.ts:1-10`):
```typescript
import { useState, useCallback, useEffect, useRef } from 'react';
import type { AlertRecord } from '@/types';
import { browser } from '@/messaging/browser';
import { CONFIG } from '@/config';
```

**Load-cached-state-on-mount pattern** (from `useCorrelations.ts:96-112`) — load `alertHistory` from storage:
```typescript
useEffect(() => {
  browser.storage.local
    .get([CONFIG.storage.alertHistory])
    .then((result) => {
      const cached = result[CONFIG.storage.alertHistory] as AlertRecord[] | undefined;
      if (Array.isArray(cached)) {
        setAlerts(cached);
      }
    })
    .catch((err) => console.error('[TrendCast] Failed to load cached alerts:', err));
}, []);
```

**Message-listener pattern** (from `useCorrelations.ts:150-175`) — listen for `ALERTS_UPDATED`:
```typescript
useEffect(() => {
  const listener = (msg: unknown) => {
    const data = msg as { type?: string; payload?: { alerts: AlertRecord[] } };
    if (data.type === 'ALERTS_UPDATED' && data.payload) {
      setAlerts(data.payload.alerts);
    }
  };
  browser.runtime.onMessage.addListener(listener);
  return () => {
    browser.runtime.onMessage.removeListener(listener);
  };
}, []);
```

**"Clear all" action** — send `CLEAR_ALERTS` message (mirror `runCorrelation`'s `sendMessage` call pattern at `useCorrelations.ts:210-230`).

---

### `src/dashboard/components/AlertsTab.tsx` (NEW — component, request-response)

**Analog:** `src/dashboard/components/Watchlist.tsx` (role-match).

**Imports pattern** (from `Watchlist.tsx:1-10`):
```typescript
import { useState, useEffect, useCallback, memo } from 'react';
import { browser } from '@/messaging/browser';
import { CONFIG } from '@/config';
import { sendMessage } from '@/messaging';
import type { AlertRecord } from '@/types';
```

**Platform badge pattern** (from `Watchlist.tsx:22-25`):
```typescript
const platformBadges: Record<string, { icon: string; color: string }> = {
  polymarket: { icon: '🔵', color: 'bg-blue-900/50 text-blue-300' },
  kalshi: { icon: '🟢', color: 'bg-green-900/50 text-green-300' },
};
```

**Read-only list + action pattern** — render `alerts` from the `useAlerts` hook; add a "Clear all" button that calls the hook's clear function. Follow the `Watchlist` component's `memo` export + `WatchlistImpl` naming convention.

---

### `src/dashboard/App.tsx` (component, request-response)

**Analog:** itself — `Tab` union (:52), tab nav (:279-300), tab rendering (:306-740).

**Tab union pattern** (from `App.tsx:52`) — add `'alerts'`:
```typescript
type Tab = 'feed' | 'markets' | 'news' | 'correlations' | 'watchlist' | 'history' | 'community' | 'faq' | 'settings' | 'alerts';
```

**Tab nav entry** (from `App.tsx:279-300`) — add `['alerts', '🔔 Alerts']` to the array.

**Tab rendering** (from `App.tsx:634-643`) — add an `activeTab === 'alerts'` block:
```typescript
{activeTab === 'watchlist' && (
  <section>
    <h2 className="text-xl font-semibold mb-4">⭐ Your Watchlist</h2>
    <Watchlist markets={snapshot?.markets ?? []} />
  </section>
)}
```

**Hook wiring** (from `App.tsx:87`) — add `const { alerts, clearAlerts } = useAlerts();` alongside the existing `useCorrelations()` call.

---

### `src/popup/components/Settings.tsx` (component, request-response)

**Analog:** itself — `Section` wrapper + toggle pattern.

**Toggle pattern** (from `Settings.tsx:300-315` — theme toggle):
```tsx
<label className="flex items-center justify-between text-xs py-1 px-2 rounded bg-slate-800 cursor-pointer mt-2">
  <span className="text-slate-300">🌙 Dark mode</span>
  <input
    type="checkbox"
    checked={settings.theme === 'dark'}
    onChange={(e) => onUpdate({ theme: e.target.checked ? 'dark' : 'light' })}
    className="accent-brand-500"
  />
</label>
```
Add an "Alerts" `Section` with an `alertsEnabled` checkbox (same pattern) and an `alertCooldownMinutes` number input (mirror the collection-interval input at `Settings.tsx:20-33`).

---

### `tests/unit/alerts.test.ts` (NEW — test)

**Analog:** `tests/unit/source-health.test.ts` (exact).

**Test structure pattern** (from `source-health.test.ts:1-30`):
```typescript
import { describe, it, expect } from 'vitest';
import { evaluateAlerts } from '@/background/alerts';
import type { CorrelationResult, AlertState } from '@/types';

const NOW = 1_000_000_000_000;

function state(partial: Partial<AlertState>): AlertState {
  return { lastNotified: {}, priorYesPrice: {}, lastGlobalAlertAt: 0, ...partial };
}

describe('evaluateAlerts', () => {
  it('does not alert on a sustained match', () => {
    // ...
  });
});
```

**Testable units:** dedup (stable key), throttle (global + per-market cooldown), direction derivation (sentiment + yesPrice delta → bullish/bearish/mixed), meaningful-band flip (±0.2 sentiment / >2pts yesPrice), watchlist scoping, history cap (`slice(-100)`).

---

## Shared Patterns

### Settings merge for forward-compat
**Source:** `src/background/index.ts:479-486` + `src/dashboard/App.tsx:96-104`
**Apply to:** `src/background/alerts.ts`, `src/dashboard/App.tsx`, `src/popup/components/Settings.tsx`
```typescript
const merged = { ...DEFAULT_SETTINGS, ...stored };
```
New `alertsEnabled`/`alertCooldownMinutes` fields are automatically safe for existing users — no migration.

### Capped array via `slice(-N)` (ring buffer)
**Source:** `src/background/index.ts:806-858` (`appendHistoryEntry`), `src/dashboard/hooks/useCorrelations.ts:44-46` (`persistRunStats`)
**Apply to:** `src/background/alerts.ts` (alert history cap ~100)
```typescript
const trimmed = history.slice(-maxEntries);
await browser.storage.local.set({ [CONFIG.storage.history]: trimmed });
```

### Storage-as-state (MV3 worker survival)
**Source:** `src/background/index.ts:470-478`, `src/utils/storage.ts`
**Apply to:** `src/background/alerts.ts` — `alertState` must be persisted in `chrome.storage.local`; alerts driven by `chrome.alarms`, never timers.

### Alarm-driven scheduling
**Source:** `src/background/index.ts:236-246` (`setupAlarms`)
**Apply to:** `src/background/index.ts` — add alert-sweep alarm; respect the 30s `chrome.alarms` floor.

### Typed message envelope
**Source:** `src/types/index.ts:391-433` (`Message` union) + `src/messaging/index.ts`
**Apply to:** `src/types/index.ts` (add `ALERTS_UPDATED`), `src/background/index.ts` (broadcast), `src/dashboard/hooks/useAlerts.ts` (listen).

### Error handling
**Source:** `src/background/index.ts:548-614` catch block, `src/dashboard/hooks/useCorrelations.ts:230-245`
**Apply to:** `src/background/alerts.ts`, `src/dashboard/hooks/useAlerts.ts`
```typescript
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[TrendCast] ... failed:', err);
  setError(`... failed: ${msg}`);
}
```

### Cross-browser polyfill
**Source:** `src/messaging/browser.ts`
**Apply to:** `src/background/alerts.ts` — always `import { browser } from '@/messaging/browser'`; `browser.notifications` maps to `chrome.notifications` in Chrome and native in Firefox. Never use the raw `chrome` global.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/background/alerts.ts` (notification dispatch portion) | service | event-driven | No existing `chrome.notifications` usage in the codebase. Use RESEARCH.md §1 (MV3 Notification API) + `src/messaging/browser.ts` polyfill. The engine logic (dedup/throttle/direction) has analogs in `appendHistoryEntry`/`getSettings`. |

---

## Metadata

**Analog search scope:** `src/background/`, `src/dashboard/`, `src/popup/`, `src/utils/`, `src/config/`, `src/types/`, `src/manifest.config.ts`, `tests/unit/`
**Files scanned:** ~15
**Pattern extraction date:** 2026-08-23
