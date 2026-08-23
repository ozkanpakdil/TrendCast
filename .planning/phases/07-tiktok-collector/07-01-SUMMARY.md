# Plan 07-01: TikTok Content-Script Scraper + Normalizer - Summary

**Status:** Complete
**Date:** 2026-08-23

## What Was Built

Implemented the empty `src/content/socials/index.ts` to scrape TikTok discover-page trends and report them as `SocialSignal[]` via `REPORT_SOCIAL_DATA`, with debounce, hash dedup, and a 5s `Promise.race` hard timeout (D-01, D-04).

### Files Created/Modified

- **`src/utils/tiktok.ts`** (NEW) — Pure `normaliseTikTokTrend(trend: RawTikTokTrend): SocialSignal` mapping a raw scraped trend to a `SocialSignal` with `platform: 'tiktok'`, rank-based virality (`98 - rank * 4.5` clamped to [50, 98]), sentiment via `analyzeSentiment`, keywords via `extractKeywords`, stable slug id `tiktok:<slugified-title>`, and a TikTok search URL. Mirrors `x-trends.ts` `normaliseTrend`.
- **`src/content/socials/index.ts`** (IMPLEMENTED — was empty) — `detectPlatform()` returns `'tiktok'` only on tiktok.com (X/Reddit no-op per D-01); `scrapeTikTok()` extracts trend titles via broad defensive selectors (`[data-e2e*="trend"]`, `[data-e2e*="challenge"]`, `[class*="trend"]`, `[class*="card"] a`, `h3`), dedups by title, caps at 30, returns `[]` gracefully; `scanAndReport()` debounces (500ms), hash-dedups, and reports via `sendMessage('REPORT_SOCIAL_DATA', ...)` wrapped in a 5s `Promise.race` timeout that never throws uncaught. Bootstrapping guarded behind `typeof window !== 'undefined' && typeof document !== 'undefined' && document.body` so unit-test imports don't auto-run.
- **`tests/unit/tiktok-normalizer.test.ts`** (NEW) — 6 tests: platform/text/virality/keywords, virality rank ordering, sentiment, id slug, search URL, default metrics/author.
- **`tests/unit/tiktok-scraper.test.ts`** (NEW) — 8 tests: detectPlatform (tiktok/x/reddit), extract + rank, dedup, cap at 30, graceful `[]`, skip short titles. Mocks `@/messaging/browser` to avoid the webextension-polyfill browser-only error.

## Verification

- `bun run test -- tests/unit/tiktok-normalizer.test.ts` — 6/6 pass
- `bun run test -- tests/unit/tiktok-scraper.test.ts` — 8/8 pass
- `bun run typecheck` — clean
- `bun run test` (full suite) — 247/247 pass (no regressions)
- `grep -n 'Promise.race' src/content/socials/index.ts` — timeout present (D-04)
- `grep -n 'tiktok' src/content/socials/index.ts` — hostname detection present (D-01)

## Must-Haves Verified

- [x] Empty `src/content/socials/index.ts` implemented: detects tiktok.com, scrapes discover page, no-ops on X/Reddit (D-01)
- [x] Scraped trends normalize to `SocialSignal` with `platform: 'tiktok'`
- [x] Debounce + hash dedup (mirrors `src/content/news/index.ts`)
- [x] `sendMessage('REPORT_SOCIAL_DATA', ...)` wrapped in 5s `Promise.race` timeout, never throws uncaught (D-04)
- [x] TikTok DOM change returns `[]` gracefully, never breaks the host page

## Deviations

None. The plan was executed as written. Tasks 2 and 3 were implemented together in a single file write (both modify `src/content/socials/index.ts`), then tested separately.

## Next

Plan 07-02: Social source health + graceful degradation indicator (`SocialSourceHealth` map + TikTok badge).
