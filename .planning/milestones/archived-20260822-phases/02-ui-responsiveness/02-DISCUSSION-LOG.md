# Phase 2: UI Responsiveness - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-22
**Phase:** 2-UI Responsiveness
**Areas discussed:** Rendering strategy, Memoization scope

---

## Rendering Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Virtualize feeds | Add a virtualization library (react-window or @tanstack/react-virtual) so only visible items render. Best for very large lists, but adds a dependency and needs row measurement. | |
| Cap + Show more | Cap each feed to a fixed count (e.g. top 50 signals, top 30 news) with a 'Show more' button. Zero new deps, simplest, but hides data behind a click. | |
| Hybrid (virtualize lists only) | Virtualize the list feeds (HypeFeed/NewsFeed) but keep the treemap and graph as-is since they're already bounded. Balanced approach. | ✓ |

**User's choice:** Hybrid (virtualize lists only)
**Notes:** MarketOdds (treemap) and CorrelationPanel (graph) are already bounded (MAX_NODES=60, MAX_EDGES=80) and are not the jank source.

### Follow-up: Which virtualization library

| Option | Description | Selected |
|--------|-------------|----------|
| @tanstack/react-virtual | Headless, no UI, works with any layout including CSS grid. Small, actively maintained, no fixed-height assumptions. Best fit for the grid layouts. | ✓ |
| react-window | Battle-tested, but designed for fixed-size rows/lists, not grids. Would need a grid wrapper. | |
| Custom hook | Write a small custom virtualization hook (IntersectionObserver + windowing) — zero deps but more code to maintain and test. | |

**User's choice:** @tanstack/react-virtual

---

## Memoization Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Memoize heavy leaves only | Memoize the heavy leaf components (HypeFeed, NewsFeed, MarketOdds, HistoryChart, CorrelationPanel) with React.memo + stable props via useCallback/useMemo in App.tsx. Targeted, low-risk. | |
| Leaves + state splitting | Memoize leaves AND audit App.tsx state to split it into smaller contexts so unrelated state changes don't re-render everything. More invasive, higher payoff. | |
| Minimal (virtualized only) | Only add React.memo to the feed components touched by virtualization. Minimal change, but leaves the graph/treemap re-rendering on every App state change. | ✓ |

**User's choice:** Minimal (virtualized only)
**Notes:** Keeps the change surface small and low-risk. The graph/treemap re-rendering on App state changes is accepted as out of scope for this phase.

---

## Final Scope Confirmation

| Option | Description | Selected |
|--------|-------------|----------|
| Confirm minimal scope | Virtualize HypeFeed + NewsFeed with @tanstack/react-virtual, add React.memo to those two components, keep everything else untouched. Smallest possible change for PERF-01. | ✓ |
| Add leaf memo too | Also add React.memo to MarketOdds/HistoryChart/CorrelationPanel even though they're not virtualized. | |

**User's choice:** Confirm minimal scope

---

## the agent's Discretion

The user selected only the "Rendering strategy" and "Memoization scope" areas for discussion. The other identified gray areas (tab-switch cost, CorrelationPanel graph optimization) were NOT discussed. The agent has discretion to make reasonable, reversible choices here, grounded in the codebase maps and the phase goal/success criteria in `ROADMAP.md`.

## Deferred Ideas

- **Tab-switch cost** — surfaced during gray-area identification (each tab fully re-renders on switch). Not discussed/selected; belongs in a future phase if the user wants it.
- **CorrelationPanel graph optimization** — surfaced during gray-area identification (heaviest component). Not discussed/selected; the graph is already bounded and not the primary jank source.
- **App.tsx state splitting** — explicitly deferred by the "Minimal (virtualized only)" memoization choice.
