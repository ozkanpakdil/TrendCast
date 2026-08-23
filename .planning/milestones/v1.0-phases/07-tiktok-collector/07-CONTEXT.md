# Phase 7: TikTok Collector - Context

**Gathered:** 2026-08-23
**Status:** Ready for planning
**Mode:** Autonomous (recommended defaults accepted)

## Phase Boundary

Users can see TikTok social sentiment as a best-effort source that degrades gracefully without breaking the collection pipeline. TikTok is content-script-driven (no public API), isolated with a hard timeout, and shows a graceful-degradation health state. TikTok trending topics are collected **automatically** (like Reddit/X) via a background tab to the discover page — there is **no URL-paste input box** in the dashboard. Additional data sources beyond TikTok are wired end-to-end (SRC-02).

## Decisions

### D-01: Content script scope — TikTok only

Implement TikTok scraping in the empty `src/content/socials/index.ts`. X and Reddit already have background collectors (`collectRedditSignals`, `collectXTrends`) — their DOM scraping is out of scope. The content script detects `tiktok.com` via hostname and scrapes the discover page; on X/Reddit it no-ops.

**Rationale:** Smallest change that satisfies SRC-01. X/Reddit DOM scraping would duplicate existing background collectors.

### D-02: TikTok health — separate social-health map

Add a small `SocialSourceHealth` map (`Partial<Record<SocialPlatform, SourceHealthEntry>>`) stored alongside the existing news `SourceHealth`. The content script reports `lastFetchedAt`/`itemCount`/`consecutiveFailures` for TikTok; the dashboard renders a single TikTok health badge (reusing `computeHealth`). This avoids touching the `NewsSource`-keyed `SourceHealth` union.

**Rationale:** Minimal, satisfies SRC-01's "source health indicator" without a breaking type change to the news health map.

### D-03: Automatic background-tab collection — no URL-paste input

TikTok collects trending topics **automatically**, exactly like Reddit and X. The background opens a background tab to `CONFIG.scrape.tiktok.url` (the discover page) during the normal collection cycle (`runCollection`), gated by the `enabled.tiktok` toggle. The content script scrapes and reports; the background waits for the report (racing against `tabLoadTimeout`), closes the tab in `finally`, respects `maxConcurrentTabs`, and never throws uncaught.

**Rationale:** The user explicitly rejected a manual URL-paste input box as over-engineered ("such a stupid flow"). TikTok should bring trending topics automatically like the other social sources. This is the first use of background-tab-driven collection (the `maxConcurrentTabs`/`tabLoadTimeout` config exists but is unused).

### D-04: Timeout mechanism — content-script Promise.race

The content script wraps `sendMessage('REPORT_SOCIAL_DATA', ...)` in `Promise.race` with a timeout (e.g., 5s) and never throws uncaught. The background's `REPORT_SOCIAL_DATA` handler already isolates failures via `mergeSignals` + `Promise.allSettled` in `runCollection`.

**Rationale:** TikTok is content-script-driven; the timeout belongs where the scrape+report happens. Background-side timeout is unnecessary since the handler is fire-and-forget.

### D-05: TikTok default — on by default

Set `DEFAULT_SETTINGS.enabledSources.tiktok = true`. TikTok collects trending topics automatically (like Reddit/X), so it is enabled by default alongside the other social sources.

**Rationale:** TikTok is collected automatically via a background tab — there is no manual URL-paste flow and no requirement to visit the site. It should behave like Reddit/X, which are `true` by default. (Initially set to `false` as opt-in, but corrected to `true` so "Collect now" actually brings TikTok trends.)

## Specific Implementation Details

- **Content script** (`src/content/socials/index.ts`): `detectPlatform()` via hostname; `scrapeTikTok()` with broad defensive selectors (discover page trend cards); normalize to `SocialSignal` with `platform: 'tiktok'`; debounce + hash dedup (like `src/content/news/index.ts`); `Promise.race` timeout on report; try/catch so DOM changes never break the page.
- **Normalizer**: pure function mapping raw scraped trend data → `SocialSignal` (sentiment via `analyzeSentiment`, virality from rank, keywords via `extractKeywords`). Mirrors `x-trends.ts` `normaliseTrend`.
- **Social health**: new `SocialSourceHealth` type + storage key; content script reports health; dashboard `SourceHealthIndicator` (or a new `SocialHealthBadge`) renders TikTok.
- **Automatic collection**: `collectTikTokTrends()` in `src/services/collectors/tiktok.ts`; a pure background `fetch()` of the discover page (host_permissions allow the worker to fetch TikTok directly, bypassing CORS) + parse embedded SSR JSON; wired into `runCollection()` via `if (enabled.tiktok)`. No URL-paste input box, no visible tab — works like Reddit/X/news.
- **SRC-02**: wire additional sources end-to-end (the existing 6 news sources + 2 market platforms already flow; this criterion is about ensuring TikTok + any new source render in dashboard/export).

## Out of Scope

- X/Reddit DOM scraping (already have background collectors)
- TikTok login/authenticated scraping
- Opening a visible/background tab for TikTok collection (replaced by background `fetch()`)
- New runtime dependencies

## Deferred Ideas

- X/Reddit DOM scraping in the socials content script (if background collectors prove insufficient)
- Authenticated TikTok scraping (requires login flow)

## Canonical References

Downstream agents MUST read these before planning or implementing:

- **Research:** `.planning/phases/07-tiktok-collector/07-RESEARCH.md`
- **Content-script pattern:** `src/content/news/index.ts` (debounce + hash dedup + broad selectors)
- **SPA pattern:** `src/content/prediction-markets/index.ts` (MutationObserver + URL polling)
- **Normalizer pattern:** `src/services/collectors/x-trends.ts` (`normaliseTrend`)
- **SocialSignal type:** `src/types/index.ts:59`
- **REPORT_SOCIAL_DATA handler:** `src/background/index.ts:326`
- **Source health:** `src/utils/source-health.ts` (`computeHealth`), `src/dashboard/components/SourceHealthIndicator.tsx`
- **Manifest:** `src/manifest.config.ts` (socials content script already declared)
