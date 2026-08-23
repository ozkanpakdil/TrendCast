# Plan 07-02: Social Source Health + Graceful Degradation Badge - Summary

**Status:** Complete
**Date:** 2026-08-23

## What Was Built

Added a separate `SocialSourceHealth` map and a single TikTok health badge so the user sees a graceful-degradation indicator when TikTok is unavailable (D-02, success criterion 3). The `NewsSource`-keyed `SourceHealth` union is untouched.

### Files Created/Modified

- **`src/types/index.ts`** — Added `SocialSourceHealth = Partial<Record<SocialPlatform, SourceHealthEntry>>` (line 118) with a doc comment noting it's kept separate from the news union (D-02). Added `REPORT_SOCIAL_HEALTH` message variant (line 464): `{ platform: SocialPlatform; entry: SourceHealthEntry }`.
- **`src/utils/source-health.ts`** — Added pure `mergeSocialHealth(existing, platform, entry)` helper returning `{ ...existing, [platform]: entry }`. `computeHealth` reused unchanged (D-02).
- **`src/config/index.ts`** — Added `socialSourceHealth: 'trendcast:social-source-health'` storage key.
- **`src/content/socials/index.ts`** — Added `consecutiveFailures` module state + `reportHealth(entry)` helper (5s `Promise.race` timeout, never throws). `scanAndReport()` now reports health: on empty scrape → `consecutiveFailures++` + `itemCount: 0`; on success → `consecutiveFailures: 0` + `itemCount: signals.length`; on report error → `consecutiveFailures++` + `lastError`.
- **`src/background/index.ts`** — Added `onMessage('REPORT_SOCIAL_HEALTH', ...)` handler (line 344) that reads `socialSourceHealth`, applies `mergeSocialHealth`, writes back via `browser.storage.local.set`, isolated with try/catch. Imported `SocialSourceHealth` + `mergeSocialHealth`.
- **`src/dashboard/components/SocialHealthBadge.tsx`** (NEW) — Memo component rendering a single `🎵 TikTok` badge reusing `computeHealth` + the same `STATE_META` status word/color classes as `SourceHealthIndicator`. Undefined entry → `no-data` state (graceful degradation). Props: `{ health: SocialSourceHealth; isDark: boolean; loading: boolean }`.
- **`tests/unit/social-source-health.test.ts`** (NEW) — 6 tests: type shape (empty + with tiktok), `computeHealth` no-data/degraded reuse, `mergeSocialHealth` update-preserve-others, failure increment/reset, no mutation.

## Verification

- `bun run test -- tests/unit/social-source-health.test.ts` — 6/6 pass
- `bun run typecheck` — clean
- `bun run test` (full suite) — 253/253 pass (no regressions)
- `grep -n 'SocialSourceHealth' src/types/index.ts` — separate map present (D-02)
- `grep -n 'REPORT_SOCIAL_HEALTH' src/background/index.ts src/content/socials/index.ts src/types/index.ts` — health reporting wired
- `grep -n 'computeHealth' src/dashboard/components/SocialHealthBadge.tsx` — reuse confirmed (D-02)

## Must-Haves Verified

- [x] Separate `SocialSourceHealth` map exists; `NewsSource`-keyed union untouched (D-02)
- [x] Content script reports TikTok `lastFetchedAt`/`itemCount`/`consecutiveFailures`
- [x] Dashboard renders a single TikTok badge reusing `computeHealth`
- [x] Undefined entry → graceful `no-data` state (success criterion 3)

## Deviations

None. The plan was executed as written. The badge component is delivered but not yet mounted in the dashboard layout — that wiring is part of 07-03's end-to-end work (as noted in the plan).

## Next

Plan 07-03: Automatic TikTok collection (`collectTikTokTrends` background-fetch collector wired into `runCollection`, like Reddit/X — no visible tab) + mount the badge + SRC-02 end-to-end wiring. No URL-paste input box.
