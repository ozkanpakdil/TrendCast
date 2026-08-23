# Phase 5: Market-Driven News - Context

**Gathered:** 2026-08-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a read-only "market-driven news" view that flips the correlation: instead of "here's news → which markets," it starts from **notable markets** (high volume or watchlisted), finds their correlated news, and surfaces the **directional implication** (yes/no price movement + the news that explains it). The view is organized by a consistent category taxonomy (finance / politics / technology) with deterministic precedence (politics > finance > tech). It is a **read-only derived projection** over existing `collectedMarkets` + `collectedNews` + `correlations` — no new collection — and must render without regressing dashboard responsiveness.

**In scope:** Single-source category taxonomy module (`src/config/taxonomy.ts`); category persisted on `NewsItem` at collection time; `buildMarketDrivenNews` aggregation module (`src/background/correlationNews.ts`); a `marketNewsView` derived snapshot written to storage after correlation; a new dashboard "Market News" tab + `useMarketNews` hook + `MarketDrivenNews` component; `VirtualizedGrid` reuse for responsive rendering.

**Out of scope:** Watchlist sort/filter/export (Phase 6), TikTok collector (Phase 7), storage caps / ML quantization (Phase 8). No new collection, no backend, no new runtime dependencies.

</domain>

<decisions>
## Implementation Decisions

### Category Taxonomy & Classification
- **D-01:** Define the taxonomy **once** in a single `src/config/taxonomy.ts` module — stable category ID, label, keyword/entity rules, and precedence order. Referenced by the classifier, the UI, and export. — **Reversibility:** reversible — new module, no contract.
- **D-02:** Assign a news item's category **at collection time** — persist `category` on `NewsItem` when stored, so the view + export read it consistently. — **Reversibility:** reversible — additive field on `NewsItem`.
- **D-03:** v1 is scoped to **3 categories: finance, politics, technology**, reusing the `redditCategories` labels. — **Reversibility:** reversible — taxonomy is extensible.
- **D-04:** Resolve overlaps with **deterministic precedence: politics > finance > tech** — a headline maps to exactly one category (mutual exclusivity). — **Reversibility:** reversible — precedence order is data, not contract.

### Market Selection & Direction
- **D-05:** A market is "notable" if `volume24h ≥ minVolume` **OR** it is watchlisted. — **Reversibility:** reversible — local filter logic.
- **D-06:** Default `minVolume` is a **configurable constant, $10k**. — **Reversibility:** reversible — config value.
- **D-07:** Direction is computed by **blending the Yes-price delta with the mean correlated-news sentiment** — `direction = sign(yesPrice - 0.5)` blended with mean news sentiment. — **Reversibility:** reversible — local computation.
- **D-08:** Markets are **sorted by volume descending** within each category. — **Reversibility:** reversible — sort order.

### View Structure & Rendering
- **D-09:** The view is **grouped by category** (finance / politics / tech sections), each listing its notable markets with correlated news + direction. — **Reversibility:** reversible — UI-only.
- **D-10:** It lives in a **new dedicated dashboard tab** "📰 Market News" (alongside feed/markets/news/correlations/watchlist/alerts/history/community/faq/settings). — **Reversibility:** reversible — UI-only.
- **D-11:** The view reads a **read-only derived snapshot** — `buildMarketDrivenNews` writes a `marketNewsView` snapshot to storage after correlation; the dashboard reads it via a `useMarketNews` hook (mirrors `useAlerts`). — **Reversibility:** reversible — derived cache, no contract.
- **D-12:** Rendering **reuses `VirtualizedGrid`** for the news lists within each category (same pattern as NewsFeed/HypeFeed) so large result sets don't regress responsiveness. — **Reversibility:** reversible — UI-only.

### Data Persistence & Storage
- **D-13:** The derived view is stored in **`chrome.storage.local` key `trendcast:market-news-view`** — a derived snapshot written after correlation, read by the dashboard. — **Reversibility:** reversible — new storage key.
- **D-14:** The snapshot is **bounded** — cap the number of markets per category (top N by volume) so the snapshot stays small and storage stays within budget. — **Reversibility:** reversible — cap constant.
- **D-15:** The snapshot is **rebuilt after each correlation completes** (same hook points as `evaluateAlerts` — after `runCorrelationPrecompute` and `runCorrelationAsync`). — **Reversibility:** reversible — hook wiring.
- **D-16:** Add `trendcast:market-news` to **`BUDGET_KEYS`** in `src/utils/storage.ts` so pruning accounts for it (same as alert keys in Phase 4). — **Reversibility:** reversible — array entry.

### the agent's Discretion
All four grey areas were discussed and accepted. The agent has discretion on implementation details not covered above: exact keyword/entity rules per category, the `minVolume`/cap constant values, the `MarketDrivenNewsItem` shape, and the `useMarketNews` hook internals — following the research (ARCHITECTURE.md Pattern 4, PITFALLS.md Pitfall 3, FEATURES.md, SUMMARY.md).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` §MKT-01, §MKT-02 — The requirements this phase delivers: a "market-driven news" view (important markets → news/direction they imply, finance + politics + tech); a consistent category taxonomy (reuse Reddit categories across markets + news).
- `.planning/ROADMAP.md` §Phase 5 — Goal, success criteria (3 items), depends-on (Phase 3), requirements mapping.

### Research (authoritative on approach)
- `.planning/research/ARCHITECTURE.md` §Pattern 4 (Market-Driven News Aggregation) — The `buildMarketDrivenNews` design: filter notable markets (volume/watchlist), group correlated news by contract, compute direction (yesPrice delta + news sentiment), write a `marketNewsView` snapshot to storage, dashboard reads it. Also §Request Flow — Market-Driven News View.
- `.planning/research/PITFALLS.md` §Pitfall 3 (category taxonomy drift) — Single-source taxonomy module with deterministic precedence (politics > finance > tech), category persisted at collection time, versioned taxonomy, v1 scoped to 3 categories.
- `.planning/research/FEATURES.md` — "Market-driven news" view (flagship differentiator) scoped to 3 categories; category coverage reuses `redditCategories` as a shared category model.
- `.planning/research/SUMMARY.md` — Market-driven news aggregator (`background/correlationNews.ts`) is a read-only derived projection; no new collection; no new runtime deps.

### Existing Code (the machinery to build on)
- `src/config/index.ts` — `CONFIG.scrape.redditCategories` (:44-88) defines finance/crypto/economics/sports/entertainment/technology/politics — the taxonomy to reuse for v1 (finance/politics/technology).
- `src/types/index.ts` — `NewsItem` (:113-124, add `category`), `NewsCorrelationMatch` (:238-250), `MarketContract` (:20-44, `volume24h`, `outcomes` yes-price), `CorrelationResult` (:262-290, `newsMatches`/`newsSocialMatches`).
- `src/background/index.ts` — `runCorrelationPrecompute()` (:690-716) and `runCorrelationAsync()` (:548-614) are the correlation-completion hook points where `buildMarketDrivenNews` should be called (same as `evaluateAlerts` in Phase 4).
- `src/utils/storage.ts` — `BUDGET_KEYS` (:15-25) must gain the new `trendcast:market-news` key.
- `src/dashboard/App.tsx` — Dashboard tabs (:54, :276-299); `useAlerts` hook (`src/dashboard/hooks/useAlerts.ts`) is the template for a `useMarketNews` hook; `AlertsTab` component is the template for `MarketDrivenNews`.
- `src/dashboard/components/VirtualizedGrid.tsx` — the virtualization component to reuse for responsive rendering.
- `src/dashboard/components/NewsFeed.tsx` — the tile-rendering pattern to mirror for correlated news.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `CONFIG.scrape.redditCategories` in `src/config/index.ts:52-88`: the existing category taxonomy (finance/crypto/economics/sports/entertainment/technology/politics) to reuse for v1 (finance/politics/technology).
- `useAlerts` hook (`src/dashboard/hooks/useAlerts.ts`): the template for a `useMarketNews` hook (loads cached snapshot on mount, listens for messages).
- `AlertsTab` component (`src/dashboard/components/AlertsTab.tsx`): the template for `MarketDrivenNews` (read-only list, theme-aware, memoized).
- `VirtualizedGrid` (`src/dashboard/components/VirtualizedGrid.tsx`): the virtualization component to reuse for responsive news lists.
- `NewsFeed` (`src/dashboard/components/NewsFeed.tsx`): the tile-rendering pattern to mirror for correlated news.

### Established Patterns
- **Storage-as-state:** `chrome.storage.local` is the source of truth; the `marketNewsView` snapshot must be persisted there.
- **Derived snapshot after correlation:** the same hook points as `evaluateAlerts` (after `runCorrelationPrecompute`/`runCorrelationAsync`).
- **One-file-per-module convention:** a new `src/background/correlationNews.ts` module for the aggregation follows the codebase shape.
- **Settings merge for forward-compat:** new `NewsItem.category` field is additive and safe for existing stored data (backfill on read if needed).
- **Capped arrays via `slice(-N)`:** the established idiom for bounded history — reuse for the per-category market cap.

### Integration Points
- `src/background/index.ts` — call `buildMarketDrivenNews()` after correlation completes (same hook points as `evaluateAlerts`).
- `src/config/index.ts` — add the `trendcast:market-news` storage key + `minVolume`/cap constants.
- `src/utils/storage.ts` — add `trendcast:market-news` to `BUDGET_KEYS`.
- `src/types/index.ts` — add `category` to `NewsItem`; add `MarketDrivenNewsItem`/`MarketNewsView` types.
- `src/dashboard/App.tsx` — add the new "Market News" tab + `useMarketNews` hook + `MarketDrivenNews` component.

</code_context>

<specifics>
## Specific Ideas

- The user emphasized the **flagship differentiator** nature of this view: it flips the correlation to start from important markets → their news → directional implication.
- The user wants a **consistent category taxonomy** reused across markets + news (reuse `redditCategories`), with **deterministic precedence** (politics > finance > tech) so a headline maps to exactly one category.
- The user wants the view **scoped to 3 categories (finance, politics, tech)** for v1.
- The user wants the view to be a **read-only derived projection** — no new collection — and to render **without regressing dashboard responsiveness** (reuse `VirtualizedGrid`).

</specifics>

<deferred>
## Deferred Ideas

- **Full category taxonomy (sports, entertainment, crypto, economics)** — expanding the market-driven view beyond 3 categories is deferred (research FEATURES.md P3). Noted for a future phase.

</deferred>

---

*Phase: 5-Market-Driven News*
*Context gathered: 2026-08-23*
