# TrendCast

## What This Is

A 100% client-side Manifest V3 browser extension (Chrome + Firefox) that collects social sentiment (X, Reddit, TikTok), news headlines (BBC, CNN, Yahoo Finance, Google News, Seeking Alpha, Investing.com), and prediction market odds (Polymarket, Kalshi), then correlates them to surface which markets are being driven by real-world discussion. It runs entirely in the user's browser — no backend, no API keys.

## Core Value

Surface the strongest, most reliable signal of what prediction markets are moving and why — by correlating social hype, news, and market odds — fast enough that the user trusts it as a daily decision aid.

## Current Milestone: v0.1.7 Dashboard UX Polish — ✅ SHIPPED 2026-08-30

**Goal:** Make the dashboard read as information, not decoration — based on a live screenshot review of every tab: news cards differentiate by source with readable hierarchy, hype cards surface the virality score and engagement, the header shows human-relevant info only, navigation is grouped and consolidated, and density adapts to the user.

**Shipped:**
- News tab de-orange-walled — neutral card surfaces with per-source accents, article publish times, capped keyword chips
- Hype Feed cards informative — prominent heat-colored virality score, engagement on X/TikTok cards
- Header cleanup — version out of the header, relative last-collection time
- Navigation consolidated 11 → 7 tabs (user-directed) — watchlist → Markets, market-news → News segmented view, run history → Correlations, community+FAQ → Help; grouped Data / Insights / More
- Sentiment dots on news cards + compact/comfortable density toggle (persisted)
- Star-click bug fixed (preventDefault inside anchor tiles)
- Popup duplicate FAQ blocks removed
- e2e suite rewritten for the 7-tab layout

**Next milestone goals:** TBD — start with `/gsd-new-milestone`. Deferred candidates: CORR-05 (download progress aggregation), CORR-06 (news↔news correlation pass), MLPROG-03 (full ticker universe), TRIG-05 (embedding cache persistence).

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
- ✓ UI responsiveness when rendering large datasets (virtualized HypeFeed + NewsFeed via @tanstack/react-virtual) — v1.0 (PERF-01)
- ✓ Correlation speedup via inverted keyword→contract index (O(n×m) → candidate filtering) — v1.0 (PERF-02)
- ✓ Storage stays within budget via per-key caps + incremental byte estimation — v1.0 (PERF-03)
- ✓ ML correlation with quantization (q8/q4) + WebGPU, falling back to WASM — v1.0 (PERF-04)
- ✓ Correlation alerts via notifications + alarms, deduped + throttled, watchlist-scoped — v1.0 (ALERT-01)
- ✓ Alerts with direction (bullish/bearish) + top correlated signal/news — v1.0 (ALERT-02)
- ✓ "Market-driven news" view — important markets → news/direction they imply — v1.0 (MKT-01)
- ✓ Consistent category taxonomy (reuse Reddit categories across markets + news) — v1.0 (MKT-02)
- ✓ TikTok social sentiment (best-effort, graceful degradation) — v1.0 (SRC-01)
- ✓ More data sources (news outlets / market platforms) — v1.0 (SRC-02)
- ✓ Sort/filter watchlist + correlation status badge — v1.0 (DASH-01)
- ✓ Export data covering new sources — v1.0 (DASH-02)
- ✓ Seeking Alpha + Investing.com news in correlation tab (root cause diagnosed + fixed) — v1.0 (REL-01)
- ✓ Per-source health/staleness indicators — v1.0 (REL-02)
- ✓ Seeking Alpha + Investing.com news appears in the news tab for existing users (deep-merge `enabledSources` + migration) — v1.1 (NEWS-01)
- ✓ Regression coverage for the settings deep-merge fix — v1.1 (NEWS-02)
- ✓ Cross-source consensus alerts (>=3 distinct source types, social + news mix) — v1.1 (PHASE-10)
- ✓ Collect headlines from the three stock-indicator RSS feeds (usa-stocks-indicator, screener, screener2) — v0.1.5 (SRC-03)
- ✓ Wire new sources end-to-end (config, types, collector, background, dashboard, popup) — v0.1.5 (SRC-04)
- ✓ Settings deep-merge + migration for the new source flags — v0.1.5 (SRC-05)
- ✓ Health/staleness tracking + unit test coverage for the new sources — v0.1.5 (SRC-06)

### Active

(None yet — requirements defined next in this milestone)

### Out of Scope

- Backend server or API keys — user explicitly wants to stay 100% client-side
- Dropping Chrome or Firefox support — both must be supported
- Monetization / customer-facing business model — internal tool for the user

## Context

TrendCast is a mature, working extension. The codebase map (`.planning/codebase/`) documents a clean background-orchestrator + storage-as-state + React-UI architecture. The user is happy with the direction and wants to **harden features and make them faster**.

**v1.0 shipped (2026-08-23):** All 11 milestone requirements satisfied, 298/298 unit tests pass, typecheck clean. Cross-phase integration verified end-to-end (collector → storage → correlation → derived view → dashboard render). Milestone audit passed.

**v1.1 shipped (2026-08-24):** News Source Fix milestone complete. Deep-merge + settings migration fix Seeking Alpha/Investing.com display for existing users (NEWS-01/02/03). Phase 10 added cross-source consensus alerts — topics appearing across >=3 distinct source types (social + news mix) fire alerts even with an empty watchlist. 340/340 unit tests pass, typecheck + lint clean, UAT 2/2 passed, security + Nyquist validation gates passed.

**v0.1.5 shipped (2026-08-27):** Stock Indicator News Sources milestone complete. Three personal stock-indicator RSS feeds (usa-stocks-indicator, breakout screener, VCP screener-2) are first-class news sources: collected via rss2json with guid-based dedup-safe ids, health/staleness tracked, wired end-to-end through popup toggles, NewsFeed labels/colors, and HistoryChart. Settings deep-merge + migration backfills the new flags to `true` for existing users without overwriting explicit preferences. 357 unit tests + 137 e2e tests + typecheck all green.

**v0.1.6 shipped (2026-08-30):** Fix Correlation milestone complete. Ticker/cashtag bridging unifies `$AMZN`/`AMZN`/`Amazon` into one entity space (CORR-01..04); ML runs serialized with requestId-scoped progress and model-download events (MLPROG-01/02); correlation results persist with `computedAt` freshness and re-analyze triggers on collection (TRIG-01..04). 445 unit tests, typecheck/lint/build clean.

**v0.1.7 shipped (2026-08-30):** Dashboard UX Polish milestone complete. NewsFeed source-accented cards, HypeFeed virality/engagement, header cleanup, popup FAQ dedup (UX-01..04); grouped nav + sentiment dots + density toggle (UX-06/07); user-directed tab consolidation 11 → 7 with watchlist-in-Markets, market-news-in-News, run-history-in-Correlations, community+FAQ-in-Help; star-click bug fixed; e2e rewritten for 7 tabs (UX-05/08/09). 445 unit tests + e2e + typecheck/lint/build all green.

**Known issue (resolved in v1.0):** Seeking Alpha and Investing.com news did not appear in the correlation tab. Root cause diagnosed and fixed (REL-01) — sources are fully wired end-to-end; the fix addressed the correlation threshold / display path.

**Performance (resolved in v1.0):**
- O(n×m) correlation loops → inverted keyword→contract index (PERF-02), with equivalence tests proving no result drift.
- Uncapped signal/news accumulation → per-key caps (1000/1000/1000) + `getBytesInUse()`-authoritative budget (PERF-03).
- Large ML model downloads → quantization (q8/q4) + WebGPU acceleration with WASM fallback (PERF-04).

**Deferred / tech debt (non-blocking):**
- Live-browser confirmations for sustained-collection storage budget, ML WASM fallback, and TikTok live fetch (unit-tested in isolation).
- E2E suite hasn't caught up with the two new tabs (Alerts, Market News) — asserts 9 tabs but app has 11.
- Export test lacks an explicit TikTok-in-export assertion.
- `rebuildMarketNewsView` has no alarm fallback (self-heals via dashboard `corrInitRef` on load).

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
| Stay 100% client-side | User requirement; privacy + no infra | ✓ Good |
| Support both Chrome + Firefox | User requirement; current build supports both | ✓ Good |
| Diagnose & fix Seeking Alpha/Investing root cause (not just force-display) | User chose "diagnose & fix root cause" | ✓ Good — REL-01 shipped |
| Prioritize performance across correlation, collection, and UI | User chose "all of the above" | ✓ Good — PERF-01/02/03/04 shipped |
| Add new capabilities (TikTok, more sources, alerts, dashboard, market-driven news view) | User chose "new capabilities" | ✓ Good — SRC-01/02, ALERT-01/02, DASH-01/02, MKT-01/02 shipped |
| Virtualize dashboard feeds by row with @tanstack/react-virtual | Shared VirtualizedGrid helper; bounded DOM preserves visuals and interaction | ✓ Good — PERF-01 shipped |
| Inverted keyword→contract index as the correlation enabler | Collapses O(n×m) loop; unblocks alerts + market-driven view | ✓ Good — PERF-02 shipped |
| Per-key storage caps + `getBytesInUse()` authority | Stops unbounded growth; authoritative budget | ✓ Good — PERF-03 shipped |
| ML quantization + WebGPU→WASM fallback | Faster inference; graceful degradation on Firefox | ✓ Good — PERF-04 shipped |
| Alerts via `chrome.alarms` + persisted state (not timers) | Survive ephemeral MV3 service worker | ✓ Good — ALERT-01 shipped |
| Category taxonomy reusing Reddit categories | Consistency across markets + news | ✓ Good — MKT-02 shipped |
| TikTok as best-effort source with graceful degradation | Never breaks the collection pipeline | ✓ Good — SRC-01 shipped |
| Cross-source consensus alerts reuse the shared alertHistory + alert infra | Surface important topics even with an empty watchlist; no new storage/notification machinery | ✓ Good — PHASE-10 shipped |
| Consensus requires >=3 distinct source types AND >=1 social + >=1 news | Avoids false positives from a single source type dominating | ✓ Good — PHASE-10 shipped |
| Per-topic cooldown keyed by topicId reuses state.lastNotified | Prevents re-alert spam within the window | ✓ Good — PHASE-10 shipped |
| GUID-based ids for screener feeds (`GUID_BASED_SOURCES`) | Screener items share one `link`; guid-derived ids stop `mergeNews` Map-dedup collapsing every item into one | ✓ Good — SRC-03 shipped |
| Storage I/O extracted into testable functions taking a narrow `SettingsStorage` interface | Integration tests without `vi.mock` of the messaging layer; mirrors the alerts store pattern | ✓ Good — SRC-05 shipped |
| Deep-merge + migration only backfill missing keys | Never overwrites an explicit user preference | ✓ Good — SRC-05 shipped |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-08-30 at v0.1.7 Dashboard UX Polish milestone close*
