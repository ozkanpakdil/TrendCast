/**
 * Market-Driven News aggregation (Phase 5).
 *
 * Pure, read-only aggregation that turns existing markets + `correlations.newsMatches`
 * + the watchlist into a bounded, category-grouped `MarketNewsView` snapshot.
 * This is a derived projection over existing data — it performs NO new collection.
 *
 * Design decisions (see 05-CONTEXT.md):
 *   - D-05: A market is "notable" when volume24h >= minVolume OR it is watchlisted.
 *   - D-07: Direction = Yes-price delta blended with mean news sentiment.
 *   - D-08: Sort by volume descending.
 *   - D-09: Group by category.
 *   - D-14: Cap the number of markets per category.
 *
 * The `markets` list is intentionally NOT a parameter — each `NewsCorrelationMatch`
 * embeds its full `MarketContract`, so everything is derived from `newsMatches` alone.
 */

import type {
  MarketContract,
  NewsCorrelationMatch,
  WatchlistEntry,
} from '@/types';
import { classifyCategory, type NewsCategory } from '@/config/taxonomy';
import { sentimentScore } from '@/utils/sentiment';

/** A single market in the market-driven news view. */
export interface MarketDrivenNewsItem {
  contract: MarketContract;
  category: NewsCategory;
  direction: 'up' | 'down' | 'mixed';
  news: NewsCorrelationMatch[];
  signalCount: number;
  volume24h: number;
}

/** The derived, bounded snapshot grouped by category. */
export interface MarketNewsView {
  builtAt: number;
  categories: Record<NewsCategory, MarketDrivenNewsItem[]>;
}

/** Best Yes price (0–1) for a contract, or undefined if none. */
function yesPriceOf(contract: MarketContract): number | undefined {
  return contract.outcomes.find((o) => o.label.toLowerCase() === 'yes')?.price;
}

/** Mean sentiment of a contract's correlated news headlines. */
function meanNewsSentiment(news: NewsCorrelationMatch[]): number {
  if (news.length === 0) return 0;
  const sum = news.reduce((acc, m) => acc + sentimentScore(m.news.headline), 0);
  return sum / news.length;
}

/**
 * Derive a market-level direction from the Yes-price delta and mean news sentiment.
 *   - positive sum → 'up'
 *   - negative sum → 'down'
 *   - otherwise    → 'mixed'
 */
function deriveDirection(contract: MarketContract, news: NewsCorrelationMatch[]): 'up' | 'down' | 'mixed' {
  const yesPrice = yesPriceOf(contract);
  const priceSignal = yesPrice === undefined ? 0 : Math.sign(yesPrice - 0.5);
  const sentimentSignal = Math.sign(meanNewsSentiment(news));
  const combined = priceSignal + sentimentSignal;
  if (combined > 0) return 'up';
  if (combined < 0) return 'down';
  return 'mixed';
}

/**
 * Assign a category to a contract: the majority category of its correlated news
 * (backfilled via `classifyCategory` when a news item lacks one), falling back to
 * `classifyCategory(contract.question)` when no news has a category.
 */
function deriveCategory(contract: MarketContract, news: NewsCorrelationMatch[]): NewsCategory {
  const counts: Record<NewsCategory, number> = { finance: 0, politics: 0, technology: 0 };
  let categorized = 0;
  for (const m of news) {
    const cat = m.news.category ?? classifyCategory(m.news.headline);
    counts[cat] += 1;
    categorized += 1;
  }
  if (categorized === 0) {
    return classifyCategory(contract.question);
  }
  let best: NewsCategory = 'finance';
  let bestCount = -1;
  for (const cat of ['politics', 'finance', 'technology'] as NewsCategory[]) {
    if (counts[cat] > bestCount) {
      best = cat;
      bestCount = counts[cat];
    }
  }
  return best;
}

/**
 * Build the market-driven news view from existing correlation matches + watchlist.
 * Only contracts that appear in `newsMatches` are included (the view is
 * "market-driven **news**" — a market with no correlated news has nothing to surface).
 */
export function buildMarketDrivenNews(
  newsMatches: NewsCorrelationMatch[],
  watchlist: WatchlistEntry[],
  minVolume: number,
  capPerCategory: number,
): MarketNewsView {
  const watchlisted = new Set(watchlist.map((w) => w.contractId));

  // Group matches by contract id, keeping only notable contracts (D-05).
  const byContract = new Map<string, MarketDrivenNewsItem>();
  for (const match of newsMatches) {
    const contract = match.contract;
    const volume = contract.volume24h ?? 0;
    const notable = volume >= minVolume || watchlisted.has(contract.id);
    if (!notable) continue;

    let item = byContract.get(contract.id);
    if (!item) {
      item = {
        contract,
        category: 'finance',
        direction: 'mixed',
        news: [],
        signalCount: 0,
        volume24h: volume,
      };
      byContract.set(contract.id, item);
    }
    item.news.push(match);
  }

  // Compute direction + category per contract.
  const items: MarketDrivenNewsItem[] = [];
  for (const item of byContract.values()) {
    item.direction = deriveDirection(item.contract, item.news);
    item.category = deriveCategory(item.contract, item.news);
    item.signalCount = item.news.length;
    items.push(item);
  }

  // Group by category, sort by volume descending, cap per category (D-08/D-09/D-14).
  const categories: Record<NewsCategory, MarketDrivenNewsItem[]> = {
    finance: [],
    politics: [],
    technology: [],
  };
  for (const item of items) {
    categories[item.category].push(item);
  }
  for (const cat of Object.keys(categories) as NewsCategory[]) {
    categories[cat].sort((a, b) => b.volume24h - a.volume24h);
    categories[cat] = categories[cat].slice(0, capPerCategory);
  }

  return {
    builtAt: Date.now(),
    categories,
  };
}
