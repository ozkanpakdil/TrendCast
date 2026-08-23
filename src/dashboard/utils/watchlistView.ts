/**
 * Pure watchlist view logic — sort, filter, and correlation-status derivation.
 *
 * Kept free of React/JSX so it is unit-testable. The dashboard Watchlist
 * component applies these helpers to the backfilled watchlist (06-01).
 *
 * Decisions (see 06-CONTEXT.md):
 *   - D-04: Sort by `addedAt` (default) or `volume24h`.
 *   - D-05: Filter by `platform` (polymarket / kalshi).
 *   - D-06: Minimal sort/filter set — no price-delta/confidence sort, no
 *           has-correlation filter.
 *   - D-07: Per-market correlation-status badge (none / has-correlation with
 *           direction bull/bear/neutral).
 */

import type {
  CorrelationResult,
  MarketContract,
  MarketPlatform,
  WatchlistEntry,
} from '@/types';
import { sentimentScore } from '@/utils/sentiment';

export type WatchlistSort = 'addedAt' | 'volume24h';
export type WatchlistPlatformFilter = 'all' | MarketPlatform;
export type CorrelationStatus = 'none' | 'has-correlation';
export type CorrelationDirection = 'bull' | 'bear' | 'neutral';

/** Best Yes price (0–1) for a contract, or undefined if none. */
function yesPriceOf(contract: MarketContract): number | undefined {
  return contract.outcomes.find((o) => o.label.toLowerCase() === 'yes')?.price;
}

/**
 * Sort watchlist entries.
 * - `addedAt`: newest first (descending addedAt) — current behavior.
 * - `volume24h`: by the live market's `volume24h` descending; entries with no
 *   live market (or no volume) sort last (stable).
 */
export function sortWatchlist(
  entries: WatchlistEntry[],
  sort: WatchlistSort,
  markets: MarketContract[],
): WatchlistEntry[] {
  if (sort === 'addedAt') {
    return [...entries].sort((a, b) => b.addedAt - a.addedAt);
  }

  // volume24h: look up each entry's live market by contractId + platform.
  const marketByKey = new Map<string, MarketContract>();
  for (const m of markets) marketByKey.set(`${m.platform}:${m.id}`, m);

  return [...entries].sort((a, b) => {
    const va = marketByKey.get(`${a.platform}:${a.contractId}`)?.volume24h;
    const vb = marketByKey.get(`${b.platform}:${b.contractId}`)?.volume24h;
    const na = va == null ? -1 : va;
    const nb = vb == null ? -1 : vb;
    // Entries with no live market / no volume sort last.
    if (na === -1 && nb === -1) return 0;
    if (na === -1) return 1;
    if (nb === -1) return -1;
    return nb - na;
  });
}

/**
 * Filter watchlist entries by platform.
 * `'all'` returns the input unchanged; otherwise filters by `entry.platform`.
 */
export function filterWatchlist(
  entries: WatchlistEntry[],
  platform: WatchlistPlatformFilter,
): WatchlistEntry[] {
  if (platform === 'all') return entries;
  return entries.filter((e) => e.platform === platform);
}

/**
 * Whether a contract has any correlation in the given result.
 * Returns `'has-correlation'` if the contract appears in `matches` or
 * `newsMatches` (by contract id), else `'none'`. A null result (no run yet)
 * is treated as `'none'`.
 */
export function correlationStatusFor(
  contractId: string,
  platform: MarketPlatform,
  correlations: CorrelationResult | null,
): CorrelationStatus {
  if (!correlations) return 'none';
  const inSocial = correlations.matches.some(
    (m) => m.contract.id === contractId && m.contract.platform === platform,
  );
  const inNews = correlations.newsMatches.some(
    (m) => m.contract.id === contractId && m.contract.platform === platform,
  );
  return inSocial || inNews ? 'has-correlation' : 'none';
}

/**
 * Derive a market-level direction from its correlated matches.
 * Aggregates the mean sentiment of the correlated signals/news and the
 * Yes-price: positive sentiment + Yes ≥ 0.5 → `'bull'`; negative sentiment +
 * Yes < 0.5 → `'bear'`; otherwise `'neutral'`. If the contract has no
 * correlation, returns `'neutral'`.
 */
export function correlationDirectionFor(
  contractId: string,
  platform: MarketPlatform,
  correlations: CorrelationResult | null,
): CorrelationDirection {
  if (!correlations) return 'neutral';

  const socialMatches = correlations.matches.filter(
    (m) => m.contract.id === contractId && m.contract.platform === platform,
  );
  const newsMatches = correlations.newsMatches.filter(
    (m) => m.contract.id === contractId && m.contract.platform === platform,
  );
  if (socialMatches.length === 0 && newsMatches.length === 0) return 'neutral';

  // Aggregate mean sentiment across correlated signals + news.
  let sentiment = 0;
  let count = 0;
  for (const m of socialMatches) {
    sentiment += m.signal.sentiment;
    count += 1;
  }
  for (const m of newsMatches) {
    sentiment += sentimentScore(m.news.headline);
    count += 1;
  }
  const meanSentiment = count > 0 ? sentiment / count : 0;

  // Yes-price from the first correlated contract (all share the same contract).
  const contract = socialMatches[0]?.contract ?? newsMatches[0]?.contract;
  const yes = contract ? yesPriceOf(contract) : undefined;

  if (meanSentiment > 0 && (yes == null || yes >= 0.5)) return 'bull';
  if (meanSentiment < 0 && (yes == null || yes < 0.5)) return 'bear';
  return 'neutral';
}
