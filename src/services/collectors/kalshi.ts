/**
 * Kalshi data collector.
 *
 * Uses Kalshi's public market data endpoint (no authentication required
 * for read-only market data). The background worker calls this directly
 * via `fetch()`.
 *
 * If the user is browsing kalshi.com, the content script can also scrape
 * market data from the DOM and report it via REPORT_MARKET_DATA.
 *
 * Docs: https://trading-api.readme.io/kalshi/v2/overview
 *
 * ⚠️ Kalshi uses "event" and "market" as separate concepts.
 *    An event (e.g. "Bitcoin Price") contains multiple markets
 *    (e.g. "BTC > $100k", "BTC > $120k"). We flatten markets and
 *    attach the event title as context.
 */

import type { MarketContract, MarketOutcome } from '@/types';
import { CONFIG } from '@/config';
import { extractKeywords } from '@/utils/keywords';

/** Raw Kalshi market shape (subset). */
interface KalshiMarket {
  id: string;
  ticker: string;
  title: string;
  subtitle?: string;
  volume?: number;
  liquidity?: number;
  yes_bid?: number;
  yes_ask?: number;
  no_bid?: number;
  no_ask?: number;
  last_price?: number;
  close_time?: string;
  event_ticker?: string;
}

/**
 * Fetch active Kalshi markets from the public API.
 * No authentication required for read-only market data.
 */
export async function collectKalshiMarkets(limit = 100): Promise<MarketContract[]> {
  const url = `${CONFIG.scrape.kalshi.api}&limit=${limit}`;

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Kalshi API error: ${response.status} ${response.statusText}`);
  }

  const data: { markets: KalshiMarket[] } = await response.json();

  return data.markets
    .map(normaliseKalshiMarket)
    .filter((m): m is MarketContract => m !== null);
}

/** Convert a Kalshi market into our normalised `MarketContract`. */
function normaliseKalshiMarket(raw: KalshiMarket): MarketContract | null {
  try {
    // Kalshi prices are in cents (0–100). Convert to 0–1 probability.
    const yesPrice = raw.last_price != null ? raw.last_price / 100 : undefined;

    const outcomes: MarketOutcome[] = [];
    if (yesPrice != null) {
      outcomes.push({ label: 'Yes', price: yesPrice });
      outcomes.push({ label: 'No', price: 1 - yesPrice });
    } else if (raw.yes_ask != null) {
      const price = raw.yes_ask / 100;
      outcomes.push({ label: 'Yes', price });
      outcomes.push({ label: 'No', price: 1 - price });
    }

    if (outcomes.length === 0) return null;

    const fullTitle = raw.subtitle ? `${raw.title} — ${raw.subtitle}` : raw.title;

    return {
      id: raw.ticker,
      platform: 'kalshi',
      question: fullTitle,
      outcomes,
      endDate: raw.close_time ?? '',
      volume24h: raw.volume,
      liquidity: raw.liquidity,
      slug: raw.ticker,
      keywords: extractKeywords(fullTitle),
      lastUpdated: Date.now(),
    };
  } catch {
    return null;
  }
}