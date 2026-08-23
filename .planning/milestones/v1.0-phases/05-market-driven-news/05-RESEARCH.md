# Phase 5: Market-Driven News - Research

**Researched:** 2026-08-23
**Domain:** Read-only derived "market-driven news" view over existing markets + news + correlations (MV3 browser extension, React dashboard)
**Confidence:** HIGH

## Summary

Phase 5 delivers a read-only "market-driven news" view that flips the correlation: instead of "here's news → which markets," it starts from **notable markets** (volume ≥ `minVolume` OR watchlisted), finds their correlated news, and surfaces the **directional implication** (Yes-price delta blended with mean news sentiment). The view is organized by a consistent 3-category taxonomy (finance / politics / technology) with deterministic precedence (politics > finance > tech). It is a **derived projection** over existing `collectedMarkets` + `collectedNews` + `correlations` — no new collection, no new runtime dependencies.

The architecture is a clean extension of the proven **background-orchestrator + storage-as-state + React-UI** pattern already used by Phase 4's alerts. A single-source taxonomy module (`src/config/taxonomy.ts`) classifies each `NewsItem` at collection time (persisting a `category` field). A pure aggregation module (`src/background/correlationNews.ts`) reads markets + `correlations.newsMatches` + the watchlist, filters notable markets, groups correlated news by contract, computes direction, and writes a bounded `marketNewsView` snapshot to `chrome.storage.local`. The dashboard reads that snapshot via a `useMarketNews` hook (mirroring `useAlerts`) and renders it in a new "📰 Market News" tab reusing `VirtualizedGrid`.

**Primary recommendation:** Build the taxonomy as a single-source, versioned module with deterministic precedence; persist `category` on `NewsItem` at collection time (backfill on read for old records); write a bounded `marketNewsView` snapshot after each correlation completes (same hook points as `runAlertSweep`); render via a `useMarketNews` hook + `MarketDrivenNews` component reusing `VirtualizedGrid`. Zero new runtime dependencies.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Define the taxonomy **once** in a single `src/config/taxonomy.ts` module — stable category ID, label, keyword/entity rules, and precedence order. Referenced by the classifier, the UI, and export. — **Reversibility:** reversible — new module, no contract.
- **D-02:** Assign a news item's category **at collection time** — persist `category` on `NewsItem` when stored, so the view + export read it consistently. — **Reversibility:** reversible — additive field on `NewsItem`.
- **D-03:** v1 is scoped to **3 categories: finance, politics, technology**, reusing the `redditCategories` labels. — **Reversibility:** reversible — taxonomy is extensible.
- **D-04:** Resolve overlaps with **deterministic precedence: politics > finance > tech** — a headline maps to exactly one category (mutual exclusivity). — **Reversibility:** reversible — precedence order is data, not contract.
- **D-05:** A market is "notable" if `volume24h ≥ minVolume` **OR** it is watchlisted. — **Reversibility:** reversible — local filter logic.
- **D-06:** Default `minVolume` is a **configurable constant, $10k**. — **Reversibility:** reversible — config value.
- **D-07:** Direction is computed by **blending the Yes-price delta with the mean correlated-news sentiment** — `direction = sign(yesPrice - 0.5)` blended with mean news sentiment. — **Reversibility:** reversible — local computation.
- **D-08:** Markets are **sorted by volume descending** within each category. — **Reversibility:** reversible — sort order.
- **D-09:** The view is **grouped by category** (finance / politics / tech sections), each listing its notable markets with correlated news + direction. — **Reversibility:** reversible — UI-only.
- **D-10:** It lives in a **new dedicated dashboard tab** "📰 Market News" (alongside feed/markets/news/correlations/watchlist/alerts/history/community/faq/settings). — **Reversibility:** reversible — UI-only.
- **D-11:** The view reads a **read-only derived snapshot** — `buildMarketDrivenNews` writes a `marketNewsView` snapshot to storage after correlation; the dashboard reads it via a `useMarketNews` hook (mirrors `useAlerts`). — **Reversibility:** reversible — derived cache, no contract.
- **D-12:** Rendering **reuses `VirtualizedGrid`** for the news lists within each category (same pattern as NewsFeed/HypeFeed) so large result sets don't regress responsiveness. — **Reversibility:** reversible — UI-only.
- **D-13:** The derived view is stored in **`chrome.storage.local` key `trendcast:market-news-view`** — a derived snapshot written after correlation, read by the dashboard. — **Reversibility:** reversible — new storage key.
- **D-14:** The snapshot is **bounded** — cap the number of markets per category (top N by volume) so the snapshot stays small and storage stays within budget. — **Reversibility:** reversible — cap constant.
- **D-15:** The snapshot is **rebuilt after each correlation completes** (same hook points as `evaluateAlerts` — after `runCorrelationPrecompute` and `runCorrelationAsync`). — **Reversibility:** reversible — hook wiring.
- **D-16:** Add `trendcast:market-news` to **`BUDGET_KEYS`** in `src/utils/storage.ts` so pruning accounts for it (same as alert keys in Phase 4). — **Reversibility:** reversible — array entry.

### the agent's Discretion
All four grey areas were discussed and accepted. The agent has discretion on implementation details not covered above: exact keyword/entity rules per category, the `minVolume`/cap constant values, the `MarketDrivenNewsItem` shape, and the `useMarketNews` hook internals — following the research (ARCHITECTURE.md Pattern 4, PITFALLS.md Pitfall 3, FEATURES.md, SUMMARY.md).

### Deferred Ideas (OUT OF SCOPE)
- **Full category taxonomy (sports, entertainment, crypto, economics)** — expanding the market-driven view beyond 3 categories is deferred (research FEATURES.md P3). Noted for a future phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MKT-01 | User can see a "market-driven news" view — important markets → news/direction they imply (finance + politics + tech) | `buildMarketDrivenNews` aggregation (Pattern 4), `marketNewsView` snapshot, `useMarketNews` hook + `MarketDrivenNews` component + new tab |
| MKT-02 | User sees a consistent category taxonomy (reuse Reddit categories across markets + news) | Single-source `src/config/taxonomy.ts` module, `category` persisted on `NewsItem` at collection time, deterministic precedence (politics > finance > tech) |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Category classification (headline → category) | API / Backend (background) | — | Runs at collection time in the background worker (`collectNews`), not in the browser UI — the category must be persisted on `NewsItem` before storage |
| Taxonomy definition | Config / shared module | — | `src/config/taxonomy.ts` is a pure data module referenced by classifier, UI, and export — no tier owns it, it's shared |
| Market selection (notable filter) | API / Backend (background) | — | `buildMarketDrivenNews` runs in the background after correlation; reads markets + watchlist from storage |
| Direction computation | API / Backend (background) | — | Blends Yes-price delta + mean news sentiment in `buildMarketDrivenNews` (mirrors `deriveDirection` in alerts) |
| Derived snapshot persistence | Storage | — | `marketNewsView` written to `chrome.storage.local` after correlation; read by dashboard |
| View rendering | Browser / Client (dashboard) | — | `MarketDrivenNews` component + `useMarketNews` hook + new tab in `App.tsx`; `VirtualizedGrid` for responsiveness |
| Storage budget accounting | Storage | — | `trendcast:market-news` added to `BUDGET_KEYS` so pruning accounts for the snapshot |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.5 strict | All new modules (`taxonomy.ts`, `correlationNews.ts`, types, hook, component) | Existing project language; strict mode catches schema drift |
| React 18 | 18.x | `MarketDrivenNews` component + `useMarketNews` hook | Existing dashboard stack |
| `@tanstack/react-virtual` | (existing) | `VirtualizedGrid` reuse for responsive news lists | Already the dashboard virtualization helper |
| `webextension-polyfill` | (existing) | `browser.storage.local` read/write in background + dashboard | Existing messaging/storage abstraction |
| Vitest | ^2.0.5 | Unit tests for taxonomy + aggregation | Existing test runner (`npm test`) |

**No new runtime dependencies.** This phase is dependency-light hardening on the proven stack — the taxonomy, aggregation, and snapshot are all hand-rolled pure functions over existing types.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled keyword taxonomy | `flexsearch` / ML classifier | Overkill for 3 categories; keyword/entity rules are deterministic, dependency-free, and testable; `flexsearch` deferred in SUMMARY.md |
| Storage snapshot | Recompute on every dashboard render | Recomputing in the UI would duplicate background logic and add render-time latency; a derived snapshot is the established storage-as-state pattern |
| New `MARKET_NEWS_UPDATED` message | `chrome.storage.onChanged` listener | A storage listener is simpler and more robust (no new `Message` variant, survives missed broadcasts); the snapshot is already persisted |

## Package Legitimacy Audit

> No external packages are installed in this phase. All work reuses the existing stack (TypeScript, React, `@tanstack/react-virtual`, `webextension-polyfill`, Vitest). No package legitimacy gate required.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```text
[Collection completes]  →  [correlation precompute / async]
    │  markets + news + correlations.newsMatches
    ▼
[buildMarketDrivenNews(markets, newsMatches, watchlist, minVolume, cap)]
    │  filter notable markets (volume ≥ minVolume OR watchlisted)
    │  group correlated news by contract
    │  compute direction (yesPrice delta + mean news sentiment)
    │  sort by volume desc, cap per category
    ▼
[write marketNewsView → chrome.storage.local]
    │  chrome.storage.onChanged
    ▼
[Dashboard useMarketNews hook]  →  [MarketDrivenNews component]
    │  grouped by category (finance / politics / tech)
    ▼
[VirtualizedGrid renders news lists per category]
```

### Recommended Project Structure
```
src/
├── config/
│   ├── index.ts              # + CONFIG.storage.marketNewsView, CONFIG.marketNews.{minVolume,capPerCategory}
│   └── taxonomy.ts           # NEW: single-source category taxonomy + classifyNewsCategory()
├── types/
│   └── index.ts              # + NewsCategory, category on NewsItem, MarketDrivenNewsItem, MarketNewsView
├── background/
│   ├── index.ts              # call buildMarketDrivenNews() after runAlertSweep() in both hook points
│   └── correlationNews.ts    # NEW: buildMarketDrivenNews() aggregation module
├── utils/
│   └── storage.ts            # + 'trendcast:market-news' to BUDGET_KEYS
└── dashboard/
    ├── App.tsx               # + 'market-news' tab + useMarketNews + MarketDrivenNews
    ├── hooks/
    │   └── useMarketNews.ts  # NEW: loads snapshot on mount + storage.onChanged listener
    └── components/
        └── MarketDrivenNews.tsx  # NEW: grouped-by-category view reusing VirtualizedGrid
```

### Pattern 1: Single-Source Category Taxonomy (PITFALLS.md Pitfall 3)

**What:** Define the taxonomy once in `src/config/taxonomy.ts` with stable category IDs, labels, keyword/entity rules, and a deterministic precedence order. A `classify()` function maps a headline to exactly one category.

**When to use:** Every place that needs a category — the classifier (collection time), the dashboard UI (section labels), and export (Phase 6). Single source prevents drift.

**Example:**
```typescript
// src/config/taxonomy.ts
export type NewsCategory = 'finance' | 'politics' | 'technology';

export interface CategoryRule {
  id: NewsCategory;
  label: string;                 // reuse redditCategories label
  keywords: string[];            // lowercase keyword/entity rules
}

// Precedence order: politics > finance > tech (D-04). First match wins.
export const CATEGORY_ORDER: NewsCategory[] = ['politics', 'finance', 'technology'];

export const CATEGORY_RULES: Record<NewsCategory, CategoryRule> = {
  politics: { id: 'politics', label: '🏛️ Politics', keywords: ['election', 'senate', 'congress', 'president', 'geopolitics', 'war', 'tariff'] },
  finance:  { id: 'finance',  label: '💰 Finance & Stock Market', keywords: ['stock', 'fed', 'rate', 'earnings', 'inflation', 'bitcoin', 'market'] },
  technology: { id: 'technology', label: '💻 Technology', keywords: ['ai', 'chip', 'semiconductor', 'software', 'startup', 'tech'] },
};

/** Classify a headline into exactly one category (mutual exclusivity via precedence). */
export function classifyCategory(headline: string): NewsCategory {
  const text = headline.toLowerCase();
  for (const id of CATEGORY_ORDER) {
    if (CATEGORY_RULES[id].keywords.some((kw) => text.includes(kw))) return id;
  }
  return 'finance'; // default fallback (finance is the app's focus)
}
```

**Key design points:**
- **Precedence is data, not contract** (D-04): `CATEGORY_ORDER` array is the single place that encodes "politics > finance > tech." Reordering it changes classification without touching rules.
- **Mutual exclusivity**: first-match-wins guarantees a headline maps to exactly one category — no double-counting.
- **Versioned**: add a `TAXONOMY_VERSION` constant; when rules change, re-classify stored items or document that old items keep their old category (Pitfall 3).

### Pattern 2: Category Persisted at Collection Time (D-02)

**What:** Add `category: NewsCategory` to `NewsItem` and assign it in `collectNews` (`src/services/collectors/news.ts`) when each `NewsItem` is built, so the view + export read it consistently.

**Why:** Classifying at render time causes drift (Pitfall 3) — the dashboard and export would disagree. Persisting at collection time makes category a stable property of the stored item.

**Backfill strategy:** Existing stored `NewsItem`s lack `category`. Since the field is additive and optional-safe, backfill **on read** in `getCollectedNews()` (or in `buildMarketDrivenNews`) — if `item.category` is undefined, classify it from `item.headline` on the fly. This avoids a one-time migration and keeps old data rendering. The `NewsItem` type should make `category` optional (`category?: NewsCategory`) so old records don't crash the typecheck.

### Pattern 3: Market-Driven News Aggregation (ARCHITECTURE.md Pattern 4)

**What:** `buildMarketDrivenNews` in `src/background/correlationNews.ts` — a pure function that reads markets + `correlations.newsMatches` + the watchlist, filters notable markets, groups correlated news by contract, computes direction, sorts by volume, and caps per category.

**Source of truth for the shape** (ARCHITECTURE.md Pattern 4, extended for category grouping + watchlist):
```typescript
// src/background/correlationNews.ts
export interface MarketDrivenNewsItem {
  contract: MarketContract;
  category: NewsCategory;              // from the contract's correlated news (majority) or market keywords
  direction: 'up' | 'down' | 'mixed';  // from yesPrice delta + mean news sentiment
  news: NewsCorrelationMatch[];        // correlated, sorted by confidence desc
  signalCount: number;
  volume24h: number;
}

export interface MarketNewsView {
  builtAt: number;
  categories: Record<NewsCategory, MarketDrivenNewsItem[]>;  // each capped + sorted by volume desc
}

export function buildMarketDrivenNews(
  markets: MarketContract[],
  newsMatches: NewsCorrelationMatch[],
  watchlist: WatchlistEntry[],
  minVolume: number,
  capPerCategory: number,
): MarketNewsView
```

**Algorithm:**
1. Build a `Set` of watchlisted contract IDs.
2. Filter `newsMatches` to contracts that are notable: `(contract.volume24h ?? 0) >= minVolume` OR watchlisted (D-05).
3. Group the filtered matches by `contract.id` into `MarketDrivenNewsItem`s.
4. Compute `direction` per contract (D-07): `sign(yesPrice - 0.5)` blended with mean news sentiment. Reuse the `yesPriceOf` helper pattern from `alerts.ts` (find the outcome whose label is `'yes'`).
5. Assign `category` per contract — derive from the majority category of its correlated news items (each `NewsCorrelationMatch.news.category`), falling back to classifying the contract question via `classifyCategory`.
6. Sort each category's items by `volume24h` descending (D-08), then `slice(0, capPerCategory)` (D-14).
7. Return the `MarketNewsView` grouped by category (D-09).

### Pattern 4: Derived Snapshot + Storage (D-11, D-13, D-15, D-16)

**What:** Write the `MarketNewsView` to `chrome.storage.local` under `CONFIG.storage.marketNewsView` after each correlation completes, and add the key to `BUDGET_KEYS`.

**Hook points** (D-15): call `buildMarketDrivenNews()` right after `runAlertSweep()` in both `runCorrelationPrecompute()` (`src/background/index.ts:768`) and `runCorrelationAsync()` (`src/background/index.ts:629`). This mirrors exactly where Phase 4 wired `evaluateAlerts`.

**Config additions** (`src/config/index.ts`):
```typescript
storage: {
  // ...existing keys...
  marketNewsView: 'trendcast:market-news-view',   // D-13
},
marketNews: {
  minVolume: 10_000,          // D-06: $10k default
  capPerCategory: 20,         // D-14: top N markets per category
},
```

**BUDGET_KEYS** (`src/utils/storage.ts`): add `CONFIG.storage.marketNewsView` to the array (D-16). Note the CONTEXT says the key is `trendcast:market-news` in D-16 but D-13 says `trendcast:market-news-view` — **use `trendcast:market-news-view`** (the D-13 canonical key) as the single storage key, and add that exact string to `BUDGET_KEYS`. The D-16 "trendcast:market-news" is a shorthand; the storage key must be consistent with D-13.

### Pattern 5: Dashboard View (D-10, D-11, D-12)

**`useMarketNews` hook** (`src/dashboard/hooks/useMarketNews.ts`) — mirrors `useAlerts`:
- Load cached `MarketNewsView` from `CONFIG.storage.marketNewsView` on mount.
- Listen to `chrome.storage.onChanged` for the `marketNewsView` key (the background writes it after correlation) and update state. This is more robust than a message broadcast — no new `Message` variant needed, and it survives missed broadcasts.

**`MarketDrivenNews` component** (`src/dashboard/components/MarketDrivenNews.tsx`) — mirrors `AlertsTab`:
- Read-only, theme-aware, memoized.
- For each category in `CATEGORY_ORDER` (politics, finance, technology), render a section header + a `VirtualizedGrid` of market cards.
- Each card shows: market question, direction badge (▲/▼/◆ reusing the `directionBadges` color contract from `AlertsTab`), volume, and the top correlated news headlines.

**`App.tsx`**:
- Add `'market-news'` to the `Tab` union (line 54).
- Add `['market-news', '📰 Market News']` to the tab nav array (lines 276-299).
- Add `{activeTab === 'market-news' && <MarketDrivenNews ... />}` in the main content.

### Anti-Patterns to Avoid
- **Hardcoding the taxonomy in the view** (Pitfall 3): never define keyword lists in `MarketDrivenNews.tsx` or `correlationNews.ts` — always import from `src/config/taxonomy.ts`.
- **Classifying at render time**: category must be persisted on `NewsItem` at collection time, not computed in the dashboard — otherwise dashboard and export disagree.
- **Unbounded snapshot**: without `capPerCategory`, the snapshot grows with every notable market and eats the storage budget — always `slice(0, cap)`.
- **Recomputing in the renderer**: the dashboard must read the derived snapshot, not re-run aggregation — keeps render latency low and logic in one place.
- **Non-virtualized news lists**: large result sets must go through `VirtualizedGrid`, not raw `.map()` — otherwise dashboard responsiveness regresses (PERF-01).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Category classification | A bespoke ML classifier | Deterministic keyword/entity rules in `taxonomy.ts` | 3 categories, deterministic, dependency-free, trivially testable; ML is overkill and adds a runtime dep |
| Direction computation | A new direction algorithm | Reuse the `deriveDirection`/`yesPriceOf` pattern from `alerts.ts` | Same semantics (sentiment + Yes-price delta); consistency across alerts + market view |
| Responsive rendering | Hand-rolled windowing | `VirtualizedGrid` (`@tanstack/react-virtual`) | Already the dashboard's virtualization helper; reusing it preserves PERF-01 |
| Storage read/write | Direct `chrome.storage` calls scattered | `browser.storage.local` via `@/messaging/browser` + `CONFIG.storage` keys | Existing abstraction; cross-browser via polyfill |

**Key insight:** This phase is pure derived-projection logic over existing types and storage. Every "hard" problem (classification, direction, virtualization, storage) already has an established pattern in the codebase — the research is unanimous that we must **not** introduce new machinery.

## Common Pitfalls

### Pitfall 1: Category Taxonomy Drift (PITFALLS.md Pitfall 3)
**What goes wrong:** The same headline classified differently across runs, or shown under two categories.
**Why it happens:** Categories defined ad-hoc in multiple files; overlapping rules (e.g. "Fed rate" is both finance and politics).
**How to avoid:** Single-source `taxonomy.ts`; deterministic precedence (politics > finance > tech); persist `category` at collection time; version the taxonomy.
**Warning signs:** Same headline under two categories; dashboard labels ≠ export labels; adding a category requires editing multiple files.

### Pitfall 2: Old Stored News Has No `category` Field
**What goes wrong:** Dashboard throws on `undefined` category, or the view silently drops all pre-existing news.
**Why it happens:** `NewsItem` gains a new field; existing stored records lack it (schema drift, Pitfall 8).
**How to avoid:** Make `category` optional on `NewsItem`; backfill on read in `buildMarketDrivenNews` (classify from `headline` when `category` is undefined).
**Warning signs:** `undefined` category in the view; empty market-news tab after an upgrade.

### Pitfall 3: Unbounded Snapshot Blows the Storage Budget
**What goes wrong:** The `marketNewsView` snapshot grows with every notable market, eating the ~7 MB budget.
**Why it happens:** No per-category cap; every volume-qualifying market is persisted.
**How to avoid:** `capPerCategory` (top N by volume) + add the key to `BUDGET_KEYS` so pruning accounts for it.
**Warning signs:** `marketNewsView` byte size grows monotonically; QUOTA errors.

### Pitfall 4: Dashboard Responsiveness Regression
**What goes wrong:** The Market News tab freezes with many markets/news.
**Why it happens:** Non-virtualized `.map()` over large per-category lists.
**How to avoid:** Always render news lists through `VirtualizedGrid` (D-12).
**Warning signs:** Tab switch jank; scroll lag with many cards.

### Pitfall 5: Direction Semantics Drift from Alerts
**What goes wrong:** The market-driven view's direction disagrees with the alerts tab for the same market.
**Why it happens:** Two different direction formulas.
**How to avoid:** Reuse the `yesPriceOf` + sentiment-blend pattern from `alerts.ts`; keep the same `'up' | 'down' | 'mixed'` semantics (map to the `AlertDirection`-style labels).
**Warning signs:** Same market shows bullish in alerts but bearish in market news.

## Code Examples

### Classify a headline (taxonomy.ts)
```typescript
// Source: this research (Pattern 1) — deterministic keyword rules
import { CATEGORY_ORDER, CATEGORY_RULES, type NewsCategory } from '@/config/taxonomy';

export function classifyCategory(headline: string): NewsCategory {
  const text = headline.toLowerCase();
  for (const id of CATEGORY_ORDER) {
    if (CATEGORY_RULES[id].keywords.some((kw) => text.includes(kw))) return id;
  }
  return 'finance';
}
```

### Assign category at collection time (news.ts)
```typescript
// In collectFromSource, when building each NewsItem:
return {
  id: `${source}:${link}`,
  source,
  headline,
  summary: description,
  url: link,
  publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
  keywords: extractKeywords(fullText),
  imageUrl: imageUrl ?? undefined,
  category: classifyCategory(headline),   // D-02: persist at collection time
} satisfies NewsItem;
```

### Build the derived snapshot (correlationNews.ts)
```ts
// Source: ARCHITECTURE.md Pattern 4, adapted for category + watchlist + cap
export async function buildMarketDrivenNews(
  markets: MarketContract[],
  newsMatches: NewsCorrelationMatch[],
  watchlist: WatchlistEntry[],
  minVolume: number,
  capPerCategory: number,
): Promise<MarketNewsView> {
  const watchlisted = new Set(watchlist.map((w) => w.contractId));
  const byContract = new Map<string, MarketDrivenNewsItem>();

  for (const m of newsMatches) {
    const vol = m.contract.volume24h ?? 0;
    if (vol < minVolume && !watchlisted.has(m.contract.id)) continue; // D-05
    const item = byContract.get(m.contract.id) ?? {
      contract: m.contract,
      category: classifyCategory(m.contract.question),
      direction: 'mixed',
      news: [],
      signalCount: 0,
      volume24h: vol,
    };
    item.news.push(m);
    byContract.set(m.contract.id, item);
  }

  // Direction = sign(yesPrice - 0.5) blended with mean news sentiment (D-07).
  for (const item of byContract.values()) {
    const yes = item.contract.outcomes.find((o) => o.label.toLowerCase() === 'yes')?.price;
    const meanSentiment = item.news.length
      ? item.news.reduce((s, m) => s + (m.news.sentiment ?? 0), 0) / item.news.length
      : 0;
    const priceSignal = yes !== undefined ? Math.sign(yes - 0.5) : 0;
    const sentimentSignal = Math.sign(meanSentiment);
    item.direction = priceSignal + sentimentSignal > 0 ? 'up' : priceSignal + sentimentSignal < 0 ? 'down' : 'mixed';
  }

  // Group by category, sort by volume desc, cap per category (D-08, D-14).
  const view: MarketNewsView = { builtAt: Date.now(), categories: { finance: [], politics: [], technology: [] } };
  for (const item of byContract.values()) {
    const cat = item.category;
    view.categories[cat].push(item);
  }
  for (const cat of Object.keys(view.categories) as NewsCategory[]) {
    view.categories[cat].sort((a, b) => b.volume24h - a.volume24h);
    view.categories[cat] = view.categories[cat].slice(0, capPerCategory);
  }
  return view;
}
```

### useMarketNews hook (mirrors useAlerts + useSnapshot)
```ts
// src/dashboard/hooks/useMarketNews.ts
export function useMarketNews() {
  const [view, setView] = useState<MarketNewsView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    browser.storage.local.get(CONFIG.storage.marketNewsView)
      .then((r) => { const v = r[CONFIG.storage.marketNewsView]; if (v) setView(v); })
      .finally(() => setLoading(false));

    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      if (changes[CONFIG.storage.marketNewsView]?.newValue) {
        setView(changes[CONFIG.storage.marketNewsView].newValue as MarketNewsView);
      }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);

  return { view, loading };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Correlation view: news → markets | Market-driven view: markets → news + direction | This phase | Flips the correlation to surface *why* a market is moving (flagship differentiator) |
| Ad-hoc category labels | Single-source `taxonomy.ts` with deterministic precedence | This phase | Consistent classification across classifier, UI, and export |
| No category on `NewsItem` | `category` persisted at collection time | This phase | Stable, drift-free classification |

**Deprecated/outdated:**
- None — this phase adds new capability without deprecating existing behavior.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `NewsItem` gains an optional `category` field; old records backfilled on read | Category Persistence | If made required, old stored records crash the typecheck/UI — keep optional + backfill |
| A2 | Direction semantics reuse the `yesPriceOf` + sentiment-blend pattern from `alerts.ts` | Aggregation | If a different formula is used, the view may disagree with alerts — reuse the same helper |
| A3 | The `marketNewsView` storage key is `trendcast:market-news-view` (D-13), and `BUDGET_KEYS` uses that exact string | Storage | D-16 says `trendcast:market-news`; the plan must use the D-13 canonical key consistently |
| A4 | Category is derived from the majority of a contract's correlated news, falling back to the contract question | Aggregation | If a market has no correlated news, it won't appear — acceptable (view is news-driven) |
| A5 | `minVolume` default $10k and `capPerCategory` (e.g. 12) are configurable constants | Config | Values are tunable; no contract impact |

## Open Questions (RESOLVED)

1. **Category assignment for a market with no correlated news** — RESOLVED
   - What we know: `buildMarketDrivenNews` only includes contracts that appear in `newsMatches` (news-driven view).
   - What's unclear: whether a notable market with zero correlated news should still appear (with empty news list) or be omitted.
   - Recommendation: omit it — the view is "market-driven **news**"; a market with no news has nothing to surface. Document this in the plan.
   - Resolution: Plan 02 Task 1 explicitly omits contracts with no correlated news (Open Question 1 recommendation).

2. **`category` on `NewsItem` — optional vs required** — RESOLVED
   - What we know: existing stored records lack the field; new records get it at collection time.
   - What's unclear: whether to make it required (and migrate) or optional (and backfill on read).
   - Recommendation: optional + backfill on read (no migration, no crash). The plan should add a backfill step in `buildMarketDrivenNews`.
   - Resolution: Plan 01 Task 2 makes `category` optional on `NewsItem`; Plan 02 Task 1 backfills on read via `classifyCategory(news.headline)`.

## Environment Availability

> This phase has no external dependencies beyond the existing codebase and test tooling. No new tools, services, or runtimes are required.

**Step 2.6: SKIPPED (no external dependencies identified)** — the phase is pure derived-projection logic over existing storage + React components; it reuses the existing Vitest/Playwright toolchain already installed.

## Validation Architecture

> `workflow.nyquist_validation` is `true` in `.planning/config.json` — include this section.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^2.0.5 |
| Config file | none — see `package.json` `"test": "vitest run"` |
| Quick run command | `bun run test -- tests/unit/taxonomy.test.ts tests/unit/correlation-news.test.ts` |
| Full suite command | `bun run test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MKT-02 | Taxonomy classifies a headline into exactly one category with precedence (politics > finance > tech) | unit | `bun run test -- tests/unit/taxonomy.test.ts` | ❌ Wave 0 |
| MKT-01 | `buildMarketDrivenNews` filters notable markets (volume ≥ minVolume OR watchlisted) | unit | `bun run test -- tests/unit/correlation-news.test.ts` | ❌ Wave 0 |
| MKT-01 | Direction = yesPrice delta blended with mean news sentiment | unit | `bun run test -- tests/unit/correlation-news.test.ts` | ❌ Wave 0 |
| MKT-01 | Markets sorted by volume desc + capped per category | unit | `bun run test -- tests/unit/correlation-news.test.ts` | ❌ Wave 0 |
| MKT-01 | Snapshot written to `marketNewsView` storage key + in `BUDGET_KEYS` | unit | `bun run test -- tests/unit/correlation-news.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `bun run test -- tests/unit/taxonomy.test.ts tests/unit/correlation-news.test.ts`
- **Per wave merge:** `bun run test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/taxonomy.test.ts` — covers MKT-02 (classification + precedence)
- [ ] `tests/unit/correlation-news.test.ts` — covers MKT-01 (notable filter, direction, sort, cap, storage key)
- [ ] `tests/unit/fixtures.ts` — shared `MarketContract`/`NewsItem`/`NewsCorrelationMatch` fixtures (extend existing `tests/unit/fixtures.ts`)

## Security Domain

> `security_enforcement` is `true` in `.planning/config.json` (absent = enabled). ASVS level 1.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (no auth in a client-side extension) |
| V3 Session Management | no | — (no sessions) |
| V4 Access Control | no | — (no user roles) |
| V5 Input Validation | yes | `classifyCategory` operates on `NewsItem.headline` (already sanitized at collection); the snapshot is read-only derived data — no user input enters the view |
| V6 Cryptography | no | — (no secrets; storage is local) |

### Known Threat Patterns for {stack}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Stored XSS via scraped headline | Tampering | Headlines are already sanitized at collection (news.ts strips HTML); the view renders text via React (auto-escaped) — never use `dangerouslySetInnerHTML` |
| Storage quota exhaustion | DoS | `capPerCategory` + `BUDGET_KEYS` accounting keeps the snapshot bounded |

## Sources

### Primary (HIGH confidence)
- `.planning/research/ARCHITECTURE.md` §Pattern 4 (Market-Driven News Aggregation) + §Request Flow — Market-Driven News View — the `buildMarketDrivenNews` design, snapshot, and hook points.
- `.planning/research/PITFALLS.md` §Pitfall 3 (category taxonomy drift) — single-source taxonomy + deterministic precedence + persist at collection time.
- `.planning/research/FEATURES.md` + `.planning/research/SUMMARY.md` — market-driven news view scoped to 3 categories; reuse `redditCategories`.
- Codebase inspection (this session): `src/config/index.ts` (`redditCategories` :52-88, `storage` :155-168), `src/types/index.ts` (`NewsItem` :113-124, `MarketContract` :20-44, `NewsCorrelationMatch` :238-250, `CorrelationResult` :262-290, `Message` :469+, `ExtensionSettings` :488+), `src/background/index.ts` (`runCorrelationAsync` :548-614, `runCorrelationPrecompute` :690-760, `runAlertSweep` :268-286, `mergeNews` :852-864, `getWatchlist` :949, `getSettings` :822), `src/background/alerts.ts` (`deriveDirection`, `yesPriceOf`), `src/utils/storage.ts` (`BUDGET_KEYS` :15-31), `src/dashboard/App.tsx` (Tab :54, nav :276-299), `src/dashboard/hooks/useAlerts.ts`, `src/dashboard/hooks/useSnapshot.ts`, `src/dashboard/components/AlertsTab.tsx`, `src/dashboard/components/VirtualizedGrid.tsx`, `src/dashboard/components/NewsFeed.tsx`, `src/services/collectors/news.ts` (NewsItem build :120-160), `src/utils/keywords.ts` (`extractKeywords` :24).

### Secondary (MEDIUM confidence)
- None — all findings trace to the codebase or the authoritative planning research docs.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps; reuses existing TypeScript/React/VirtualizedGrid/Vitest.
- Architecture: HIGH — mirrors the proven Phase 4 alerts pattern (derived snapshot + hook + component).
- Pitfalls: HIGH — each pitfall tied to a specific codebase location + planning research.

**Research date:** 2026-08-23
**Valid until:** 2026-09-22 (stable stack, no fast-moving deps)
