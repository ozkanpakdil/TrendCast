# Phase 1: Data Reliability - Pattern Map

**Mapped:** 2026-08-22
**Files analyzed:** 11 (6 edits, 3 new unit tests, 1 new component, 1 e2e edit)
**Analogs found:** 11 / 11

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/services/collectors/news.ts` (edit) | service/collector | request-response (fetch) | itself — `collectFromSource` + `collectNews` | exact (self-edit) |
| `src/background/index.ts` (edit) | orchestrator/controller | event-driven (alarms) | itself — `runCollection()` | exact (self-edit) |
| `src/types/index.ts` (edit) | model/type | — | itself — `NewsSource` union + `CollectionSnapshot` | exact (self-edit) |
| `src/config/index.ts` (edit) | config | — | itself — `CONFIG.storage` + `CONFIG.collection` | exact (self-edit) |
| `src/dashboard/App.tsx` (edit) | component/controller | request-response (storage read) | itself — `activeTab` sections | exact (self-edit) |
| `src/dashboard/components/SourceHealthIndicator.tsx` (NEW) | component | read-only derived projection | `CorrelationStatsBar.tsx` (badge row, `isDark`, `memo`) | role-match |
| `src/utils/storage.ts` (edit) | utility | — | itself — `BUDGET_KEYS` array | exact (self-edit) |
| `tests/unit/correlation-threshold.test.ts` (NEW) | test | unit | `tests/unit/correlation.test.ts` | exact |
| `tests/unit/source-health.test.ts` (NEW) | test | unit | `tests/unit/correlation.test.ts` | exact |
| `tests/unit/news-collector.test.ts` (NEW) | test | unit | `tests/unit/correlation.test.ts` | exact |
| `tests/e2e/dashboard.spec.ts` (edit) | test | e2e | itself + `tests/e2e/fixtures.ts` `MOCK_SNAPSHOT` | exact |

---

## Pattern Assignments

### `src/types/index.ts` (model/type)

**Analog:** itself — `NewsSource` union (line 88) and `CollectionSnapshot` (line 270).

**NewsSource union** (line 88, verbatim — the health-map key type):
```ts
export type NewsSource = 'bbc' | 'cnn' | 'yahoo' | 'googleFinance' | 'seekingalpha' | 'investing';
```

**CollectionSnapshot** (lines 270-276, verbatim — add `sourceHealth` field here):
```ts
export interface CollectionSnapshot {
  /** When this snapshot was collected (epoch ms). */
  collectedAt: number;
  markets: MarketContract[];
  signals: SocialSignal[];
  news: NewsItem[];
}
```

**NEW types to add** (place near `NewsSource`; `SourceHealth` is a `Partial<Record<NewsSource, ...>>` so the map is keyed by the typed union — satisfies ASVS V5 input validation, never index with an unvalidated string):
```ts
export interface SourceHealthEntry {
  lastFetchedAt: number;       // epoch ms of last fetch attempt
  itemCount: number;           // items returned at last fetch
  consecutiveFailures: number; // consecutive failed/empty fetches
  lastError?: string;          // last error message, if any
}
export type SourceHealth = Partial<Record<NewsSource, SourceHealthEntry>>;
```
Add `sourceHealth: SourceHealth;` to `CollectionSnapshot`.

---

### `src/config/index.ts` (config)

**Analog:** itself — `CONFIG.storage` (line 152) and `CONFIG.collection` (line 141).

**Storage keys block** (lines 151-162, verbatim — add a `sourceHealth` key here):
```ts
  // ── Storage keys ──────────────────────────────────────────────
  storage: {
    settings: 'trendcast:settings',
    latestSnapshot: 'trendcast:latest-snapshot',
    collectedMarkets: 'trendcast:collected-markets',
    collectedSignals: 'trendcast:collected-signals',
    collectedNews: 'trendcast:collected-news',
    correlations: 'trendcast:correlations',
    correlationRunHistory: 'trendcast:corr-run-history',
    lastCollectionAt: 'trendcast:last-collection',
    history: 'trendcast:history',
    watchlist: 'trendcast:watchlist',
  },
```

**Collection interval block** (lines 141-149, verbatim) — add the staleness threshold alongside these interval constants:
```ts
  collection: {
    alarmName: 'trendcast-collect',
    defaultIntervalMinutes: 60, // hourly
    // MV3 `chrome.alarms` minimum is 0.5 min (30s) in Chrome.
    minIntervalMinutes: 5,
    ...
  },
```
Add `sourceHealth: 'trendcast:source-health'` to `storage` (only if a separate key is chosen; RESEARCH recommends embedding in the snapshot for atomicity — see Shared Patterns) and a `stalenessThresholdMs` constant (e.g. `2 * 60 * 60 * 1000` for 2 missed hourly cycles) in `collection`.

---

### `src/services/collectors/news.ts` (service/collector, fetch)

**Analog:** itself — `collectNews()` + `collectFromSource()`.

**Imports** (lines 1-10, verbatim):
```ts
import type { NewsItem, NewsSource } from '@/types';
import { CONFIG } from '@/config';
import { extractKeywords } from '@/utils/keywords';
import { conditionalFetchJson } from '@/utils/conditional-fetch';
```

**Core `collectNews` pattern** (lines 44-66, verbatim) — uses `Promise.allSettled`; this is where per-source outcomes must be captured. The current code silently swallows failures:
```ts
export async function collectNews(
  sources: NewsSource[] = ['bbc', 'cnn'],
): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    sources.map((source) => collectFromSource(source)),
  );

  const items = results.flatMap((result, i) => {
    if (result.status !== 'fulfilled') {
      console.warn(`[TrendCast] Failed to collect news from ${sources[i]}:`, result.reason);
      return [];
    }
    return result.value;
  });

  console.log(`[TrendCast] News: ${items.length} items collected`);
  return items;
}
```

**Per-source fetch outcome** — `collectFromSource` (lines 68-120) returns `NewsItem[]` per source. To record health, either (a) change `collectFromSource` to return `{ items, source }` and build the `SourceHealth` map in `collectNews`, or (b) add a parallel `collectNewsWithHealth()` that returns `{ items, health }`. The `Promise.allSettled` result gives you `result.status` (fulfilled/rejected) and `result.reason` per source — record `consecutiveFailures` and `lastError` from the rejected branch, and `itemCount` from the fulfilled branch. The 304/empty branch (lines 75-80) returns `[]` — treat as `itemCount: 0` (degraded, not failure).

**Anti-pattern to avoid (RESEARCH Pitfall 1):** the current `console.warn` + `return []` is invisible to the user. Record the failure into `sourceHealth` instead.

---

### `src/background/index.ts` (orchestrator, event-driven)

**Analog:** itself — `runCollection()`.

**Imports** (lines 46-52, verbatim) — add `SourceHealth` type to the type import:
```ts
import { collectPolymarketMarkets, collectKalshiMarkets, collectRedditSignals, collectXTrends, collectNews } from '@/services/collectors';
import { correlate, correlateNews, correlateNewsSocial } from '@/services/engine/correlation';
import { exportToCsv, exportToJson } from '@/utils/export';
import { pruneStorageIfNeeded, measureStorageUsage } from '@/utils/storage';
```

**News collection block** (lines 463-470, verbatim) — `collectNews` currently returns only `NewsItem[]`; extend to also return `sourceHealth`:
```ts
  if (newsSources.length > 0) {
    tasks.push(
      collectNews(newsSources)
        .then((news) => storeNews(news))
        .catch((err) => console.error('[TrendCast] ❌ News failed:', err)),
    );
  }
```

**Snapshot build + persist** (lines 479-491, verbatim) — embed `sourceHealth` in the snapshot and write atomically:
```ts
  const snapshot: CollectionSnapshot = {
    collectedAt: Date.now(),
    markets,
    signals,
    news,
  };

  await browser.storage.local.set({
    [CONFIG.storage.latestSnapshot]: snapshot,
    [CONFIG.storage.lastCollectionAt]: snapshot.collectedAt,
  });
```
Add `sourceHealth` to the snapshot object. If a separate storage key is used, also `browser.storage.local.set({ [CONFIG.storage.sourceHealth]: health })` in the same write.

**Storage read helper pattern** (lines 748-751, verbatim) — copy for reading `sourceHealth` if a separate key:
```ts
async function getLatestSnapshot(): Promise<CollectionSnapshot | null> {
  const result = await browser.storage.local.get(CONFIG.storage.latestSnapshot);
  return (result[CONFIG.storage.latestSnapshot] as CollectionSnapshot) ?? null;
}
```

**MV3 constraint (RESEARCH Pitfall 3):** never hold `sourceHealth` in a module variable — the worker is ephemeral. Persist to `chrome.storage.local` in the same write as the snapshot.

---

### `src/dashboard/hooks/useSnapshot.ts` (hook, storage read)

**Analog:** itself — reads snapshot + subscribes to `onChanged`.

**Storage read** (lines 22-40, verbatim) — `sourceHealth` rides along inside `snapshot` (embedded), so no new read is needed if embedded. If a separate key is used, add it to the `browser.storage.local.get([...])` array:
```ts
      const result = await browser.storage.local.get([
        CONFIG.storage.latestSnapshot,
        CONFIG.storage.lastCollectionAt,
      ]);
      const snap = result[CONFIG.storage.latestSnapshot] as CollectionSnapshot | undefined;
```

**onChanged subscription** (lines 53-66, verbatim) — the snapshot listener already propagates `sourceHealth` when embedded:
```ts
    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      if (changes[CONFIG.storage.latestSnapshot]?.newValue) {
        setSnapshot(changes[CONFIG.storage.latestSnapshot].newValue as CollectionSnapshot);
      }
      ...
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
```

---

### `src/dashboard/components/SourceHealthIndicator.tsx` (NEW component)

**Analog:** `CorrelationStatsBar.tsx` (compact read-only badge row, `isDark` prop, `memo`) + `NewsFeed.tsx` (source labels/colors).

**Component skeleton pattern** (from `CorrelationStatsBar.tsx` lines 1-30, verbatim):
```tsx
import { memo } from 'react';
import type { CorrelationRunStats } from '@/types';

interface CorrelationStatsBarProps {
  stats: CorrelationRunStats | null;
  isDark: boolean;
}

function CorrelationStatsBarImpl({ stats, isDark }: CorrelationStatsBarProps) {
  if (!stats) return null;
  const cardClass = isDark
    ? 'bg-slate-900/80 border-slate-700 text-slate-300'
    : 'bg-slate-50 border-light-border light-text';
  ...
}
export const CorrelationStatsBar = memo(CorrelationStatsBarImpl);
```

**Source labels** (from `NewsFeed.tsx` lines 15-24, verbatim) — reuse for the health badge labels:
```tsx
const sourceLabels: Record<string, string> = {
  bbc: 'BBC',
  cnn: 'CNN',
  yahoo: 'Yahoo',
  googleFinance: 'Google',
  seekingalpha: 'Seeking Alpha',
  investing: 'Investing.com',
};
```

**Props contract** (per UI-SPEC): `{ health: SourceHealth; correlatedCounts: Partial<Record<NewsSource, number>>; isDark: boolean; loading: boolean; error?: boolean }`. The component is a **read-only derived projection** — it renders `fetched {N} · correlated {M}` per source from `health[source].itemCount` and the correlated counts computed from `correlations.newsMatches` grouped by `m.news.source`. It must NOT compute staleness inline — delegate to a `computeSourceHealth()` util (RESEARCH "Don't Hand-Roll").

**Health state colors** (UI-SPEC Color contract — never brand-500 for health badges):
| State | Token | Class |
|-------|-------|-------|
| Healthy | `text-bull` / `bg-bull/15` | `#16a34a` |
| Stale | `text-amber-500` / `bg-amber-500/15` | `#f59e0b` |
| Degraded | `text-bear` / `bg-bear/15` | `#dc2626` |
| No-data | `text-neutral` / `bg-neutral/15` | `#6b7280` |

**Copy** (UI-SPEC Copywriting Contract): `{Source} · Healthy|Stale|Degraded|No data`, detail `fetched {N} · correlated {M}`, empty `No health data available` + `Run a collection to see per-source status.`, error `Health data unavailable — check your connection and run collection again.`

**Spacing:** badge `px-2 py-1` (8px/4px), dot gap `gap-2` (8px), row gap `gap-2` (8px). Label 11px semibold, body 12px.

---

### `src/dashboard/App.tsx` (edit)

**Analog:** itself — `activeTab` sections.

**News tab section** (lines 319-326, verbatim) — render `SourceHealthIndicator` above `NewsFeed`:
```tsx
            {activeTab === 'news' && (
              <section>
                <h2 className={`text-sm font-bold uppercase tracking-wider mb-3 ${sectionTitle}`}>
                  📰 Latest News
                </h2>
                <NewsFeed news={snapshot?.news ?? []} />
              </section>
            )}
```

**Correlations tab section** (lines 328-330 + 609-616, verbatim) — render `SourceHealthIndicator` above `CorrelationPanel`:
```tsx
            {activeTab === 'correlations' && (
              <section>
                ...
                <CorrelationPanel
                  matches={correlations?.matches ?? []}
                  newsMatches={correlations?.newsMatches ?? []}
                  newsSocialMatches={correlations?.newsSocialMatches ?? []}
                />
              </section>
            )}
```
`snapshot` (from `useSnapshot()`) carries `sourceHealth`; `correlations` (from `useCorrelations()`) carries `newsMatches` for computing per-source correlated counts. Pass `isDark` (already in scope, line 105) to the indicator.

---

### `src/utils/storage.ts` (edit)

**Analog:** itself — `BUDGET_KEYS` array (lines 13-24, verbatim):
```ts
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
] as const;
```
**Only add `CONFIG.storage.sourceHealth` here IF a separate storage key is used.** If `sourceHealth` is embedded in `latestSnapshot` (recommended — see Shared Patterns), no change is needed here.

---

### `tests/unit/correlation-threshold.test.ts` (NEW)

**Analog:** `tests/unit/correlation.test.ts` — Vitest `describe/it/expect`, mock contract, `@/` path imports.

**Test skeleton** (from `tests/unit/correlation.test.ts` lines 1-9, verbatim):
```ts
import { describe, it, expect } from 'vitest';
import { extractKeywords, keywordSimilarity } from '@/utils/keywords';
import { correlate } from '@/services/engine/correlation';
import type { MarketContract, SocialSignal } from '@/types';
```

**Mock contract pattern** (lines 29-44, verbatim) — reuse for SA/Investing-style headlines:
```ts
  const mockContract: MarketContract = {
    id: 'test-1',
    platform: 'polymarket',
    question: 'Will Bitcoin close above $100k on Dec 31?',
    outcomes: [
      { label: 'Yes', price: 0.65 },
      { label: 'No', price: 0.35 },
    ],
    endDate: '2025-12-31T23:59:59Z',
    keywords: ['bitcoin', 'btc', '100k', 'close', 'december'],
    lastUpdated: Date.now(),
  };
```

**Core assertion target** — call `correlateNews(news, contracts)` (signature at `src/services/engine/correlation.ts:202`):
```ts
export function correlateNews(
  news: NewsItem[],
  contracts: MarketContract[],
): NewsCorrelationMatch[]
```
Feed SA/Investing-style `NewsItem[]` (with `source: 'seekingalpha'` / `source: 'investing'`, realistic headlines, `keywords` arrays) and assert the resulting `confidence` distribution. This is the **diagnostic regression guard** for D-01/D-03 — it must NOT change thresholds, only assert scores so the planner/user can see whether `MIN_CONFIDENCE = 0.75` (line 32) / `MIN_CONFIDENCE_ENTITY_MATCH = 0.35` (line 97) systematically drops these sources.

---

### `tests/unit/source-health.test.ts` (NEW)

**Analog:** `tests/unit/correlation.test.ts` (same Vitest skeleton). Tests the `computeSourceHealth()` util + `SourceHealth` map computation (REL-02). Assert: healthy entry records `lastFetchedAt`/`itemCount`; empty fetch increments `consecutiveFailures`; failure sets `lastError`; staleness derived from `lastFetchedAt` vs threshold. Use the same `describe/it/expect` + `@/` import pattern.

---

### `tests/unit/news-collector.test.ts` (NEW)

**Analog:** `tests/unit/correlation.test.ts` (same skeleton). Tests `collectNews` records per-source health (REL-01). Mock `conditionalFetchJson` (the collector's only external dependency) to return `{ status: 'ok', items: [...] }` per source and assert the returned `sourceHealth` map. Use the same Vitest skeleton.

---

### `tests/e2e/dashboard.spec.ts` (edit)

**Analog:** itself + `tests/e2e/fixtures.ts`. Extend `MOCK_SNAPSHOT` (fixtures.ts lines 20+) with a `sourceHealth` field, then add a test asserting the `SourceHealthIndicator` renders `fetched N · correlated M` in the correlations/news tab. Follow the existing `openDashboard(page, overrides)` + `page.locator(...).toContainText(...)` pattern (lines 15-30).

---

## Shared Patterns

### Storage-as-state (apply to background + dashboard)
**Source:** `src/background/index.ts` + `src/dashboard/hooks/useSnapshot.ts`
**Apply to:** `sourceHealth` persistence + reads
All durable state lives in `chrome.storage.local`; the MV3 worker is ephemeral. **Recommendation (RESEARCH):** embed `sourceHealth` inside `CollectionSnapshot` for atomicity with the data it describes — this avoids a second storage key, a second read in `useSnapshot`, and a `BUDGET_KEYS` change. Only use a separate `trendcast:source-health` key if snapshot size becomes a concern (deferred to PERF-03).

### Typed `NewsSource` key (apply to health map)
**Source:** `src/types/index.ts:88`
**Apply to:** `SourceHealth` type + any source-string indexing
`SourceHealth = Partial<Record<NewsSource, SourceHealthEntry>>` — the key is the typed union. Never index with an unvalidated string (ASVS V5 input validation). The dashboard computes per-source correlated counts by grouping `correlations.newsMatches` by `m.news.source` (typed `NewsSource`).

### Cross-browser `browser.*` API
**Source:** `@/messaging/browser` (webextension-polyfill)
**Apply to:** all storage reads/writes in background + dashboard
Always `import { browser } from '@/messaging/browser'` — never raw `chrome.*` (Firefox needs the polyfill).

### Read-only derived projection
**Source:** `src/dashboard/components/CorrelationStatsBar.tsx`
**Apply to:** `SourceHealthIndicator`
The indicator is a read-only projection over data the collector already has. Centralize staleness logic in a pure `computeSourceHealth()` util (testable in isolation) rather than scattering date math in the component (RESEARCH "Don't Hand-Roll").

### Error handling
**Source:** `src/background/index.ts` (`.catch((err) => console.error(...))` per task)
**Apply to:** background collection tasks
Each collection task is wrapped in `.catch` that logs — do not let a single source failure abort the whole cycle. `collectNews` uses `Promise.allSettled` so one source's failure doesn't reject the batch.

---

## No Analog Found

None — every file maps to an existing codebase analog (the modified files map to themselves; the new component maps to `CorrelationStatsBar`/`NewsFeed`; the new tests map to `correlation.test.ts`).

## Metadata

**Analog search scope:** `src/services/collectors/`, `src/background/`, `src/types/`, `src/config/`, `src/dashboard/` (+ `components/`, `hooks/`), `src/utils/`, `tests/unit/`, `tests/e2e/`
**Files scanned:** 14
**Pattern extraction date:** 2026-08-22
