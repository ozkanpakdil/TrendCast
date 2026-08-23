# TrendCast

## What This Is

A 100% client-side Manifest V3 browser extension (Chrome + Firefox) that collects social sentiment (X, Reddit, TikTok), news headlines (BBC, CNN, Yahoo Finance, Google News, Seeking Alpha, Investing.com), and prediction market odds (Polymarket, Kalshi), then correlates them to surface which markets are being driven by real-world discussion. It runs entirely in the user's browser — no backend, no API keys.

## Core Value

Surface the strongest, most reliable signal of what prediction markets are moving and why — by correlating social hype, news, and market odds — fast enough that the user trusts it as a daily decision aid.

## Current Milestone: v1.1 News Source Fix

**Goal:** Fix the news tab so Seeking Alpha and Investing.com headlines actually appear for existing users.

**Target features:**
- Deep-merge `enabledSources` so newer source flags default to `true` for existing users
- Verify Seeking Alpha + Investing.com news appears in the news tab
- Add a settings migration to backfill missing source flags
- Regression coverage (unit tests for the merge fix)

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

### Active

- ✓ Seeking Alpha + Investing.com news appears in the news tab for existing users (deep-merge `enabledSources` + migration) — v1.1 (NEWS-01)
- ✓ Regression coverage for the settings deep-merge fix — v1.1 (NEWS-02)

### Out of Scope

- Backend server or API keys — user explicitly wants to stay 100% client-side
- Dropping Chrome or Firefox support — both must be supported
- Monetization / customer-facing business model — internal tool for the user

## Context

TrendCast is a mature, working extension. The codebase map (`.planning/codebase/`) documents a clean background-orchestrator + storage-as-state + React-UI architecture. The user is happy with the direction and wants to **harden features and make them faster**.

**v1.0 shipped (2026-08-23):** All 11 milestone requirements satisfied, 298/298 unit tests pass, typecheck clean. Cross-phase integration verified end-to-end (collector → storage → correlation → derived view → dashboard render). Milestone audit passed.

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
*Last updated: 2026-08-23 — Milestone v1.1 started (News Source Fix)*
