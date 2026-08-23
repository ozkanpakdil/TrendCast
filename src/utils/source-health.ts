/**
 * Source-health helpers — pure, testable projections over the persisted
 * `SourceHealth` map. Kept free of storage/React dependencies so they can
 * be unit-tested in isolation (RESEARCH "Don't Hand-Roll").
 */

import type {
  NewsCorrelationMatch,
  NewsSource,
  SocialPlatform,
  SocialSourceHealth,
  SourceHealthEntry,
} from '@/types';

/** Semantic health states for a single news source. */
export type SourceHealthState = 'healthy' | 'stale' | 'degraded' | 'no-data';

/**
 * Derive a source's semantic health state from its persisted entry.
 *
 * Rules (grounded in UI-SPEC):
 * - `undefined` entry → `'no-data'`
 * - `consecutiveFailures > 0` → `'degraded'`
 * - `itemCount === 0` and not unchanged (304) → `'degraded'`
 * - `now - lastFetchedAt > stalenessThresholdMs` → `'stale'`
 * - otherwise → `'healthy'`
 */
export function computeHealth(
  entry: SourceHealthEntry | undefined,
  stalenessThresholdMs: number,
  now: number,
): SourceHealthState {
  if (!entry) return 'no-data';
  if (entry.consecutiveFailures > 0) return 'degraded';
  if (entry.itemCount === 0 && !entry.lastUnchanged) return 'degraded';
  if (now - entry.lastFetchedAt > stalenessThresholdMs) return 'stale';
  return 'healthy';
}

/**
 * Group correlation news matches by their typed source.
 * Returns a map of source → number of correlated items.
 */
export function computeCorrelatedCounts(
  newsMatches: NewsCorrelationMatch[],
): Partial<Record<NewsSource, number>> {
  const counts: Partial<Record<NewsSource, number>> = {};
  for (const match of newsMatches) {
    const source = match.news.source;
    counts[source] = (counts[source] ?? 0) + 1;
  }
  return counts;
}

/**
 * Pure merge helper for the social-health map (Phase 7, D-02).
 * Returns a new map with only the given platform's entry updated;
 * all other platforms are preserved. No storage I/O — unit-testable.
 */
export function mergeSocialHealth(
  existing: SocialSourceHealth,
  platform: SocialPlatform,
  entry: SourceHealthEntry,
): SocialSourceHealth {
  return { ...existing, [platform]: entry };
}
