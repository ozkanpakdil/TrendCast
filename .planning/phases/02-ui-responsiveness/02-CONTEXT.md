# Phase 2: UI Responsiveness - Context

**Gathered:** 2026-08-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Eliminate dashboard lag when rendering large datasets — scroll, tab-switch, and click/filter/hover interactions must stay responsive. This is a brownfield hardening phase on the existing MV3 extension. No new capabilities, no new dependencies beyond one virtualization library.

The primary jank source is that `HypeFeed` and `NewsFeed` render **every** item in a CSS grid with no cap or virtualization. With hundreds of signals/news items, the browser creates and lays out hundreds of DOM nodes at once. `MarketOdds` (squarified treemap) and `CorrelationPanel` (force-directed graph, MAX_NODES=60/MAX_EDGES=80) are already bounded and are NOT in scope for virtualization.

</domain>

<decisions>
## Implementation Decisions

### Rendering Strategy
- **D-01:** Virtualize the list feeds (`HypeFeed`, `NewsFeed`) using **@tanstack/react-virtual**. Only visible items render, so scrolling stays smooth with large datasets. — **Reversibility:** reversible — the library is a drop-in; removing it restores the current grid rendering.
- **D-02:** Keep `MarketOdds` (treemap) and `CorrelationPanel` (graph) **as-is** — they are already bounded (MAX_NODES=60, MAX_EDGES=80) and are not the jank source. Do not virtualize them in this phase. — **Reversibility:** reversible — no code change; can be revisited later.

### Memoization Scope
- **D-03:** Apply **minimal memoization** — add `React.memo` only to the two feed components touched by virtualization (`HypeFeed`, `NewsFeed`). Do NOT memoize `MarketOdds`/`HistoryChart`/`CorrelationPanel` and do NOT split `App.tsx` state into contexts. This keeps the change surface small and low-risk. — **Reversibility:** reversible — `React.memo` wrappers can be removed freely.

### the agent's Discretion
- The user selected only the "Rendering strategy" and "Memoization scope" areas for discussion. The other identified gray areas (tab-switch cost, CorrelationPanel graph optimization) were NOT discussed. The agent has discretion to make reasonable, reversible choices here, grounded in the codebase maps and the phase goal/success criteria in `ROADMAP.md`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Requirements
- `.planning/REQUIREMENTS.md` — PERF-01 (UI responsiveness). Phase 2 scope.
- `.planning/ROADMAP.md` — Phase 2 goal: "User can interact with the dashboard without lag when rendering large datasets". Success criteria: (1) scroll without jank, (2) switch tabs without delay, (3) click/filter/hover without UI freezing.

### Codebase Maps
- `.planning/codebase/ARCHITECTURE.md` — Background-orchestrator + storage-as-state + React-UI architecture; component responsibilities.
- `.planning/codebase/STACK.md` — Existing stack (TypeScript 5.5, React 18, Vite 5 + @crxjs, Tailwind 3, Transformers.js 3.7, Vitest, Playwright). Do not change.
- `.planning/codebase/CONVENTIONS.md` — Code conventions (PascalCase components, `useMemo`/`memo` patterns, `@/` aliases).
- `.planning/codebase/CONCERNS.md` — Documents performance bottlenecks: O(n×m) correlation loops, large component files (CorrelationPanel.tsx 1032 lines, App.tsx 748 lines), duplicate FAQ rendering in popup.

### Project Constraints
- `.planning/PROJECT.md` — Core value, constraints (100% client-side, Bun only, MV3 Chrome+Firefox, ~7MB storage budget, no backend/API keys).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/dashboard/components/HypeFeed.tsx` — Grid of social signals, renders ALL signals (no cap). Sorted by virality via `useMemo`. Target for virtualization.
- `src/dashboard/components/NewsFeed.tsx` — Grid of news headlines, renders ALL items. Sorted by publish time via `useMemo`. Target for virtualization.
- `src/dashboard/components/MarketOdds.tsx` — Squarified treemap (`squarify` from `../utils/treemap`). Bounded; NOT in scope.
- `src/dashboard/components/CorrelationPanel.tsx` — Force-directed graph (MAX_NODES=60, MAX_EDGES=80). Bounded; NOT in scope.
- `src/dashboard/App.tsx` — 748 lines; mounts tabs lazily via `{activeTab === 'x' && ...}`. Heavy state; NOT splitting state in this phase.

### Established Patterns
- **`useMemo`/`memo`:** Components already use `useMemo` for sorting and `memo` for export (e.g. `NewsFeedImpl` wrapped in `memo`). Follow this pattern.
- **Grid layouts:** Both feeds use Tailwind responsive grid classes (`grid grid-cols-2 sm:grid-cols-3 ...`). Virtualization must preserve the responsive grid appearance.
- **Cross-browser:** `webextension-polyfill` via `@/messaging/browser` (Firefox needs it). Virtualization is pure client-side DOM — no browser API concerns.
- **Bun only:** Add `@tanstack/react-virtual` via `bun add` (never npm/npx).

### Integration Points
- `HypeFeed` / `NewsFeed` — replace the full `.map()` grid with a virtualized window over the sorted array.
- `App.tsx` — passes `signals`/`news` arrays into the feeds; props unchanged, so no App.tsx changes required for virtualization.
- `package.json` — add `@tanstack/react-virtual` dependency.

</code_context>

<specifics>
## Specific Ideas

- **Virtualization preserves sort order:** Both feeds sort via `useMemo` before rendering. The virtualizer should window over the already-sorted array so the visible subset is always the top-N by virality/time.
- **Grid virtualization:** `@tanstack/react-virtual` supports row-based virtualization. For a responsive grid, virtualize by row (compute items-per-row from container width) or use a fixed column count. The plan should decide the exact approach.
- **Empty states preserved:** Both feeds have empty-state messages ("No social signals collected yet...", "No news..."). Virtualization must not break these — render the empty state when the array is empty, before the virtualizer.
- **Memoization:** Wrap the virtualized feed components in `React.memo` (they already are via `memo` export) so App.tsx state changes (e.g. `collecting`) don't re-render them when props are stable.
</specifics>
