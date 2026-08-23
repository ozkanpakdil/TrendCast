# Phase 7: TikTok Collector - Research

**Researched:** 2026-08-23
**Status:** Ready for planning

## Overview

Phase 7 delivers TikTok social sentiment as a best-effort, content-script-driven source that degrades gracefully without breaking the collection pipeline. The research confirms this is MEDIUM-complexity work on the established content-script + messaging + storage stack — no new runtime dependencies, no backend, no public API.

## Key Findings

### 1. The Core Gap: `src/content/socials/index.ts` is EMPTY

**Critical discovery:** The manifest (`src/manifest.config.ts`) already declares a content script for social platforms:

```ts
{
  // Social platforms — scrape trending posts + inject odds overlays
  matches: [
    '*://x.com/*', '*://twitter.com/*',
    '*://reddit.com/*', '*://tiktok.com/*',
  ],
  js: ['src/content/socials/index.ts'],
  css: ['src/content/socials/overlay.css'],
  run_at: 'document_idle',
},
```

But `src/content/socials/index.ts` is **empty** (0 bytes). The `overlay.css` exists. This means the content script is injected on X/Reddit/TikTok but does nothing. **Phase 7's primary work is implementing this file** to scrape TikTok (and optionally X/Reddit) DOM and report via `REPORT_SOCIAL_DATA`.

### 2. Infrastructure Already In Place (no new plumbing needed)

- **`SocialPlatform` type** (`src/types/index.ts:56`): `'x' | 'reddit' | 'tiktok'` — TikTok already a valid platform.
- **`SocialSignal` interface** (`src/types/index.ts:59`): has `platform`, `text`, `author`, `metrics {likes, shares, comments, views?}`, `timestamp`, `keywords`, `sentiment`, `virality`, `url?`.
- **`REPORT_SOCIAL_DATA` message** (`src/types/index.ts:454`): `{ type: 'REPORT_SOCIAL_DATA'; payload: { signals: SocialSignal[] } }`.
- **Background handler** (`src/background/index.ts:326`): merges incoming signals via `mergeSignals` and stores to `collectedSignals`.
- **`CONFIG.scrape.tiktok.url`** (`src/config/index.ts:93`): `'https://www.tiktok.com/discover'`.
- **Popup toggle** (`src/popup/components/Settings.tsx:202`): `['tiktok', '🎵 TikTok']` already in the source list; `DEFAULT_SETTINGS.enabledSources.tiktok = true` (on by default, like Reddit/X).
- **Dashboard rendering**: `HypeFeed` (`platformIcons.tiktok = '🎵'`), `CorrelationPanel` (already has TikTok URL reconstruction), `HistoryChart` (`PLATFORM_LABELS.tiktok = 'TikTok'`) all already handle TikTok signals.
- **Export**: `src/utils/export.ts` exports social signals generically by `platform` — TikTok flows through automatically.

### 3. TikTok Is Content-Script-Driven (no public fetch API)

The background comment (`src/background/index.ts:558`) confirms the design:

```ts
// TikTok requires content script scraping (no public fetch endpoint).
// It will report data via REPORT_SOCIAL_DATA when the user visits the site.
```

TikTok has **no free public API** for trends/discover content. The only viable approach is DOM scraping when the user visits `tiktok.com/discover` (or any TikTok page). This is the "Anti-Pattern 5" avoidance — we do NOT attempt a background `fetch()` to TikTok (would be CORS-blocked and fragile).

**Implication:** TikTok collection is **passive** — it only collects when the user actively visits TikTok. This is inherently best-effort and matches SRC-01's "graceful degradation" requirement.

### 4. Source Health for Graceful Degradation (SRC-01)

**Current state:** `SourceHealth` (`src/types/index.ts`) is keyed by `NewsSource` only:

```ts
export type SourceHealth = Partial<Record<NewsSource, SourceHealthEntry>>;
```

`SourceHealthIndicator` (`src/dashboard/components/SourceHealthIndicator.tsx`) renders only the 6 news sources. **TikTok has no health tracking.**

**Decision needed:** To satisfy SRC-01's "graceful degradation state (source health indicator)", we need a way to show TikTok's health. Options:
- **(A)** Extend `SourceHealth` to include social platforms (add `tiktok` to the key union). This touches the type + `SourceHealthIndicator` + `computeHealth` callers.
- **(B)** Track TikTok health separately (a new `SocialSourceHealth` map) and render a separate indicator.
- **(C)** Minimal: rely on the existing "no data" state — if TikTok never reports, the HypeFeed shows the empty state. But this doesn't satisfy the explicit "source health indicator" success criterion.

**Recommendation:** Option A is cleanest — extend the health key union to include `'tiktok'` (and optionally `'x'`, `'reddit'`), and have the content script report health alongside signals. But this is a larger change. Given the phase scope, a **minimal viable approach** is: the content script reports signals; the background records a `lastFetchedAt`/`itemCount` for TikTok in a small social-health map; the dashboard shows a single "TikTok" health badge. This needs a design decision in discuss.

### 5. Hard Timeout + Isolation (Success Criterion 2)

**Requirement:** "TikTok collection is isolated with a hard timeout and never degrades other sources."

Since TikTok is content-script-driven (not a background fetch), the "hard timeout" applies to the **content script's scrape+report** operation. The content script should:
- Debounce scans (like `src/content/news/index.ts` uses `debounceTimer`).
- Cap the number of signals scraped per scan (e.g., 30, matching the news collector).
- Use `Promise.race` with a timeout for the `sendMessage` report, so a hung background doesn't block the page.
- Never throw uncaught — wrap in try/catch so a TikTok DOM change doesn't break the page.

The background's `REPORT_SOCIAL_DATA` handler already uses `mergeSignals` (isolated from other sources) and `Promise.allSettled` in `runCollection` — so a TikTok failure can't break BBC/CNN/Polymarket/Kalshi.

### 6. Automatic Background-Tab Collection (Success Criterion 3)

**Requirement:** "with a manual URL-paste fallback."

**CORRECTED FLOW (2026-08-23):** TikTok must collect trending topics **automatically**, exactly like Reddit and X — there is **NO URL-paste input box** in the dashboard. The user explicitly rejected the URL-paste flow as over-engineered ("such a stupid flow"). TikTok brings trending topics on its own.

The automatic approach reuses the existing-but-unused background-tab collection config (`maxConcurrentTabs`/`tabLoadTimeout`):
- The background opens a **background tab** to `CONFIG.scrape.tiktok.url` (`https://www.tiktok.com/discover`) as part of the normal collection cycle (`runCollection`), gated by the `enabled.tiktok` toggle.
- The content script scrapes the discover page and reports via `REPORT_SOCIAL_DATA`/`REPORT_SOCIAL_HEALTH`.
- The background waits for the report (racing against `tabLoadTimeout`), then closes the tab in `finally`, respecting `maxConcurrentTabs`, and never throws uncaught.
- This is wired into `runCollection()` alongside the other sources, so TikTok is collected automatically on the same cycle as Reddit/X.

**Note:** The background previously had NO tab-opening collection logic (the `maxConcurrentTabs`/`tabLoadTimeout` config existed but was unused). This phase introduces the first use of background-tab-driven collection — but for **automatic** discovery-page collection, not a manual URL-paste fallback.

### 7. Existing Collector Patterns to Reuse

- **`src/services/collectors/x-trends.ts`**: Maps Google Trends RSS → `SocialSignal` with `platform: 'x'`. Shows the `normaliseTrend` pattern (sentiment via `analyzeSentiment`, virality from rank, keywords via `extractKeywords`).
- **`src/content/news/index.ts`**: Content-script pattern — `detectSource()`, `scrapeNews()` with broad selectors + dedup via `seenUrls` Set, `scanAndReport()` with debounce + hash to avoid re-reporting.
- **`src/content/prediction-markets/index.ts`**: SPA pattern — `MutationObserver` + URL polling for route changes.

**TikTok DOM scraping reality:** TikTok's discover page is a heavily-obfuscated SPA. Reliable selectors are hard to guarantee. The scraper should use **broad, defensive selectors** (like the news collector) and gracefully return `[]` when nothing matches. This is inherently best-effort.

### 8. Testing Strategy

- **Unit tests** for the TikTok normalizer: given raw scraped DOM data (or a mock), verify it produces valid `SocialSignal[]` with correct `platform: 'tiktok'`, sentiment, virality, keywords, dedup.
- **Unit tests** for the content-script scrape function: mock `document.querySelectorAll` (jsdom) to return TikTok-like elements, verify signals extracted.
- **Unit tests** for the timeout/isolation: verify a hung report doesn't throw.
- **Unit tests** for the automatic background-tab collector: verify the background opens the discover tab, waits for the report, closes the tab in `finally`, respects `maxConcurrentTabs`, and times out gracefully.
- **No E2E** (TikTok requires login + real DOM).

## Decisions Needed (for discuss)

- **D-01**: Scope of `src/content/socials/index.ts` — implement TikTok only, or also X/Reddit DOM scraping (which are also currently unimplemented)?
- **D-02**: Source-health for TikTok — extend `SourceHealth` union vs. separate social-health map vs. minimal "no data" state?
- **D-03**: Automatic background-tab collection — open the discover page in a background tab during `runCollection` (like Reddit/X), no URL-paste input box.
- **D-04**: Hard timeout mechanism — `Promise.race` in content script vs. background-side timeout?
- **D-05**: TikTok default toggle — on by default (like Reddit/X), since collection is automatic.

## Complexity Assessment

**MEDIUM.** The core work (implementing the empty content script) is well-scoped. The main risks are: (1) TikTok DOM fragility (mitigated by broad selectors + graceful `[]`), (2) source-health extension touches the type + dashboard, (3) automatic background-tab collection requires new background tab-opening logic. No new dependencies.
