---
phase: 05-market-driven-news
plan: 03
type: summary
status: complete
wave: 3
requirements:
  - MKT-01
tasks_completed: 2
tasks_total: 2
---

# Plan 05-03 Summary — Market News Dashboard View

## Status: COMPLETE

Both tasks of Plan 05-03 are complete. The dashboard now has a "📰 Market News"
tab that renders the derived `marketNewsView` snapshot grouped by category with
direction badges, reusing `VirtualizedGrid`.

## What was built

### Task 1 — `src/dashboard/hooks/useMarketNews.ts`

`useMarketNews()` returns `{ view, loading }`:
- `view: MarketNewsView | null` (imported from `@/background/correlationNews`).
- On mount, reads `browser.storage.local.get(CONFIG.storage.marketNewsView)` and
  sets `view` if a cached snapshot exists; always clears `loading` in `.finally()`.
- Subscribes to `browser.storage.onChanged` for `CONFIG.storage.marketNewsView`
  (D-11/D-13) — the background writes the snapshot after each correlation.
  Listener removed on unmount.
- No new `Message` variant — storage listener is more robust than a broadcast
  (RESEARCH.md Pattern 5).

### Task 2 — `src/dashboard/components/MarketDrivenNews.tsx` + `App.tsx` wiring

`MarketDrivenNews` (memoized, theme-aware):
- Loading placeholder, empty state ("No market-driven news yet — run a
  correlation first."), and grouped-by-category rendering.
- Iterates `CATEGORY_ORDER` (imported from `@/config/taxonomy` — not hardcoded,
  Pitfall 3) and renders each non-empty category with its `CATEGORY_RULES[cat].label`
  header + a `VirtualizedGrid` of market cards (D-12).
- Each card: direction badge (▲/▼/◆ reusing the `AlertsTab` color contract),
  compact volume, market question, and top 3 correlated news headlines.
- `useMemo` for the empty-state check; theme-aware via `isDark`.

`App.tsx` wiring:
- `'market-news'` added to the `Tab` union (line 56).
- `useMarketNews()` called in `App` (line ~118).
- `['market-news', '📰 Market News']` added to the nav array after alerts (line 287).
- Render block added after the alerts section (line 666).

## Verification

- `bun run typecheck` → **passes**.
- `grep -n "'market-news'" src/dashboard/App.tsx` → present in Tab union, nav
  array, and render section.
- `grep -n "CATEGORY_ORDER" src/dashboard/components/MarketDrivenNews.tsx` →
  taxonomy imported, not hardcoded.
- Full suite: **206/206 tests pass** (no regressions).

## Files changed

| File | Change |
|------|--------|
| `src/dashboard/hooks/useMarketNews.ts` | **created** — snapshot hook |
| `src/dashboard/components/MarketDrivenNews.tsx` | **created** — grouped view component |
| `src/dashboard/App.tsx` | **modified** — Tab union, hook call, nav entry, render block |

## Threat model

- T-05-05 (Tampering): mitigated — React auto-escapes text; no
  `dangerouslySetInnerHTML`.
- T-05-06 (DoS): mitigated — `VirtualizedGrid` reuse keeps large per-category
  lists responsive (PERF-01).
- T-05-SC (package installs): no new packages installed.

## Next

Phase 5 is now fully implemented (Plans 05-01, 05-02, 05-03). Proceed to
**Phase 5 verification + UAT** (human_verify_mode=end-of-phase), then transition
to Phase 6.
