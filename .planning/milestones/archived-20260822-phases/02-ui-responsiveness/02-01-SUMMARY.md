---
phase: 02-ui-responsiveness
plan: 01
subsystem: dashboard-ui
tags: [virtualization, performance, react-virtual, feeds, dashboard]

requires:
  - phase: 01-data-reliability
    provides: stable snapshot shape, source health telemetry, verified feed data flow
provides:
  - Shared row-virtualized grid helper (VirtualizedGrid) bounding DOM to visible rows
  - HypeFeed and NewsFeed rewired through the virtualizer (bounded node count)
  - Unit tests for chunk + getColumnCount; e2e tests for bounded DOM, scroll reveal, News-tab interactivity
affects: [verify-work]

actuals:
  tokens: 0
  tasks: 2
  commits: 0

tech-stack:
  added:
    - "@tanstack/react-virtual@^3.14.10"
  patterns:
    - "row-based virtualization: chunk items into rows, virtualize by row, measureElement + data-index for variable heights"
    - "pure projection helpers (getColumnCount, chunk) kept outside the component for unit-testability"
    - "bounded-DOM e2e proxy: count cards via `main .card-hover`, assert count < seeded dataset"

key-files:
  created:
    - src/dashboard/components/VirtualizedGrid.tsx
    - tests/unit/virtual-grid.test.ts
  modified:
    - package.json
    - bun.lock
    - src/dashboard/components/HypeFeed.tsx
    - src/dashboard/components/NewsFeed.tsx
    - tests/e2e/dashboard.spec.ts

key-decisions:
  - "Shared VirtualizedGrid helper (not per-feed duplication) so both feeds get identical virtualization + grid classes."
  - "Virtualize by row (chunk items into rows) rather than by item — matches the existing grid-cols layout and keeps partial rows rendering normally."
  - "measureElement + data-index corrects variable-height cards (120px estimate) so line-clamp truncation is preserved."
  - "Empty state handled by parent early-return before the virtualizer — VirtualizedGrid never renders an empty spacer."
  - "e2e card selector moved from `main .grid > *` to `main .card-hover` because virtual row divs are also `.grid` after virtualization."

patterns-established:
  - "VirtualizedGrid: memo-wrapped, props { items: React.ReactNode[] }, ResizeObserver-driven column count, useVirtualizer with overscan 3"
  - "getColumnCount(width) pure breakpoint mapping matching Tailwind grid-cols-* classes"
  - "chunk<T>(arr, size) pure row-slicing helper"
  - "Bounded-DOM e2e pattern: seed ~200 items, assert rendered card count < 100"

requirements-completed: [PERF-01]

coverage:
  - id: P1
    description: "HypeFeed and NewsFeed render only visible rows; DOM node count is bounded with a large dataset"
    requirement: PERF-01
    verification:
      - kind: e2e
        ref: "tests/e2e/dashboard.spec.ts#bounds DOM to visible rows with a large dataset"
        status: pass
      - kind: e2e
        ref: "tests/e2e/dashboard.spec.ts#bounds DOM to visible rows with a large news dataset"
        status: pass
    human_judgment: false
  - id: P2
    description: "Scrolling the feed reveals later items while the DOM stays bounded"
    requirement: PERF-01
    verification:
      - kind: e2e
        ref: "tests/e2e/dashboard.spec.ts#reveals more cards when scrolling the feed"
        status: pass
    human_judgment: false
  - id: P3
    description: "News-tab switch with a large dataset renders without error and the feed is interactive (first card link clickable)"
    requirement: PERF-01
    verification:
      - kind: e2e
        ref: "tests/e2e/dashboard.spec.ts#news tab switch with a large dataset renders and stays interactive"
        status: pass
    human_judgment: false
  - id: P4
    description: "chunk + getColumnCount pure helpers unit-tested (boundary widths, remainder rows)"
    requirement: PERF-01
    verification:
      - kind: unit
        ref: "tests/unit/virtual-grid.test.ts"
        status: pass
    human_judgment: false

duration: 30min
completed: 2026-08-22
status: complete
---

# Phase 02: UI Responsiveness — Virtualized HypeFeed + NewsFeed

Virtualized both dashboard list feeds (`HypeFeed`, `NewsFeed`) by row using `@tanstack/react-virtual`, so only visible rows are in the DOM. This removes the jank source (hundreds of DOM nodes rendered at once) while preserving the exact grid appearance, empty-state copy, and interaction behavior (PERF-01).

## Performance

- **Duration:** 30 min
- **Tasks:** 2 completed
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments
- Created a shared `VirtualizedGrid` helper that chunks items into rows, reads container width via `ResizeObserver`, maps it through `getColumnCount`, and virtualizes by row with `overscan: 3` and `measureElement` for variable-height cards.
- Rewired `HypeFeed` and `NewsFeed` through `VirtualizedGrid`, preserving card markup, empty-state early returns, and `memo` wrappers.
- Added pure `chunk` + `getColumnCount` helpers with unit tests (boundary widths, remainder rows).
- Updated feed e2e assertions from `main .grid > *` to the dedicated `main .card-hover` card selector (virtualizer row divs are also `.grid`).
- Added e2e coverage: bounded DOM for both feeds (~200 items → <100 cards), scroll-reveal (later signal becomes visible, DOM stays bounded), and News-tab switch interactivity with a large dataset.

## Task Commits

Commits are handled by the user per repository git rules (no auto-commit).

**Plan metadata:** `02-01-PLAN.md`

## Files Created/Modified
- `src/dashboard/components/VirtualizedGrid.tsx` - Shared row-virtualized grid helper (`getColumnCount`, `chunk`, `VirtualizedGrid`).
- `src/dashboard/components/HypeFeed.tsx` - Rewired through `VirtualizedGrid`; card markup + empty state preserved.
- `src/dashboard/components/NewsFeed.tsx` - Rewired through `VirtualizedGrid`; card markup + empty state preserved.
- `tests/unit/virtual-grid.test.ts` - Unit tests for `chunk` + `getColumnCount`.
- `tests/e2e/dashboard.spec.ts` - Updated card selector; added bounded-DOM, scroll-reveal, and News-tab interactivity tests.
- `package.json` / `bun.lock` - Added `@tanstack/react-virtual@^3.14.10`.

## Decisions Made
- Shared `VirtualizedGrid` helper rather than per-feed virtualization, so both feeds share identical grid classes and behavior.
- Virtualize by row (chunk items into rows) to match the existing `grid-cols-*` layout and keep partial rows rendering normally.
- `measureElement` + `data-index` corrects variable-height cards; `estimateSize: 120` is only a starting estimate.
- Empty state handled by parent early-return before the virtualizer.
- e2e card assertions use `main .card-hover` (the card element), not `main .grid > *` (which matches virtual row divs after virtualization).

## Deviations from Plan

- The scroll-reveal e2e test was revised: the original assertion (`after > before` card count) was invalid under virtualization because the DOM count stays bounded (~40 cards) regardless of scroll position. It now asserts that a later signal (signal-199) is absent before scrolling and present after scrolling, while the DOM count stays < 200 — proving the virtualizer window moves through the list without unbounded growth.
