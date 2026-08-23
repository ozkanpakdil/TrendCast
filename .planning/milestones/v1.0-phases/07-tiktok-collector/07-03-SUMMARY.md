# Plan 07-03: Automatic TikTok Collection + SRC-02 Wiring - Summary

**Status:** Complete (code + tests); human-verify checkpoint pending
**Date:** 2026-08-23

## What Was Built

Wired TikTok into the automatic collection flow (like Reddit/X) via a **pure background `fetch()`** of the discover page — no visible tab, no URL paste. Mounted the `SocialHealthBadge` in the dashboard. **Removed** the over-engineered manual URL-paste input — TikTok brings trending topics automatically, matching the other social sources.

### Files Created/Modified

- **`src/services/collectors/tiktok.ts`** (NEW) — `collectTikTokTrends()` fetches `CONFIG.scrape.tiktok.url` via `conditionalFetch` (host_permissions let the MV3 worker fetch TikTok directly, bypassing CORS), parses trending titles from the embedded `__UNIVERSAL_DATA_FOR_REHYDRATION__` SSR JSON (with a `#hashtag` fallback), normalises to `SocialSignal`, and gracefully returns `[]` when the page shape changes.
- **`src/services/collectors/index.ts`** — Exported `collectTikTokTrends`.
- **`src/background/index.ts`** — Added `if (enabled.tiktok)` to `runCollection()` that calls `collectTikTokTrends()` → `storeSignals()` (isolated via `.catch`). Imported `collectTikTokTrends`.
- **`src/manifest.config.ts`** — Added `*://*.tiktok.com/*` to the socials content-script `matches` and `web_accessible_resources` (TikTok redirects to `www.tiktok.com`, so the bare `*://tiktok.com/*` never matched). `https://*.tiktok.com/*` host_permission already present (enables the background fetch).
- **`src/dashboard/App.tsx`** — Mounted `SocialHealthBadge` in the feed tab (no URL input).
- **`tests/unit/tiktok-collector.test.ts`** (NEW) — 9 tests: SSR JSON parsing, dedup, `#hashtag` fallback, graceful `[]`, MAX_TRENDS cap, fetch + normalise, 304 skip, non-ok throw, no-trends graceful.

### Removed (over-engineering + visible tab)

- `src/background/tiktok-tab.ts` + `tests/unit/tiktok-tab.test.ts` — the background-tab collector (opened a visible tab, which the user rejected)
- `COLLECT_TIKTOK_URL` message variant (types/index.ts)
- `onMessage('COLLECT_TIKTOK_URL', ...)` handler (background/index.ts)
- Dashboard URL-paste input + `handleCollectTikTok` + related state (App.tsx)
- `tests/unit/tiktok-url-collect.test.ts`

## Verification

- `bun run test -- tests/unit/tiktok-collector.test.ts` — 9/9 pass
- `bun run typecheck` — clean
- `bun run test` (full suite) — 262/262 pass (no regressions)
- `grep -n 'enabled.tiktok' src/background/index.ts` — TikTok wired into `runCollection`

## Must-Haves Verified (code-level)

- [x] TikTok collects automatically via background `fetch()` (like Reddit/X), no URL paste, no visible tab
- [x] Content script still handles the discover page when the user visits (broad selectors, graceful `[]`)
- [x] `SocialHealthBadge` mounted in dashboard
- [x] TikTok failure isolated (never degrades other sources)

## Human-Verify Checkpoint (pending)

Real-browser confirmation of:
1. TikTok discover-page scraping yields 🎵 TikTok signals in the HypeFeed
2. The TikTok health badge shows graceful degradation when unreachable
3. All sources (6 news + Polymarket/Kalshi + Reddit/X + TikTok) render end-to-end (SRC-02)
4. TikTok failure does not degrade other sources

## Deviations

Two, both corrections toward the user's intent:
1. **Removed the manual URL-paste fallback** — the user pointed out Reddit/X bring trending topics automatically, so TikTok should too. Replaced with automatic background-tab collection wired into `runCollection`.
2. **Fixed the manifest `matches`** — added `*://*.tiktok.com/*` (TikTok redirects to `www.tiktok.com`, so the content script never ran on the bare `*://tiktok.com/*` match).

## Next

Present the human-verify checkpoint (UAT) to the user, then run the verifier and complete Phase 7.
