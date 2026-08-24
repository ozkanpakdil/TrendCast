---
phase: 10-cross-source-consensus-alerts
reviewed: 2026-08-24T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/types/index.ts
  - src/config/index.ts
  - src/background/alerts.ts
  - src/background/index.ts
  - src/dashboard/components/AlertsTab.tsx
  - tests/unit/cross-source-alerts.test.ts
  - tests/unit/alerts.test.ts
findings:
  critical: 0
  warning: 3
  info: 4
  total: 7
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-08-24
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Reviewed the cross-source consensus alert feature end-to-end: the `AlertKind` discriminator and optional `AlertRecord` fields (`src/types/index.ts`), the consensus config constants (`src/config/index.ts`), the new `evaluateCrossSourceAlerts` engine and `dispatchAlerts` fallback (`src/background/alerts.ts`), the `runAlertSweep` hook (`src/background/index.ts`), the kind-aware AlertsTab rendering (`src/dashboard/components/AlertsTab.tsx`), and the new/updated unit tests.

The core design decisions (D-01..D-09) are implemented correctly and are well-covered by passing unit tests:
- D-01 (≥3 distinct source types + social/news mix) — enforced via `sourceTypes.size` + `hasSocial && hasNews`.
- D-02 (dedupe by source type) — `Set<string>` dedupes correctly.
- D-03 (any direction from mean sentiment) — implemented with a `0.05` band.
- D-06 (reuse `newsSocialMatches`) — reads `result.newsSocialMatches`, confirmed persisted to `CONFIG.storage.correlations` in `runCorrelationAsync`.
- D-07 (cluster by shared keywords) — union-find over shared normalized keywords.
- D-08 (global + per-topic cooldown keyed by `topicId`) — implemented.
- D-09 (gated by `alertsEnabled`) — early return.

No Critical (security/data-loss) issues found. The findings below are quality/robustness concerns: one dead-code block, a global-cooldown interaction that can starve cross-source alerts, and a magic-number threshold. None block shipping, but WR-01 and WR-02 are worth addressing.

## Warnings

### WR-01: Dead code — `keywordCounts` computed but never used

**File:** `src/background/alerts.ts:280-291`
**Issue:** The `keywordCounts` map is populated in the first clustering pass but is never read anywhere. The actual topic key is recomputed per-cluster via `clusterKws` (lines 356-369). This is dead code that suggests the clustering intent was partially implemented — the global keyword-frequency map is built and discarded. It also does redundant `extractEntityKeywords` work on every match.
**Fix:** Remove the `keywordCounts` map and its population loop (keep only `matchKeywords`), or actually use it to seed the per-cluster key selection. The per-cluster `clusterKws` recomputation already covers the "most frequent keyword" logic, so the global map is redundant.

### WR-02: Global cooldown can starve cross-source alerts and limits to one per sweep

**File:** `src/background/alerts.ts:303-305, 401-402`
**Issue:** `evaluateCrossSourceAlerts` and `evaluateAlerts` share the same `state.lastGlobalAlertAt` throttle. In `runAlertSweep` (`src/background/index.ts:283-284`), `evaluateAlerts` runs first; if it fires a watchlist alert it sets `lastGlobalAlertAt = now` and persists. `evaluateCrossSourceAlerts` then reads fresh state and suppresses **all** cross-source clusters for the global cooldown window (5 min). Additionally, within a single `evaluateCrossSourceAlerts` call, the global-cooldown check is inside the cluster loop and `state.lastGlobalAlertAt = now` is set after the first qualifying cluster fires — so only **one** cross-source alert can ever fire per sweep, even when multiple distinct topics reach consensus. This is a behavioral limitation that may surprise users expecting multiple consensus alerts.
**Fix:** Decide whether the global throttle should be shared across kinds. If cross-source alerts should be able to fire independently, use a separate `lastGlobalCrossSourceAlertAt` key (or check the global cooldown once before the loop and only set it once after the loop, rather than per-cluster). At minimum, document that only one alert per global window is intended.

### WR-03: Magic-number direction threshold inconsistent with `sentimentBand`

**File:** `src/background/alerts.ts:380`
**Issue:** The bullish/bearish/mixed split uses a hardcoded `0.05` band, while `evaluateAlerts` uses `CONFIG.alerts.sentimentBand` (0.2) for its meaningful-band logic. The two engines use different, unrelated thresholds for the same "is this a meaningful lean" concept, which is confusing and makes the cross-source behavior untunable via config.
**Fix:** Add a config constant (e.g. `CONFIG.alerts.crossSourceSentimentBand`) and use it here, or reuse `sentimentBand`. This keeps the threshold tunable and consistent with the rest of the alert engine.

## Info

### IN-01: `humanizeTopic` only capitalizes the first word of multi-word topics

**File:** `src/background/alerts.ts:243-248`
**Issue:** For a multi-word topic key like `"federal reserve"`, `humanizeTopic` returns `"Federal reserve"` (only the first character is uppercased). Cosmetic only.
**Fix:** Optionally title-case each word: `k.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')`.

### IN-02: `sourceTypes` array order is non-deterministic

**File:** `src/background/alerts.ts:393`
**Issue:** `[...sourceTypes]` preserves `Set` insertion order, which depends on cluster match iteration order. The rendered source breakdown ("X · Reddit · Seeking Alpha") may vary between sweeps for the same topic.
**Fix:** Sort the array before storing (`[...sourceTypes].sort()`) for stable display.

### IN-03: High cognitive complexity in `evaluateCrossSourceAlerts`

**File:** `src/background/alerts.ts:263`
**Issue:** The linter reports cognitive complexity 57 vs the 15 allowed (30 locations). The function mixes clustering, counting, cooldown, and record construction in one body, which hurts maintainability.
**Fix:** Extract the union-find clustering and the per-cluster consensus/counting into small helper functions.

### IN-04: Test uses a type-unsafe cast for the news-only scenario

**File:** `tests/unit/cross-source-alerts.test.ts:203-208`
**Issue:** The "no social+news mix" test casts `platform: 'bbc' as SocialSignal['platform']`, which is a type lie (bbc is not a valid `SocialPlatform`). It works at runtime because `SOCIAL_PLATFORMS.has('bbc')` is false, but the cast hides the intent.
**Fix:** Construct the fixture with a valid-but-unknown platform or restructure the test to avoid the cast, so the type system reflects the scenario being tested.

---

_Reviewed: 2026-08-24_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
