---
phase: 05-market-driven-news
plan: 02
type: summary
status: complete
wave: 2
requirements:
  - MKT-01
tasks_completed: 2
tasks_total: 2
---

# Plan 05-02 Summary — Market-Driven News Aggregation

## Status: COMPLETE

Both tasks of Plan 05-02 are complete. The pure aggregation module
`buildMarketDrivenNews` is built, unit-tested (9/9 passing), and wired into
both background correlation hook points.

## What was built

### Task 1 — `src/background/correlationNews.ts` (pure aggregation module)

Exports:
- `MarketDrivenNewsItem` — `{ contract, category, direction, news, signalCount, volume24h }`
- `MarketNewsView` — `{ builtAt, categories: Record<NewsCategory, MarketDrivenNewsItem[]> }`
- `buildMarketDrivenNews(newsMatches, watchlist, minVolume, capPerCategory)`

Algorithm (per D-05..D-09, D-14):
1. Notable filter: `volume24h >= minVolume` OR watchlisted (D-05).
2. Group by `contract.id`; omit contracts with no correlated news (Open Question 1).
3. Direction (D-07): blend `sign(yesPrice - 0.5)` with `sign(meanNewsSentiment)` → up/down/mixed.
4. Category (D-09): majority category of correlated news, backfilled via `classifyCategory(headline)` (Pitfall 2), falling back to `classifyCategory(contract.question)`.
5. Sort by `volume24h` desc (D-08), slice to `capPerCategory` (D-14).

No storage writes in the pure function (Task 2 owns persistence). No hardcoded
keyword lists — imports `classifyCategory`/`CATEGORY_ORDER`/`NewsCategory` from
`@/config/taxonomy` (Pitfall 3 anti-pattern avoided).

### Task 2 — `src/background/index.ts` wiring

- Added `rebuildMarketNewsView()` helper (line 294): reads stored correlations,
  returns early if none, calls `buildMarketDrivenNews(...)` with
  `CONFIG.marketNews.minVolume` / `CONFIG.marketNews.capPerCategory`, writes to
  `CONFIG.storage.marketNewsView` (D-13). Defensive try/catch mirrors
  `runAlertSweep`.
- Called `await rebuildMarketNewsView()` immediately after `await runAlertSweep()`
  in **both** hook points (D-15): `runCorrelationAsync()` (line 659) and
  `runCorrelationPrecompute()` (line 801).

## Verification

- `bun run test -- tests/unit/correlation-news.test.ts` → **9/9 passed**
  (notable filter, direction, category grouping, sort+cap, watchlist inclusion,
  backfill, empty case).
- `bun run typecheck` → **passes** (fixed one unused `news` read).
- `grep -n 'rebuildMarketNewsView' src/background/index.ts` → helper defined +
  called in both hook points.

## Files changed

| File | Change |
|------|--------|
| `src/background/correlationNews.ts` | **created** — pure aggregation module |
| `src/background/index.ts` | **modified** — import + `rebuildMarketNewsView` helper + 2 hook-point calls |
| `tests/unit/correlation-news.test.ts` | **created** — 9 tests |
| `tests/unit/fixtures.ts` | **modified** — added `newsMatch()` helper + `NewsCorrelationMatch` type import |

## Threat model

- T-05-03 (DoS): mitigated — `capPerCategory` bounds the snapshot.
- T-05-04 (Tampering): mitigated — only derived `MarketNewsView` written to the
  dedicated `marketNewsView` key.
- T-05-SC (package installs): no new packages installed.

## Next

Proceed to **Plan 05-03 (Wave 3)** — dashboard `useMarketNews` hook,
`MarketDrivenNews` component, and `'market-news'` tab wiring.
