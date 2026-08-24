# Phase 10: Cross-source consensus alerts - Pattern Map

**Mapped:** 2026-08-24
**Files analyzed:** 7 (2 modified types/config, 2 background engine/orchestration, 1 correlation data source, 2 dashboard UI)
**Analogs found:** 7 / 7

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/types/index.ts` (§AlertRecord) | model | CRUD (persisted) | `Message` union (same file, discriminated-union pattern) | exact |
| `src/background/alerts.ts` (new `evaluateCrossSourceAlerts`) | service/engine | event-driven (sweep) | `evaluateAlerts` (same file) | exact |
| `src/background/index.ts` (§`runAlertSweep`) | orchestration | event-driven (alarm) | existing `runAlertSweep` (same file) | exact |
| `src/services/engine/correlation.ts` (§`correlateNewsSocial`) | service | transform (data source, read-only) | itself — no change, consumed as seed | exact |
| `src/config/index.ts` (§`CONFIG.alerts`) | config | n/a (constants) | existing `CONFIG.alerts` block (same file) | exact |
| `src/dashboard/components/AlertsTab.tsx` | component | request-response (storage read) | itself — kind-aware card + empty-state | exact |
| `src/dashboard/hooks/useAlerts.ts` | hook | event-driven (ALERTS_UPDATED) | itself — no change expected | exact |

## Pattern Assignments

### `src/types/index.ts` — `AlertRecord` `kind` discriminator + cross-source fields (model, CRUD)

**Analog:** `Message` discriminated union (lines 460-505) + existing `AlertRecord` (lines 407-428)

**Discriminated-union pattern** (`Message` union, lines 460-505) — the `kind` discriminator on `AlertRecord` follows this exact pattern:
```typescript
export type Message =
  | { type: 'REPORT_MARKET_DATA'; payload: { markets: MarketContract[] } }
  | { type: 'ALERTS_UPDATED'; payload: { alerts: AlertRecord[] } }
  | { type: 'CLEAR_ALERTS'; payload: Record<string, never> };
```

**Existing `AlertRecord` to extend** (lines 407-428) — add `kind: 'watchlist' | 'crossSource'` and make `contractId`/`platform`/`question` optional (D-04/D-05):
```typescript
export interface AlertRecord {
  id: string;
  contractId: string;          // → optional for crossSource (D-05)
  platform: MarketPlatform;    // → optional for crossSource
  question: string;            // → optional for crossSource
  direction: AlertDirection;
  sentiment: number;
  yesPrice: number;
  topSignalText?: string;
  topNewsHeadline?: string;
  confidence: number;
  alertedAt: number;
}
```

**Source-type unions for D-02 counting** (lines 56, 90) — reuse these to count distinct source types:
```typescript
export type SocialPlatform = 'x' | 'reddit' | 'tiktok';
export type NewsSource = 'bbc' | 'cnn' | 'yahoo' | 'googleFinance' | 'seekingalpha' | 'investing';
```

**Cross-source fields to add (D-05):** `topicLabel: string`, `sourceTypes: string[]` (distinct source types reaching consensus), `topSignalText`/`topNewsHeadline` already exist. `id` pattern stays `${topicId}:${alertedAt}`.

---

### `src/background/alerts.ts` — new `evaluateCrossSourceAlerts` (service/engine, event-driven)

**Analog:** `evaluateAlerts` (same file, lines 96-190) — the cross-source path mirrors this pure, storage-backed engine exactly.

**Imports pattern** (lines 1-20):
```typescript
import { browser } from '@/messaging/browser';
import { CONFIG } from '@/config';
import type {
  AlertRecord,
  AlertState,
  CorrelationResult,
  ExtensionSettings,
  MarketContract,
  NewsItem,
  SocialSignal,
  WatchlistEntry,
} from '@/types';
```

**Storage-backed state helpers** (lines 30-48) — reuse unchanged for cross-source (same `alertState`/`alertHistory` keys):
```typescript
async function readAlertState(): Promise<AlertState> {
  const result = await browser.storage.local.get(CONFIG.storage.alertState);
  const state = result[CONFIG.storage.alertState] as AlertState | undefined;
  return state ?? emptyAlertState();
}
async function readAlertHistory(): Promise<AlertRecord[]> {
  const result = await browser.storage.local.get(CONFIG.storage.alertHistory);
  return (result[CONFIG.storage.alertHistory] as AlertRecord[]) ?? [];
}
```

**Core engine skeleton to mirror** (`evaluateAlerts`, lines 96-190) — the key difference: cross-source path does NOT early-return on empty watchlist. It reads `result.newsSocialMatches` (D-06) instead of `result.matches`/`result.newsMatches`:
```typescript
export async function evaluateAlerts(
  result: CorrelationResult,
  watchlist: WatchlistEntry[],
  settings: ExtensionSettings,
  now: number = Date.now(),
): Promise<AlertRecord[]> {
  if (!settings.alertsEnabled) return [];          // D-09: gated by alertsEnabled only
  const watchlisted = new Set(watchlist.map((w) => w.contractId));
  if (watchlisted.size === 0) return [];           // ← cross-source path REMOVES this early-return
  const [state, history] = await Promise.all([readAlertState(), readAlertHistory()]);
  // ... group by contract, derive direction, throttle, build record ...
  const newAlerts: AlertRecord[] = [];
  // ...
  if (newAlerts.length === 0) return [];
  const updatedHistory = [...history, ...newAlerts].slice(-CONFIG.alerts.historyCap);
  await browser.storage.local.set({
    [CONFIG.storage.alertState]: state,
    [CONFIG.storage.alertHistory]: updatedHistory,
  });
  return newAlerts;
}
```

**Cooldown/throttle pattern** (lines 151-166) — reuse for per-topic throttle keyed by topic id (D-08):
```typescript
const globalCooldownMs = CONFIG.alerts.globalCooldownMinutes * 60_000;
const perMarketCooldownMs =
  (settings.alertCooldownMinutes ?? CONFIG.alerts.perMarketCooldownMinutes) * 60_000;
// Global throttle.
if (now - state.lastGlobalAlertAt < globalCooldownMs) continue;
// Per-market cooldown → per-topic cooldown (D-08): key by topicId.
const lastNotified = state.lastNotified[contractId] ?? 0;
if (now - lastNotified < perMarketCooldownMs) continue;
```

**Record construction** (lines 168-181) — cross-source record uses `topicId` instead of `contractId`, `topicLabel` instead of `question`:
```typescript
const record: AlertRecord = {
  id: `${contractId}:${now}`,
  contractId,
  platform: contract.platform,
  question: contract.question,
  direction,
  sentiment,
  yesPrice: currentYes ?? 0,
  topSignalText: topSignal?.text,
  topNewsHeadline: topNews?.headline,
  confidence: confidenceByContract.get(contractId) ?? 0,
  alertedAt: now,
};
```

**Reusable dispatch/badge/broadcast** (lines 193-290) — cross-source alerts reuse these UNCHANGED (D-04 note: `dispatchAlerts` notification title uses `record.question`; must handle optional `question` for crossSource):
```typescript
export async function broadcastAlerts(records: AlertRecord[]): Promise<void> {
  browser.runtime.sendMessage({ type: 'ALERTS_UPDATED', payload: { alerts: records } })
    .catch((err) => console.error('[TrendCast] ALERTS_UPDATED sendMessage failed:', err));
}
export async function updateBadge(now: number = Date.now()): Promise<void> { /* ... */ }
export async function dispatchAlerts(records: AlertRecord[]): Promise<void> { /* ... */ }
```

**`deriveDirection` reuse** (lines 62-94) — for aggregate topic direction (D-03, any direction fires). Note: it takes a `MarketContract`; cross-source topics have no contract, so either reuse the sentiment-mean portion or add a topic-level direction helper.

---

### `src/background/index.ts` — hook cross-source path into `runAlertSweep` (orchestration, event-driven)

**Analog:** existing `runAlertSweep` (lines 274-290) — add the cross-source call alongside `evaluateAlerts`:
```typescript
async function runAlertSweep(): Promise<void> {
  try {
    const stored = await browser.storage.local.get(CONFIG.storage.correlations);
    const result = stored[CONFIG.storage.correlations] as CorrelationResult | undefined;
    if (!result) return;

    const [watchlist, settings] = await Promise.all([getWatchlist(), getSettings()]);
    const newAlerts = await evaluateAlerts(result, watchlist, settings);
    // ← NEW: const crossSourceAlerts = await evaluateCrossSourceAlerts(result, settings);
    // ← NEW: combine both arrays before dispatch/broadcast
    if (newAlerts.length > 0) {
      await dispatchAlerts(newAlerts);
      await broadcastAlerts(await getAlertHistory());
    }
    await updateBadge();
  } catch (err) {
    console.error('[TrendCast] Alert sweep failed:', err);
  }
}
```

**Import line to extend** (line 55):
```typescript
import { evaluateAlerts, dispatchAlerts, broadcastAlerts, clearAlerts, updateBadge, getAlertHistory } from '@/background/alerts';
// ← add evaluateCrossSourceAlerts to this import
```

**`newsSocialMatches` availability** — `runCorrelationWithEngine` (lines 784-786) and `runMLCorrelation` both populate `result.newsSocialMatches`, which is persisted to `CONFIG.storage.correlations` and read back in `runAlertSweep`. The cross-source path reads it from the same stored `result` (D-06).

---

### `src/services/engine/correlation.ts` — `correlateNewsSocial` output as seed (service, transform — read-only)

**Analog:** itself — NO modification. The cross-source path consumes `NewsSocialCorrelationMatch[]` (D-06).

**`NewsSocialCorrelationMatch` shape** (types lines 239-246) — the seed for topic clustering (D-07):
```typescript
export interface NewsSocialCorrelationMatch {
  news: NewsItem;          // has .source: NewsSource
  signal: SocialSignal;    // has .platform: SocialPlatform
  confidence: number;
  matchedKeywords: string[];
  correlatedAt: number;
}
```

**Entity extraction for clustering (D-07)** — reuse `extractEntityKeywords`/`extractEntities` from `src/utils/entities.ts` (lines 197, 360) to group pairs into topic clusters by shared entities/keywords:
```typescript
export function extractEntityKeywords(text: string): string[] {
  return extractEntities(text).map((e) => e.normalized);
}
```

**Source-type counting (D-02)** — each match carries `match.signal.platform` (social) and `match.news.source` (news). Count distinct source types per cluster; require ≥3 distinct types mixing ≥1 social + ≥1 news (D-01).

---

### `src/config/index.ts` — new consensus threshold constants (config)

**Analog:** existing `CONFIG.alerts` block (lines 190-215) — add D-01 threshold constants here:
```typescript
alerts: {
  alarmName: 'trendcast-alert-sweep',
  sweepIntervalMinutes: 10,
  historyCap: 100,
  globalCooldownMinutes: 5,
  perMarketCooldownMinutes: 60,
  sentimentBand: 0.2,
  yesPriceBand: 0.02,
  badgeWindowHours: 24,
  // ← NEW (D-01): consensus threshold
  //   minConsensusSourceTypes: 3,
  //   requireSocialAndNews: true,
},
```

---

### `src/dashboard/components/AlertsTab.tsx` — kind-aware card + empty-state (component)

**Analog:** itself — modify empty-state (D-10) and card rendering (D-11).

**Empty-state message (D-10)** — lines 73-80:
```tsx
if (sorted.length === 0) {
  return (
    <div className="text-center py-8">
      <p className="text-slate-500 text-sm mb-2">No alerts yet</p>
      <p className="text-slate-600 text-xs">
        Alerts appear here when a watchlisted market shows a new or changed correlation.
        {/* ← NEW (D-10): mention cross-source consensus alerts */}
      </p>
    </div>
  );
}
```

**Card rendering (D-11)** — lines 104-130. Add a `kind === 'crossSource'` branch rendering a distinct card with topic label + "Cross-source" badge + source breakdown. Watchlist cards stay as-is:
```tsx
{sorted.map((alert) => {
  const badge = directionBadges[alert.direction] ?? directionBadges.mixed;
  const body = alert.topSignalText ?? alert.topNewsHeadline ?? '';
  const absTime = new Date(alert.alertedAt).toLocaleString();
  return (
    <div key={alert.id} className={`rounded-lg p-3 border ${card}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${badge.cls}`}>
              {badge.arrow} {badge.label}
            </span>
            {/* ← NEW (D-11): "Cross-source" badge when alert.kind === 'crossSource' */}
            <span className={`text-[10px] ${muted}`} title={absTime}>
              {relativeTime(alert.alertedAt)}
            </span>
          </div>
          <p className={`text-sm line-clamp-2 ${isDark ? 'text-slate-200' : 'text-light-text'}`}>
            {alert.question}  {/* ← crossSource: render alert.topicLabel instead */}
          </p>
          {body && <p className={`text-xs mt-1 line-clamp-2 ${muted}`}>{body}</p>}
        </div>
      </div>
    </div>
  );
})}
```

---

### `src/dashboard/hooks/useAlerts.ts` — no change expected (hook, event-driven)

**Analog:** itself — already loads `alertHistory` and listens for `ALERTS_UPDATED`. Since cross-source alerts share the same `alertHistory` array and `ALERTS_UPDATED` broadcast (D-04), this hook needs NO modification. The `kind` field flows through transparently.

---

## Shared Patterns

### Discriminated union (`kind` discriminator)
**Source:** `src/types/index.ts` `Message` union (lines 460-505)
**Apply to:** `AlertRecord` (D-04)
```typescript
export type Message =
  | { type: 'ALERTS_UPDATED'; payload: { alerts: AlertRecord[] } }
  | { type: 'CLEAR_ALERTS'; payload: Record<string, never> };
```

### Pure, storage-backed engine (MV3 worker-safe)
**Source:** `src/background/alerts.ts` `evaluateAlerts` (lines 96-190)
**Apply to:** new `evaluateCrossSourceAlerts` — no module-level state; read/write `chrome.storage.local`; return newly-created records.

### Cooldown/throttle (anti-fatigue)
**Source:** `src/background/alerts.ts` lines 151-166
**Apply to:** cross-source per-topic throttle keyed by topic id (D-08), reusing `CONFIG.alerts.globalCooldownMinutes` + `perMarketCooldownMinutes`.

### Storage as source of truth
**Source:** `CONFIG.storage.alertState` / `alertHistory` (`src/config/index.ts` lines 120-121)
**Apply to:** cross-source alerts persist to the SAME keys — one unified history array (D-04).

### Entity extraction for clustering
**Source:** `src/utils/entities.ts` `extractEntityKeywords`/`extractEntities` (lines 197, 360)
**Apply to:** grouping `newsSocialMatches` into topic clusters (D-07).

### Notification/badge/broadcast dispatch
**Source:** `src/background/alerts.ts` `dispatchAlerts`/`broadcastAlerts`/`updateBadge`/`clearAlerts` (lines 193-290)
**Apply to:** cross-source alerts reuse unchanged. Note: `dispatchAlerts` notification title uses `record.question` — must handle optional `question` for crossSource records (D-05).

## No Analog Found

None — every file this phase touches has an exact in-repo analog (mostly the file itself, since this phase extends existing alert infrastructure rather than introducing new file types).

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| — | — | — | All 7 files have exact analogs |

## Metadata

**Analog search scope:** `src/types/`, `src/background/`, `src/services/engine/`, `src/config/`, `src/dashboard/components/`, `src/dashboard/hooks/`, `src/utils/`
**Files scanned:** 7
**Pattern extraction date:** 2026-08-24
