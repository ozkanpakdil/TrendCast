# Plan 05-01 Summary — Taxonomy + Category Persistence

**Phase:** 5 (Market-Driven News) · **Plan:** 01 · **Wave:** 1
**Status:** ✅ Complete

## Objective
Establish the single-source category taxonomy and persist a category on every `NewsItem` at collection time, so the market-driven news view and future export read a consistent, drift-free category.

## Files Changed
- **Created:** `src/config/taxonomy.ts`, `tests/unit/taxonomy.test.ts`
- **Modified:** `src/types/index.ts`, `src/services/collectors/news.ts`, `src/config/index.ts`, `src/utils/storage.ts`

## Deliverables
- `src/config/taxonomy.ts` — single source of truth: `NewsCategory` type, `CategoryRule`, `CATEGORY_ORDER` (politics > finance > technology), `CATEGORY_RULES`, `TAXONOMY_VERSION`, `classifyCategory()`.
- `category?: NewsCategory` added to `NewsItem` (optional, backfilled on read).
- `collectNews` assigns `category: classifyCategory(headline)` at collection time.
- `CONFIG.storage.marketNewsView = 'trendcast:market-news-view'` (D-13 canonical key).
- `CONFIG.marketNews = { minVolume: 10_000, capPerCategory: 20 }` (D-06/D-14).
- `BUDGET_KEYS` includes `CONFIG.storage.marketNewsView` (D-16).

## Verification
- ✅ `bun run test -- tests/unit/taxonomy.test.ts` — **9/9 tests pass** (precedence, mutual exclusivity, finance fallback, case-insensitivity, constants).
- ✅ `bun run typecheck` — passes with the new `category` field + config keys.
- ✅ Canonical key `'trendcast:market-news-view'` defined once in `src/config/index.ts`; `BUDGET_KEYS` references `CONFIG.storage.marketNewsView` (D-13/D-16 consistent).

## Deviations
- **None.** Note: the plan's verification grep expected the literal `'trendcast:market-news-view'` in `storage.ts`, but the plan's own Task 2 action correctly specifies adding `CONFIG.storage.marketNewsView` (the reference) to `BUDGET_KEYS`. The literal lives in `src/config/index.ts`. This is the intended single-source approach and satisfies D-13/D-16.

## Decisions
- `category` is optional on `NewsItem` (no migration; old records backfilled on read in 05-02).
- No `sentiment` field persisted — computed on demand via `sentimentScore()` in 05-02.

## Next Phase Readiness
- Ready for Plan 05-02 (aggregation module + background wiring).
