---
phase: 01-data-reliability
reviewed: 2026-08-22T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/utils/source-health.ts
  - src/dashboard/components/SourceHealthIndicator.tsx
  - src/types/index.ts
  - src/config/index.ts
  - src/services/collectors/news.ts
  - src/background/index.ts
  - src/dashboard/App.tsx
  - src/dashboard/hooks/useSnapshot.ts
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
resolved:
  - WR-01
---

# Phase 01: Code Review Report

**Reviewed:** 2026-08-22T00:00:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found (WR-01 resolved 2026-08-22T22:00:00Z)

## Summary

Reviewed the Phase 1 (Data Reliability) source-health telemetry layer end-to-end: the pure projection helpers (`source-health.ts`), the persisted `SourceHealth` type + config, the `collectNews` health-map recording, the background `runCollection` persistence, and the `SourceHealthIndicator` UI wiring in `App.tsx`/`useSnapshot.ts`.

The architecture is sound: embedding `sourceHealth` inside `CollectionSnapshot` for atomic persistence, keying the map by the typed `NewsSource` union (ASVS V5), and delegating staleness to a pure `computeHealth` are all correct and well-tested. No security vulnerabilities, hardcoded secrets, or injection risks were found. The main concerns are logic/robustness issues in the health-state semantics and a broken memoization boundary.

## Warnings

### WR-01: Empty/304 fetch is mislabeled as a failure, so healthy-but-unchanged sources show "Degraded"

**File:** `src/services/collectors/news.ts:60-64`
**Issue:** In the fulfilled branch, `consecutiveFailures` is incremented whenever `sourceItems.length === 0`:
```ts
consecutiveFailures: sourceItems.length > 0 ? 0 : (prev?.consecutiveFailures ?? 0) + 1,
```
`collectFromSource` returns `[]` both for a genuine empty feed AND for a `304 Not Modified` (unchanged) response (`news.ts:96-98`). A source that is healthy but simply has no new items since the last cycle (304) therefore accumulates `consecutiveFailures` and is rendered as **Degraded** by `computeHealthState` (`source-health.ts:29`). This directly undermines the REL-01 goal of distinguishing "failed/empty source" from "source with no correlated items" — a 304 is neither a failure nor an empty source; it is a healthy, unchanged source. Over consecutive hourly cycles a working source will drift to Degraded purely because nothing changed.

**Fix:** Treat a 304 as a healthy no-op, not a failure. Have `collectFromSource` signal "unchanged" distinctly (e.g. return a sentinel or a discriminated result), and only increment `consecutiveFailures` on a genuine rejection or a non-304 empty parse:
```ts
// collectFromSource returns { items, unchanged } or a tagged union
if (result.status === 'fulfilled') {
  const { items, unchanged } = result.value;
  items.push(...items);
  health[source] = {
    lastFetchedAt: Date.now(),
    itemCount: items.length,
    // 304 (unchanged) is NOT a failure — only reset or carry, never increment
    consecutiveFailures: unchanged ? (prev?.consecutiveFailures ?? 0) : items.length > 0 ? 0 : (prev?.consecutiveFailures ?? 0) + 1,
  };
}
```

**✅ RESOLVED (2026-08-22T22:00:00Z):** `collectFromSource` now returns `{ items, unchanged }`; a 304 is a healthy no-op that does not increment `consecutiveFailures`. Unit tests updated to assert a 304 does NOT increment failures (6 tests pass).

### WR-02: Invalid `pubDate` throws RangeError and drops the entire source's collection

**File:** `src/services/collectors/news.ts:130`
**Issue:**
```ts
publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
```
If `item.pubDate` is present but not a valid date string, `new Date(item.pubDate)` yields an Invalid Date and `.toISOString()` throws `RangeError: Invalid time value`. Because this runs inside the `.map()` in `collectFromSource`, the exception rejects the whole `collectFromSource` promise for that source. `Promise.allSettled` in `collectNews` then records the entire source as failed (`news.ts:66-72`), discarding every valid item that source produced — a single malformed feed entry causes total data loss for that source.

**Fix:** Guard the date conversion and fall back to a valid timestamp instead of throwing:
```ts
const parsed = item.pubDate ? new Date(item.pubDate) : null;
const publishedAt = parsed && !Number.isNaN(parsed.getTime())
  ? parsed.toISOString()
  : new Date().toISOString();
```

### WR-03: `memo` on `SourceHealthIndicator` is defeated by inline recomputation in `App.tsx`

**File:** `src/dashboard/App.tsx:328` and `src/dashboard/App.tsx:620`
**Issue:** `correlatedCounts` is computed inline in JSX on every render:
```tsx
correlatedCounts={computeCorrelatedCounts(correlations?.newsMatches ?? [])}
```
`computeCorrelatedCounts` returns a fresh object each call, and `health={snapshot?.sourceHealth ?? {}}` also produces a new `{}` when `snapshot` is null. The component is wrapped in `memo` (`SourceHealthIndicator.tsx:159`), but these always-new object props mean the memo comparison never passes, so the memoization provides no benefit and the indicator re-renders on every parent render.

**Fix:** Memoize the derived props with `useMemo` so the memoized child actually skips re-renders:
```tsx
const correlatedCounts = useMemo(
  () => computeCorrelatedCounts(correlations?.newsMatches ?? []),
  [correlations?.newsMatches],
);
const health = useMemo(() => snapshot?.sourceHealth ?? {}, [snapshot?.sourceHealth]);
```

### WR-04: `error` state is not cleared when a storage change delivers a valid snapshot

**File:** `src/dashboard/hooks/useSnapshot.ts:55-65`
**Issue:** `setError(false)` is only called inside `fetchSnapshot`'s success path. The `storage.onChanged` listener updates `snapshot`/`lastCollectionAt` directly without clearing `error`. If an initial read fails (`setError(true)`), a subsequent successful collection that updates `latestSnapshot` via the listener will update the data but leave `error === true`, so `SourceHealthIndicator` keeps showing the "Health data unavailable" error copy even though fresh health data is now present.

**Fix:** Clear the error in the storage-change listener when a new snapshot arrives:
```ts
if (changes[CONFIG.storage.latestSnapshot]?.newValue) {
  setSnapshot(changes[CONFIG.storage.latestSnapshot].newValue as CollectionSnapshot);
  setError(false);
}
```

## Info

### IN-01: `lastFetchedAt` set to `Date.now()` on failure makes staleness moot for failed sources

**File:** `src/services/collectors/news.ts:70-72`
**Issue:** On a rejected fetch, `lastFetchedAt: Date.now()` is recorded. Since `consecutiveFailures > 0` already forces `'degraded'` in `computeHealthState`, the staleness branch is unreachable for failed sources. This is harmless but means the `lastFetchedAt` value on a failure entry is misleading (it records the failure time, not a successful fetch time). Consider leaving `lastFetchedAt` at the previous successful value so the staleness signal is preserved.

### IN-02: Staleness comparison uses `>` instead of `>=`

**File:** `src/utils/source-health.ts:24`
**Issue:** `if (now - entry.lastFetchedAt > stalenessThresholdMs)` — a source exactly at the threshold boundary is still `'healthy'`. Negligible in practice (sub-millisecond boundary), but `>=` is the more precise intent for "older than the threshold".

### IN-03: `error` boolean conflates "no snapshot yet" with "read failure"

**File:** `src/dashboard/hooks/useSnapshot.ts:28-34`
**Issue:** `setError(false)` runs on every successful `fetchSnapshot`, including when `snap` is `undefined` (no snapshot has ever been collected). The `error` flag therefore only reflects storage-read failures, not data absence — which is correct for the indicator's contract, but the naming is slightly ambiguous. Consider a distinct `hasData` flag if the distinction matters downstream.

---

_Reviewed: 2026-08-22T00:00:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
