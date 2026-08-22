# TrendCast

## What This Is

A 100% client-side Manifest V3 browser extension (Chrome + Firefox) that collects social sentiment (X, Reddit, TikTok), news headlines (BBC, CNN, Yahoo Finance, Google News, Seeking Alpha, Investing.com), and prediction market odds (Polymarket, Kalshi), then correlates them to surface which markets are being driven by real-world discussion. It runs entirely in the user's browser — no backend, no API keys.

## Core Value

Surface the strongest, most reliable signal of what prediction markets are moving and why — by correlating social hype, news, and market odds — fast enough that the user trusts it as a daily decision aid.

## Requirements

### Validated

- ✓ Social sentiment collection (X trends, Reddit) — existing
- ✓ News headline collection (BBC, CNN, Yahoo, Google News, Seeking Alpha, Investing.com) — existing
- ✓ Prediction market odds collection (Polymarket, Kalshi) — existing
- ✓ Client-side correlation engine (heuristic NER + keyword) — existing
- ✓ ML correlation engines (embedding, sentiment, zero-shot, NER, LLM) via Transformers.js in a Web Worker — existing
- ✓ New-tab dashboard with feed, markets, news, correlations, watchlist, history, community, FAQ, settings tabs — existing
- ✓ Toolbar popup with settings — existing
- ✓ Cross-browser build (Chrome + Firefox) — existing
- ✓ Storage-as-state architecture with `chrome.storage.local` — existing
- ✓ Storage budget pruning + conditional fetch (ETag/304) — existing
- ✓ UI responsiveness when rendering large datasets (virtualized HypeFeed + NewsFeed via @tanstack/react-virtual) — Phase 2

### Active

- [ ] Correlation list should have all datas from all news sources, now I do not see seekingalpha and investing.com in the results.
- [ ] Correlation list data should have collapsable titles and when user click on title it should collapse the list.
- [ ] Correlation list should show numbers, how many data is in the list.
- [ ] Fix Seeking Alpha / Investing.com news not appearing in the correlation tab (diagnose root cause: feed reliability, correlation threshold, or display truncation)
- [ ] Improve correlation speed (O(n×m) nested loops → inverted index / candidate filtering)
- [ ] Improve collection speed and storage growth (per-key caps, incremental byte estimation)
- [ ] Add TikTok collector (known gap — no collector exists)
- [ ] Add more data sources (news outlets and/or market platforms)
- [ ] Add correlation alerts/notifications when a strong correlation appears
- [ ] Add dashboard features (export, watchlist, history improvements)
- [ ] Add "market-driven news" view — surface important prediction markets and the news/direction they imply across finance, politics, technology, and other categories

### Out of Scope

- Backend server or API keys — user explicitly wants to stay 100% client-side
- Dropping Chrome or Firefox support — both must be supported
- Monetization / customer-facing business model — internal tool for the user

## Context

TrendCast is a mature, working extension. The codebase map (`.planning/codebase/`) documents a clean background-orchestrator + storage-as-state + React-UI architecture. The user is happy with the direction and wants to **harden features and make them faster**.

**Known issue (immediate concern):** Seeking Alpha and Investing.com news do not appear in the correlation tab. Investigation shows the sources ARE fully wired end-to-end (config, background collector, manifest permissions, settings toggles, UI labels). Likely causes to verify:
1. Google News RSS (`site:seekingalpha.com+when:1d`, `site:investing.com+when:1d`) returns few/no items — Seeking Alpha is paywalled and poorly indexed.
2. Correlation threshold (`MIN_CONFIDENCE = 0.75`, or `0.35` with shared entity) filters out headlines that don't overlap market contract keywords.
3. Display truncation — `CorrelationPanel.tsx` slices to top 15 (list) / top 30 (graph).
4. Storage pruning evicts oldest news when over the 7 MB budget (news is uncapped in `mergeNews`).

**Performance concerns (from codebase map):**
- O(n×m) correlation loops in `correlation.ts` and `ml/ner.ts` — no keyword→contract index.
- Uncapped signal/news accumulation in `mergeSignals`/`mergeNews` (~460 news items/cycle).
- Large ML model downloads (up to 1.5 GB) with slow WASM CPU inference.
- `estimateBytes` re-serializes the entire dataset on every budget check.

**New capability direction:** The user wants to see prediction markets generating important news and direction — i.e., a view where notable market bets surface the news and directional implications across finance, politics, technology, and other categories.

## Constraints

- **Tech stack**: TypeScript 5.5 strict, React 18, Vite 5 + @crxjs/vite-plugin, Tailwind 3, @huggingface/transformers 3.7, Vitest, Playwright — existing stack, do not change.
- **Package manager**: Bun only (never npm/npx) — mandatory.
- **Compatibility**: Manifest V3, Chrome + Firefox both (`TARGET=firefox` build).
- **Privacy**: 100% client-side, no API keys, no backend — hard requirement.
- **Performance**: Must not regress collection or correlation latency; storage must stay within the ~7 MB soft budget.
- **Git**: User handles all commits/pushes/staging — I only make file edits.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Stay 100% client-side | User requirement; privacy + no infra | — Pending |
| Support both Chrome + Firefox | User requirement; current build supports both | — Pending |
| Diagnose & fix Seeking Alpha/Investing root cause (not just force-display) | User chose "diagnose & fix root cause" | — Pending |
| Prioritize performance across correlation, collection, and UI | User chose "all of the above" | — Pending |
| Add new capabilities (TikTok, more sources, alerts, dashboard, market-driven news view) | User chose "new capabilities" | — Pending |
| Virtualize dashboard feeds by row with @tanstack/react-virtual | Shared VirtualizedGrid helper; bounded DOM preserves visuals and interaction | ✓ Phase 2 — PERF-01 shipped |

---
*Last updated: 2026-08-22 after Phase 2*
