<!-- refreshed: 2026-08-22 -->
# Architecture

**Analysis Date:** 2026-08-22

## System Overview

TrendCast is a **Manifest V3 browser extension** (Chrome + Firefox) that scrapes social sentiment (X, Reddit, TikTok), news headlines (BBC, CNN, Yahoo Finance, Google News, Seeking Alpha, Investing.com), and prediction market odds (Polymarket, Kalshi), then correlates them client-side. It is **100% client-side** — no API keys, no backend server. All data is collected using the user's own browser sessions and stored in `chrome.storage.local`.

```text
┌─────────────────────────────────────────────────────────────────────┐
│                        UI Layer (React)                              │
│   Dashboard (new tab)          Popup (toolbar)                      │
│  `src/dashboard/`             `src/popup/`                          │
│  App.tsx · components/ ·      App.tsx · components/Settings.tsx     │
│  hooks/ (useSnapshot,         hooks/ (useSettings, useSnapshot,     │
│  useCorrelations)             useCachedMarkets)                     │
└──────────────┬──────────────────────────────┬───────────────────────┘
               │  runtime.sendMessage          │  runtime.sendMessage
               ▼                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Messaging Layer (typed, discriminated union)           │
│                    `src/messaging/`                                  │
│   index.ts (sendMessage, sendTabMessage, onMessage)                  │
│   browser.ts (webextension-polyfill re-export)                       │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Background Service Worker (orchestrator)                │
│                    `src/background/index.ts`                         │
│  alarms → runCollection() → collectors → storage                     │
│  onMessage handlers (REPORT_*, CORRELATE_ALL, etc.)                  │
│  ML Web Worker manager (spawn/terminate)                             │
└──────┬──────────────────────┬──────────────────────┬────────────────┘
       │                      │                      │
       ▼                      ▼                      ▼
┌──────────────┐   ┌────────────────────┐   ┌──────────────────────┐
│ Collectors   │   │ Correlation Engine │   │ ML Web Worker        │
│ src/services/│   │ src/services/engine│   │ src/workers/         │
│ collectors/  │   │ correlation.ts     │   │ ml-worker.ts         │
│ (fetch APIs) │   │ ml/ (embedding,    │   │ (Transformers.js     │
│              │   │ sentiment, zeroshot│   │ ONNX WASM inference) │
│              │   │ ner, llm)          │   │                      │
└──────┬───────┘   └─────────┬──────────┘   └──────────────────────┘
       │                     │
       ▼                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Storage (chrome.storage.local)                    │
│  keys in CONFIG.storage (src/config/index.ts)                       │
│  latestSnapshot · collectedMarkets · collectedSignals ·             │
│  collectedNews · correlations · history · watchlist · settings      │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Background worker | Orchestrates collection, correlation, storage; registers all listeners synchronously | `src/background/index.ts` |
| Config | Centralised URLs, intervals, storage keys, budgets, model IDs | `src/config/index.ts` |
| Messaging | Type-safe discriminated-union message layer with retry + async-response handling | `src/messaging/index.ts`, `src/messaging/browser.ts` |
| Collectors | Fetch/normalise data from public endpoints (Polymarket Gamma, Kalshi v2, Reddit .json, RSS via rss2json) | `src/services/collectors/*.ts` |
| Correlation engine | Heuristic NER + keyword matching | `src/services/engine/correlation.ts` |
| ML engines | Embedding/sentiment/zeroshot/NER/LLM correlation via Transformers.js | `src/services/engine/ml/*.ts` |
| ML Web Worker | Runs ML inference off main thread to avoid Firefox "Stop the script" | `src/workers/ml-worker.ts` |
| Content scripts | Scrape DOM on supported sites, report via messages | `src/content/{news,prediction-markets,socials}/index.ts` |
| Dashboard | New-tab React app (primary UI) | `src/dashboard/` |
| Popup | Quick-launcher React app | `src/popup/` |
| Utils | Keywords, entities, sentiment, export, storage budget, rate limiter, conditional fetch | `src/utils/*.ts` |
| Types | Shared domain types + Message discriminated union | `src/types/index.ts` |

## Pattern Overview

**Overall:** Client-side MV3 extension with a **background-orchestrator + storage-as-state + React-UI** architecture. The background worker is the single orchestrator; the UI reads from `chrome.storage.local` and sends typed messages to trigger actions.

**Key Characteristics:**
- **Storage as the source of truth** — all durable state lives in `chrome.storage.local`; the UI reads snapshots directly from storage and subscribes to `onChanged` events rather than holding in-memory state.
- **Typed message passing** — a discriminated union `Message` type (`src/types/index.ts:368`) drives type-safe `sendMessage`/`onMessage` across contexts.
- **Ephemeral worker awareness** — the MV3 service worker can be killed at any time; code uses `chrome.alarms` (not `setInterval`) and never relies on module-level state persisting.
- **Client-side ML** — Transformers.js + ONNX Runtime Web run models locally in a Web Worker; no LLM API calls.
- **Cross-browser build** — `TARGET=firefox` env var switches the manifest background key and output dir.

## Layers

**UI Layer:**
- Purpose: Render collected data and trigger actions
- Location: `src/dashboard/`, `src/popup/`
- Contains: React components, hooks, CSS
- Depends on: `src/messaging/`, `src/config/`, `src/types/`, `chrome.storage`
- Used by: Browser (new tab override, toolbar popup)

**Messaging Layer:**
- Purpose: Type-safe cross-context communication
- Location: `src/messaging/`
- Contains: `sendMessage`, `sendTabMessage`, `onMessage`, `browser` polyfill re-export
- Depends on: `src/types/` (Message union), `webextension-polyfill`
- Used by: UI, content scripts, background

**Background Orchestrator:**
- Purpose: collection scheduling, message handling, correlation dispatch, ML worker management
- Location: `src/background/index.ts`
- Contains: alarm setup, message handlers, collection logic, correlation runners, ML worker pool
- Depends on: `src/services/`, `src/messaging/`, `src/config/`, `src/types/`, `src/utils/`
- Used by: UI (via messages), content scripts (via messages)

**Service Layer:**
- Purpose: data collection and correlation logic
- Location: `src/services/collectors/`, `src/services/engine/`
- Contains: platform collectors, heuristic + ML correlation engines
- Depends on: `src/config/`, `src/types/`, `src/utils/`, `@huggingface/transformers`
- Used by: background worker, ML worker

**Content Script Layer:**
- Purpose: DOM scraping on supported sites
- Location: `src/content/`
- Contains: news, prediction-markets, socials scrapers
- Depends on: `src/messaging/`, `src/config/`, `src/types/`, `src/utils/`
- Used by: injected into pages per manifest `content_scripts`

**Storage Layer:**
- Purpose: durable state
- Location: `chrome.storage.local` (keys in `src/config/index.ts`)
- Contains: snapshots, collected data, correlations, history, watchlist, settings
- Used by: all layers

## Data Flow

### Primary Collection Path

1. Alarm fires (`chrome.alarms`, hourly) → `setupAlarms()` in `src/background/index.ts`
2. `runCollection()` reads settings, builds per-source tasks (`src/background/index.ts`)
3. Collectors fetch public endpoints: `collectPolymarketMarkets`, `collectKalshiMarkets`, `collectRedditSignals`, `collectXTrends`, `collectNews` (`src/services/collectors/`)
4. Results stored via `storeMarkets`/`storeSignals`/`storeNews` into `chrome.storage.local`
5. A `CollectionSnapshot` is built and written to `CONFIG.storage.latestSnapshot`
6. History entry appended; `pruneStorageIfNeeded()` enforces the storage budget
7. `runCorrelationPrecompute()` pre-computes correlations in the background

### Content Script → Background Path

1. User visits a supported site; content script runs at `document_idle` (`src/content/*/index.ts`)
2. Script scrapes the DOM (headlines, market cards, social posts)
3. `sendMessage('REPORT_MARKET_DATA' | 'REPORT_SOCIAL_DATA' | 'REPORT_NEWS_DATA', ...)` sends data
4. Background handler merges with existing stored data and persists (`src/background/index.ts`)

### Correlation Request Path

1. Dashboard `useCorrelations` hook calls `sendMessage('CORRELATE_ALL', { engine, model, requestId })` (`src/dashboard/hooks/useCorrelations.ts`)
2. Background handler is **fire-and-forget** — returns `{ started: true }` immediately to avoid Firefox message-channel timeout
3. `runCorrelationAsync()` loads data, runs `runCorrelationWithEngine()` (heuristic inline, or ML via Web Worker)
4. Result written to `CONFIG.storage.correlations` and broadcast via `CORRELATION_RESULT` message
5. UI listens for `CORRELATION_PROGRESS` and `CORRELATION_RESULT` messages

**State Management:**
- All durable state in `chrome.storage.local` (keys in `src/config/index.ts`)
- UI hooks subscribe to `chrome.storage.onChanged` to react to background updates
- No global in-memory store; the background worker holds only transient ML worker references

## Key Abstractions

**Message (discriminated union):**
- Purpose: type-safe contract for all cross-context communication
- Examples: `src/types/index.ts` (lines 368–410)
- Pattern: `{ type: '...'; payload: ... }` union; `MessageType = Message['type']`

**Collector functions:**
- Purpose: normalise external data into domain types (`MarketContract`, `SocialSignal`, `NewsItem`)
- Examples: `src/services/collectors/polymarket.ts`, `kalshi.ts`, `reddit.ts`, `x-trends.ts`, `news.ts`
- Pattern: `collectX(): Promise<DomainType[]>` using `conditionalFetchJson`

**Correlation engine functions:**
- Purpose: match signals/news to markets with a confidence score
- Examples: `src/services/engine/correlation.ts` (heuristic), `src/services/engine/ml/*.ts` (ML)
- Pattern: `correlate*` functions returning `CorrelationResult`

**React hooks:**
- Purpose: encapsulate storage reads + message sends for the UI
- Examples: `src/dashboard/hooks/useSnapshot.ts`, `useCorrelations.ts`, `src/popup/hooks/useSettings.ts`, `useCachedMarkets.ts`
- Pattern: read from storage on mount, subscribe to `chrome.storage.onChanged`

## Entry Points

**Background Service Worker:**
- Location: `src/background/index.ts`
- Triggers: extension install/update, `chrome.alarms`, runtime messages
- Responsibilities: register listeners synchronously, run collection, run correlation, manage ML worker

**Dashboard (new tab):**
- Location: `src/dashboard/index.tsx` → `src/dashboard/App.tsx`
- Triggers: user opens a new tab (via `chrome_url_overrides.newtab` in `src/manifest.config.ts`)
- Responsibilities: render full-page React app

**Popup:**
- Location: `src/popup/index.tsx` → `src/popup/App.tsx`
- Triggers: user clicks the toolbar icon (via `action.default_popup` in `src/manifest.config.ts`)
- Responsibilities: quick-launcher with settings, collect button, stats

**Content Scripts:**
- Location: `src/content/{news,prediction-markets,socials}/index.ts`
- Triggers: page load on matching domains (manifest `content_scripts`)
- Responsibilities: DOM scraping + reporting

**ML Web Worker:**
- Location: `src/workers/ml-worker.ts`
- Triggers: spawned by background when an ML engine is selected
- Responsibilities: run ML inference off main thread, post progress/results

## Architectural Constraints

- **Threading:** Single-threaded event loop for the background worker. ML inference is offloaded to a dedicated Web Worker (`src/workers/ml-worker.ts`) to avoid blocking the main thread and the Firefox "Stop the script" dialog. The worker is created on demand and terminated after 5 min idle (`ML_WORKER_IDLE_TIMEOUT_MS` in `src/background/index.ts`).
- **Global state:** The background worker holds transient module-level ML state (`mlWorker`, `mlWorkerResolvers`, `mlWorkerTimeout` in `src/background/index.ts`). This is intentionally non-durable — the MV3 worker may be killed at any time. `src/utils/conditional-fetch.ts` keeps an in-memory `cacheMemory` mirror of the fetch cache. `src/services/engine/correlation.ts` uses an `EntityCache` class instance for NER caching.
- **Circular imports:** None detected. The dependency graph is acyclic: `types` → `config` → `utils` → `services` → `background`; `messaging` is a leaf used by all.
- **Ephemeral worker:** Never use `setInterval` for long-running polling; use `chrome.alarms`. Never rely on module-level state persisting; use `chrome.storage.local`.
- **Cross-browser:** Firefox does not support `background.service_worker`; the manifest switches to `background.scripts` based on `TARGET=firefox` (`src/manifest.config.ts`). Firefox also lacks `chrome.sidePanel`, so the extension uses popup + new tab override.
- **Content script isolation:** Content scripts run in an isolated world and can only read the DOM, not page JS variables.

## Anti-Patterns

### Fire-and-forget long-running message handlers

**What happens:** `CORRELATE_ALL` returns `{ started: true }` immediately and runs correlation asynchronously (`src/background/index.ts`). This is a deliberate workaround for Firefox's "Promised response went out of scope" timeout.
**Why it's wrong:** It's a workaround, not a clean pattern — the caller must poll storage or listen for a broadcast message to learn the result.
**Do this instead:** Keep the fire-and-forget pattern for long-running ML ops, but ensure the UI always listens for `CORRELATION_RESULT` and `CORRELATION_PROGRESS` messages (as `useCorrelations` does).

### In-memory rate limiter in an ephemeral worker

**What happens:** `src/utils/rate-limiter.ts` keeps token-bucket state in memory.
**Why it's wrong:** The MV3 service worker can be killed between messages, losing rate-limit state.
**Do this instead:** For strict rate limiting, persist bucket state to `chrome.storage`. The code notes this is acceptable for the current 5-min polling cadence.

## Error Handling

**Strategy:** Per-collector `try/catch` with `Promise.allSettled` in `runCollection()` (`src/background/index.ts`). Individual source failures are logged and do not abort the whole cycle.

**Patterns:**
- Collectors return empty arrays on failure rather than throwing (e.g., `collectNews` uses `Promise.allSettled` and filters rejected results).
- `conditionalFetchJson` returns `null` on 304 Not Modified so collectors skip unchanged data.
- Messaging layer retries once on Firefox "out of scope" / "message channel closed" errors (`src/messaging/index.ts`).
- ML correlation failures return a result with an `error` message and `engine` set to `'heuristic'` with empty arrays — the UI is responsible for surfacing the error.

## Cross-Cutting Concerns

**Logging:** `console.log`/`console.warn`/`console.error` with a `[TrendCast]` prefix throughout. No logging framework.
**Validation:** TypeScript types enforce domain shapes; collectors normalise raw API data into typed domain objects. No runtime schema validation library.
**Authentication:** None — the extension is fully client-side with no API keys. It relies on the user's existing browser sessions for authenticated scraping.

---

*Architecture analysis: 2026-08-22*
