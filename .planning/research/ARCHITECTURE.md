# Architecture Research

**Domain:** Prediction-market correlation browser extension (Manifest V3, Chrome + Firefox)
**Researched:** 2026-08-22
**Confidence:** HIGH

## Standard Architecture

### System Overview

TrendCast is a **background-orchestrator + storage-as-state + React-UI** MV3 extension. The background service worker is the single orchestrator; `chrome.storage.local` is the source of truth; the dashboard/popup read snapshots from storage and send typed messages to trigger actions. This research covers how to evolve that architecture for scale (correlation), new capabilities (alerts, market-driven news), and new collectors (TikTok) — **without** abandoning the proven pattern.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                          UI Layer (React)                                    │
│   Dashboard (new tab)          Popup (toolbar)                              │
│  src/dashboard/               src/popup/                                    │
│  App.tsx · components/ ·      App.tsx · components/Settings.tsx            │
│  hooks/ (useSnapshot,         hooks/ (useSettings, useSnapshot,            │
│  useCorrelations)             useCachedMarkets)                            │
└──────────────┬──────────────────────────────┬───────────────────────────────┘
               │  runtime.sendMessage          │  runtime.sendMessage
               ▼                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│              Messaging Layer (typed, discriminated union)                   │
│                    src/messaging/                                           │
│   index.ts (sendMessage, sendTabMessage, onMessage)                         │
│   browser.ts (webextension-polyfill re-export)                              │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│              Background Service Worker (orchestrator)                       │
│                    src/background/                                          │
│  index.ts (alarms, message handlers, collection, ML worker mgmt)            │
│  correlation.ts (index build + candidate filtering)   ← NEW module          │
│  alerts.ts (alert detection + notification dispatch)  ← NEW module          │
│  marketNews.ts (market-driven news aggregation)       ← NEW module          │
└──────┬──────────────────────┬──────────────────────┬────────────────────────┘
       │                      │                      │
       ▼                      ▼                      ▼
┌──────────────┐   ┌────────────────────┐   ┌──────────────────────┐
│ Collectors   │   │ Correlation Engine │   │ ML Web Worker        │
│ src/services/│   │ src/services/engine│   │ src/workers/         │
│ collectors/  │   │ correlation.ts     │   │ ml-worker.ts         │
│ (fetch APIs) │   │ ml/ (embedding,    │   │ (Transformers.js     │
│ + tiktok.ts) │   │ sentiment, zeroshot│   │ ONNX WASM inference) │
│              │   │ ner, llm)          │   │                      │
└──────┬───────┘   └─────────┬──────────┘   └──────────────────────┘
       │                     │
       ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Storage (chrome.storage.local)                            │
│  latestSnapshot · collectedMarkets · collectedSignals · collectedNews ·     │
│  correlations · history · watchlist · settings · alertState ·               │
│  marketNewsView (NEW) · keywordIndex (NEW, derived/cached)                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Background worker | Orchestrates collection, correlation, alerts, storage; registers all listeners synchronously | `src/background/index.ts` |
| Correlation engine | Matches signals/news to contracts with confidence; **candidate-filtered** | `src/services/engine/correlation.ts` + `ml/*.ts` |
| Keyword index | Inverted keyword→contract map for candidate pre-filtering | `src/services/engine/index.ts` (NEW) |
| Alert engine | Detects strong/new correlations, dedupes, dispatches notifications | `src/background/alerts.ts` (NEW) |
| Market-driven news | Aggregates markets → their correlated news → directional implication | `src/background/correlationNews.ts` (NEW) |
| Collectors | Fetch/normalise external data (Polymarket, Kalshi, Reddit, X, News, **TikTok**) | `src/services/collectors/*.ts` |
| ML Web Worker | Runs ML inference off main thread | `src/workers/ml-worker.ts` |
| Content scripts | Scrape DOM on supported sites, report via messages | `src/content/*/index.ts` |
| Dashboard | New-tab React app (primary UI) | `src/dashboard/` |
| Popup | Quick-launcher React app | `src/popup/` |
| Utils | Keywords, entities, sentiment, export, storage budget, rate limiter, conditional fetch | `src/utils/*.ts` |
| Types | Shared domain types + Message discriminated union | `src/types/index.ts` |

## Recommended Project Structure

```
src/
├── background/                 # Orchestrator (split from single 883-line index.ts)
│   ├── index.ts                # alarms, message handlers, collection orchestration
│   ├── correlation.ts          # NEW: correlation dispatch + keyword-index build
│   ├── alerts.ts               # NEW: alert detection + notification dispatch
│   └── correlationNews.ts      # NEW: market-driven news aggregation
├── services/
│   ├── collectors/             # data collectors (one file per platform)
│   │   ├── index.ts            #   barrel export
│   │   ├── polymarket.ts
│   │   ├── kalshi.ts
│   │   ├── reddit.ts
│   │   ├── x-trends.ts
│   │   ├── news.ts
│   │   └── tiktok.ts           # NEW: TikTok collector
│   └── engine/
│       ├── correlation.ts      # heuristic engine (candidate-filtered)
│       ├── index.ts            # NEW: shared keyword→contract inverted index
│       └── ml/                 # ML engines (embedding, sentiment, zeroshot, ner, llm)
├── workers/
│   └── ml-worker.ts            # ML inference worker
├── content/
│   ├── news/index.ts
│   ├── prediction-markets/index.ts
│   └── socials/index.ts        # NEW: implement TikTok/X/Reddit DOM scraping + overlay
├── dashboard/
│   ├── App.tsx
│   ├── components/
│   │   ├── CorrelationPanel.tsx
│   │   ├── MarketDrivenNews.tsx   # NEW: market-driven news view
│   │   └── ...
│   └── hooks/
│       ├── useCorrelations.ts
│       ├── useAlerts.ts           # NEW: alert state + notification opt-in
│       └── ...
├── messaging/
│   ├── index.ts
│   └── browser.ts
├── config/
│   └── index.ts               # add alert + tiktok + marketNews config
├── types/
│   └── index.ts               # + Alert, MarketDrivenNews, TikTokSignal, Message variants
└── utils/
    ├── storage.ts             # incremental byte estimation
    └── ...
```

### Structure Rationale

- **`background/` split into focused modules:** The current `src/background/index.ts` (883 lines) mixes orchestration, merging, history, and ML worker management. Splitting correlation dispatch, alert detection, and market-driven-news aggregation into separate modules keeps the orchestrator readable and testable. The orchestrator stays the single entry point that registers listeners synchronously.
- **`services/engine/index.ts` for the inverted index:** The keyword→contract index is a shared, pure data structure used by both the heuristic engine and the ML candidate pre-filter. Putting it in `services/engine/` (not `background/`) keeps it reusable and unit-testable without a worker.
- **`services/collectors/tiktok.ts`:** Follows the existing one-file-per-platform collector convention (`polymarket.ts`, `kalshi.ts`, `reddit.ts`, `x-trends.ts`, `news.ts`). The barrel `index.ts` re-exports it so the background worker imports from a single location.
- **`background/alerts.ts` and `background/correlationNews.ts`:** These are orchestrator-side concerns (they read storage, run after correlation, and dispatch notifications/messages). Keeping them in `background/` matches the existing "orchestrator owns cross-cutting flows" pattern.

## Architectural Patterns

### Pattern 1: Inverted Keyword→Contract Index (candidate pre-filtering)

**What:** Build a `Map<keyword, MarketContract[]>` once per correlation pass, then for each signal/news item look up only the contracts that share at least one keyword. This collapses the O(n×m) nested loop into O(n × avg_candidates) where `avg_candidates` is typically a small fraction of all contracts.

**When to use:** Every correlation pass — heuristic (`correlate`, `correlateNews`, `correlateNewsSocial`) and ML candidate pre-filtering. The zero-shot engine already does this via `findCandidateContracts` (linear filter per item); the index makes it a hash lookup.

**Trade-offs:** Building the index is O(m) once per pass (cheap). The index must be rebuilt when contracts change (each collection cycle). Memory is bounded by total keyword occurrences across contracts — small for ~500 markets.

**Example:**
```typescript
// src/services/engine/index.ts
export interface KeywordIndex {
  /** keyword (lowercased) → contracts whose keyword set contains it */
  byKeyword: Map<string, MarketContract[]>;
  /** contract id → contract, for dedup when a contract matches via multiple keywords */
  byId: Map<string, MarketContract>;
}

export function buildKeywordIndex(contracts: MarketContract[]): KeywordIndex {
  const byKeyword = new Map<string, MarketContract[]>();
  const byId = new Map<string, MarketContract>();
  for (const c of contracts) {
    byId.set(c.id, c);
    for (const kw of c.keywords) {
      const key = kw.toLowerCase();
      const list = byKeyword.get(key);
      if (list) list.push(c);
      else byKeyword.set(key, [c]);
    }
  }
  return { byKeyword, byId };
}

/** Candidate contracts sharing ≥1 keyword with the item's keyword set. */
export function candidateContracts(
  index: KeywordIndex,
  itemKeywords: string[],
  max: number,
): MarketContract[] {
  const seen = new Set<string>();
  const out: MarketContract[] = [];
  for (const kw of itemKeywords) {
    for (const c of index.byKeyword.get(kw.toLowerCase()) ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
      if (out.length >= max) return out;
    }
  }
  return out;
}
```

**Trade-offs:** The index only helps when contracts share keywords with items. For items with no keyword overlap, the candidate set is empty (correct — they'd score 0 anyway). The `max` cap (mirroring `ZEROSHOT_MAX_LABELS`) bounds worst-case work. This is the single highest-leverage change for the O(n×m) bottleneck.

### Pattern 2: Batching + Shared Result Cache Across Passes

**What:** Run the three correlation passes (signals→markets, news→markets, news→social) against a **single shared** keyword index and a **single shared** entity cache, so NER extraction and candidate lookups are never recomputed across passes. The zero-shot engine already shares a `ZeroShotIndex` across passes (`correlateAllZeroShot`); extend the same idea to the heuristic engine.

**When to use:** Any time the same texts are scored against the same candidate sets in multiple passes within one run.

**Trade-offs:** Requires passing a shared context object (index + cache) through all three functions instead of each building its own. Slightly more plumbing, but eliminates redundant NER and index builds on the hot path.

**Example:**
```typescript
// src/services/engine/correlation.ts
export interface CorrelationContext {
  index: KeywordIndex;          // shared inverted index
  entityCache: EntityCache;     // shared NER cache
}

export function correlateAll(
  signals: SocialSignal[],
  contracts: MarketContract[],
  news: NewsItem[],
): { matches: CorrelationMatch[]; newsMatches: NewsCorrelationMatch[]; newsSocialMatches: NewsSocialCorrelationMatch[] } {
  const ctx: CorrelationContext = {
    index: buildKeywordIndex(contracts),
    entityCache: new EntityCache(),
  };
  const matches = correlateSignals(ctx, signals, contracts);
  const newsMatches = correlateNews(ctx, news, contracts);
  const newsSocialMatches = correlateNewsSocial(ctx, news, signals);
  return { matches, newsMatches, newsSocialMatches };
}
```

### Pattern 3: Ephemeral-Worker-Safe Alert Detection (alarms + storage, not timers)

**What:** Correlation alerts must survive MV3 worker restarts. The alert engine runs **after** a correlation completes (not on a timer), reads the previous alert state from `chrome.storage.local`, detects new/strong matches, writes the new state, and fires `chrome.notifications`. A separate `chrome.alarms` "alert sweep" alarm re-checks the last stored correlation result periodically so alerts still fire even if the worker was killed mid-correlation.

**When to use:** Any feature that must fire asynchronously after a long-running computation in an ephemeral worker.

**Trade-offs:** `chrome.notifications` requires the `notifications` permission (a new permission prompt). Dedup state must be persisted (a `alertState` storage key) or the user gets spammed every cycle. Notification clicks need a handler to open the dashboard.

**Example:**
```typescript
// src/background/alerts.ts
interface AlertState {
  /** contractId → last notified confidence, to avoid re-notifying */
  lastNotified: Record<string, number>;
  lastAlertAt: number;
}

export async function evaluateAlerts(
  result: CorrelationResult,
  settings: ExtensionSettings,
): Promise<void> {
  if (!settings.alertsEnabled) return;
  const state = (await storage.get(ALERT_STATE_KEY))[ALERT_STATE_KEY] as AlertState | undefined
    ?? { lastNotified: {}, lastAlertAt: 0 };

  const now = Date.now();
  const candidates = [...result.matches, ...result.newsMatches]
    .filter((m) => m.confidence >= settings.alertThreshold)
    .filter((m) => (state.lastNotified[m.contract.id] ?? 0) < now - settings.alertCooldownMs);

  for (const m of candidates) {
    await browser.notifications.create(`trendcast-alert-${m.contract.id}-${now}`, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('icons/icon128.png'),
      title: m.contract.question,
      message: `Confidence ${(m.confidence * 100).toFixed(0)}% — ${m.signal?.text ?? m.news?.headline ?? ''}`,
    });
    state.lastNotified[m.contract.id] = now;
  }
  state.lastAlertAt = now;
  await storage.set({ [ALERT_STATE_KEY]: state });
}
```

### Pattern 4: Market-Driven News Aggregation (markets → news → direction)

**What:** A derived view that starts from **notable markets** (high volume, watchlisted, or high-confidence correlation), finds their correlated news, and surfaces the **directional implication** (the market's yes/no price movement + the news that explains it). It is a **read-only derived projection** over existing `collectedMarkets` + `collectedNews` + `correlations` — no new collection.

**When to use:** Any "what's driving this market" view. It reuses the correlation engine's `newsMatches` (news→market) and `newsSocialMatches` (news→social) outputs.

**Data flow:** `markets` (volume/price) → filter to notable → `newsMatches` (correlated news) → group by contract → attach `yesPrice` direction + news sentiment → write a `marketNewsView` derived snapshot to storage → dashboard reads it.

**Example:**
```typescript
// src/background/correlationNews.ts
export interface MarketDrivenNewsItem {
  contract: MarketContract;
  direction: 'up' | 'down' | 'mixed';   // from yesPrice delta + news sentiment
  news: NewsCorrelationMatch[];          // correlated, sorted by confidence
  signalCount: number;
  volume24h: number;
}

export function buildMarketDrivenNews(
  markets: MarketContract[],
  newsMatches: NewsCorrelationMatch[],
  newsSocialMatches: NewsSocialCorrelationMatch[],
  minVolume: number,
): MarketDrivenNewsItem[] {
  const byContract = new Map<string, MarketDrivenNewsItem>();
  for (const m of newsMatches) {
    if ((m.contract.volume24h ?? 0) < minVolume) continue;
    const item = byContract.get(m.contract.id) ?? {
      contract: m.contract,
      direction: 'neutral',
      news: [],
      signalCount: 0,
      volume24h: m.contract.volume24h ?? 0,
    };
    item.news.push(m);
    byContract.set(m.contract.id, item);
  }
  // direction = sign of (yesPrice - 0.5) blended with mean news sentiment
  return [...byContract.values()]
    .sort((a, b) => b.volume24h - a.volume24h);
}
```

### Pattern 5: Collector Adapter (TikTok fits the existing pattern)

**What:** TikTok has **no public fetch endpoint** (unlike Reddit `.json` or Polymarket Gamma). So the TikTok collector is a **content-script-driven** collector: it scrapes the TikTok discover page DOM and reports via `REPORT_SOCIAL_DATA`, exactly like the news content script reports `REPORT_NEWS_DATA`. The background "collector" is a thin normaliser that converts scraped DOM items into `SocialSignal`s.

**When to use:** Any platform with no public API that the user browses directly.

**Trade-offs:** Collection only happens when the user visits TikTok (no hourly background fetch). This is acceptable — TikTok is a "while you browse" source, not a scheduled one. The empty `src/content/socials/index.ts` must be implemented (it currently does nothing despite being declared).

**Example:**
```typescript
// src/content/socials/index.ts (implement the empty file)
// Scrape TikTok discover page → report as social signals
function scrapeTikTok(): SocialSignal[] {
  // broad selectors for trend titles + view counts
  const items: SocialSignal[] = [];
  document.querySelectorAll('[data-e2e="challenge-item"], [class*="trend"]').forEach((el) => {
    const text = el.textContent?.trim() ?? '';
    if (text.length < 5) return;
    items.push({
      id: `tiktok:${hash(text)}`,
      platform: 'tiktok',
      text,
      author: 'tiktok-trend',
      metrics: { likes: 0, shares: 0, comments: 0, views: parseViews(el) },
      timestamp: new Date().toISOString(),
      keywords: extractKeywords(text),
      sentiment: analyzeSentiment(text).score,
      virality: computeVirality(el),
      url: window.location.href,
    });
  });
  return items;
}
```

## Data Flow

### Request Flow — Correlation (candidate-filtered)

```
[Dashboard useCorrelations]
    ↓ sendMessage('CORRELATE_ALL', {engine, model, requestId})
[Background onMessage handler]  → fire-and-forget { started: true }
    ↓
[runCorrelationAsync]
    ↓ read storage: markets, signals, news
[buildKeywordIndex(contracts)]  ← NEW: O(m) once
    ↓
[correlateAll(ctx, signals, contracts, news)]
    ├─ signals→markets  (candidate-filtered via index)
    ├─ news→markets     (candidate-filtered via index)
    └─ news→social      (candidate-filtered via index)
    ↓
[write correlations → storage]  →  [broadcast CORRELATION_RESULT]
    ↓
[evaluateAlerts(result, settings)]   ← NEW: fires chrome.notifications
    ↓
[buildMarketDrivenNews(...)]        ← NEW: writes marketNewsView snapshot
```

### Request Flow — Alert Notification

```
[Correlation completes]  →  [evaluateAlerts]
    │  read alertState from storage
    │  filter: confidence ≥ threshold AND cooldown elapsed
    │  write updated alertState
    ▼
[chrome.notifications.create(...)]
    │  (user clicks notification)
    ▼
[notifications.onClicked]  →  [open dashboard tab]
```

### Request Flow — Market-Driven News View

```
[Collection completes]  →  [correlation precompute]
    │  newsMatches (news→market) + newsSocialMatches (news→social)
    ▼
[buildMarketDrivenNews(markets, newsMatches, ...)]
    │  filter notable markets (volume/watchlist)
    │  group correlated news by contract
    │  compute direction (yesPrice delta + news sentiment)
    ▼
[write marketNewsView → storage]
    │  chrome.storage.onChanged
    ▼
[Dashboard MarketDrivenNews component renders]
```

### Request Flow — TikTok Collection

```
[User visits tiktok.com]
    │  content script runs (isolated world)
    ▼
[scrapeTikTok() → SocialSignal[]]
    │  sendMessage('REPORT_SOCIAL_DATA', { signals })
    ▼
[Background onMessage REPORT_SOCIAL_DATA]
    │  mergeSignals(existing, incoming)  →  cap applied
    ▼
[storage collectedSignals]
```

### State Management

```
[chrome.storage.local]  ← source of truth
    │  chrome.storage.onChanged
    ▼
[UI hooks (useSnapshot, useCorrelations, useAlerts)]
    │  read snapshot on mount + subscribe to onChanged
    ▼
[React components]
```

### Key Data Flows

1. **Correlation:** `collectedMarkets` + `collectedSignals` + `collectedNews` → `buildKeywordIndex` → `correlateAll` → `correlations` (storage) → `CORRELATION_RESULT` broadcast → dashboard.
2. **Alerts:** `correlations` → `evaluateAlerts` → `alertState` (storage) + `chrome.notifications` → `notifications.onClicked` → dashboard.
3. **Market-driven news:** `collectedMarkets` + `correlations.newsMatches` → `buildMarketDrivenNews` → `marketNewsView` (storage) → dashboard.
4. **TikTok:** TikTok DOM → content script → `REPORT_SOCIAL_DATA` → `mergeSignals` → `collectedSignals` → correlation.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current (~500 markets, ~460 news, ~500 signals) | Inverted index + candidate filtering + per-key caps. No storage migration needed. |
| 2–5× data volume | IndexedDB for large datasets (news/signals history); keep `chrome.storage.local` for the active snapshot only. |
| 10×+ data volume | Move heavy aggregation (market-driven news) to a derived cache; consider a background tab worker for long ML runs. |

### Scaling Priorities

1. **First bottleneck — O(n×m) correlation:** Build the inverted keyword index and candidate pre-filtering across all engines. This is the highest-leverage change and directly addresses the known bottleneck.
2. **Second bottleneck — uncapped accumulation + full re-serialization:** Add per-key caps (`maxSignals`, `maxNews` already exist in config but are not enforced in `mergeSignals`/`mergeNews`) and switch `estimateBytes` to incremental byte estimation instead of full `JSON.stringify` on every budget check.

## Anti-Patterns

### Anti-Pattern 1: `setInterval` for polling in an ephemeral worker

**What people do:** Use `setInterval` to poll for new data or re-check alerts.
**Why it's wrong:** The MV3 service worker is killed after ~30s idle; `setInterval` dies with it. The codebase already documents this.
**Do this instead:** Use `chrome.alarms` for scheduled work, and trigger alert evaluation from the correlation completion path (not a timer).

### Anti-Pattern 2: Rebuilding the keyword index per pair

**What people do:** Keep the O(n×m) nested loop and add a `findCandidateContracts` linear filter per item (as zero-shot does today).
**Why it's wrong:** A linear filter per item is still O(n×m) in the worst case; it only caps the ML label count.
**Do this instead:** Build the inverted index **once** per pass and do hash lookups. This is the difference between O(n×m) and O(n×avg_candidates).

### Anti-Pattern 3: Re-serializing the whole dataset to check the budget

**What people do:** `estimateBytes` calls `JSON.stringify` on the entire dataset every budget check.
**Why it's wrong:** Adds serialization overhead on the hot path after every collection cycle.
**Do this instead:** Track per-key byte sizes incrementally (add/remove deltas) or sample, and only full-serialize when a key changes.

### Anti-Pattern 4: Firing notifications without dedup state

**What people do:** Fire a notification for every match above threshold every cycle.
**Why it's wrong:** The user gets spammed; the same strong correlation re-notifies hourly.
**Do this instead:** Persist `alertState` (last-notified confidence + cooldown) in storage and gate on it.

### Anti-Pattern 5: Adding a TikTok background fetch collector

**What people do:** Try to add a `collectTikTok()` background fetch like Reddit/Polymarket.
**Why it's wrong:** TikTok has no public fetch endpoint; a background fetch would fail or require auth.
**Do this instead:** Make TikTok a content-script-driven collector (scrape the discover page when the user visits), matching the news content-script pattern.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Polymarket Gamma | Direct `fetch()` (host_permissions) | Public API, no key |
| Kalshi v2 | Direct `fetch()` (host_permissions) | Public API, no key |
| Reddit `.json` | Direct `fetch()` (host_permissions) | Public, no auth |
| X trends | Google Trends RSS via rss2json | No free X API |
| News RSS | rss2json.com CORS proxy | Third-party dependency; single point of failure |
| TikTok | Content-script DOM scrape (no fetch) | Only when user visits site |
| Hugging Face CDN | Transformers.js model download | Large models; gate behind opt-in |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Background ↔ Dashboard | `runtime.sendMessage` + `chrome.storage.onChanged` | Typed `Message` union |
| Background ↔ Content scripts | `runtime.sendMessage` (REPORT_*) | Content scripts report scraped data |
| Background ↔ ML Worker | `postMessage` (correlate/progress/result) | Fire-and-forget; worker terminated on idle |
| Correlation engine ↔ Keyword index | Direct function call | Shared `CorrelationContext` |
| Alert engine ↔ Storage | `chrome.storage.local` read/write | Persist `alertState` for dedup |
| Market-driven news ↔ Storage | `chrome.storage.local` read/write | Derived `marketNewsView` snapshot |

## Sources

- Chrome MV3 service worker lifecycle: https://developer.chrome.com/docs/extensions/mv3/service_workers/
- `chrome.alarms` (not `setInterval`): https://developer.chrome.com/docs/extensions/reference/api/alarms
- `chrome.notifications` API: https://developer.chrome.com/docs/extensions/reference/api/notifications
- `chrome.storage.local` quota (~10 MB): https://developer.chrome.com/docs/extensions/reference/api/storage
- Existing codebase: `src/background/index.ts`, `src/services/engine/correlation.ts`, `src/services/engine/ml/zeroshot.ts`, `src/services/collectors/*.ts`, `src/content/news/index.ts`, `src/utils/storage.ts`, `src/manifest.config.ts`, `src/types/index.ts`

---
*Architecture research for: TrendCast (prediction-market correlation extension)*
*Researched: 2026-08-22*
