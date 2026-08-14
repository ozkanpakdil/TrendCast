/**
 * Polymarket data collector.
 *
 * Uses the public Gamma API (no API key required) to fetch active markets.
 * The background worker calls this directly via `fetch()` — host_permissions
 * in the manifest allow cross-origin requests from the extension context.
 *
 * If the user is browsing polymarket.com, the content script can also
 * scrape market data from the DOM and report it via REPORT_MARKET_DATA.
 *
 * Docs: https://docs.polymarket.com (gamma-api endpoints)
 */

import type { MarketContract, MarketOutcome } from '@/types';
import { CONFIG } from '@/config';
import { extractKeywords } from '@/utils/keywords';

/** Raw Gamma API market shape (subset of fields we use). */
interface GammaMarket {
  id: string;
  question: string;
  slug: string;
  endDate: string;
  volume?: string;
  liquidity?: string;
  outcomes: string; // JSON-encoded string array, e.g. "[\"Yes\",\"No\"]"
  outcomePrices: string; // JSON-encoded string array, e.g. "[\"0.65\",\"0.35\"]"
  clobTokenIds?: string[];
}

/**
 * Fetch active Polymarket markets from the public Gamma API.
 * No authentication required — this is read-only public data.
 */
export async function collectPolymarketMarkets(limit = 100): Promise<MarketContract[]> {
  const url = `${CONFIG.scrape.polymarket.gammaApi}&limit=${limit}`;

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Polymarket Gamma API error: ${response.status} ${response.statusText}`);
  }

  const data: GammaMarket[] = await response.json();

  const results = data
    .map(normaliseGammaMarket)
    .filter((m): m is MarketContract => m !== null);

  console.log(`[TrendCast] Polymarket: ${results.length} items collected`);
  return results;
}

/** Convert a Gamma API market into our normalised `MarketContract`. */
function normaliseGammaMarket(raw: GammaMarket): MarketContract | null {
  try {
    const outcomeLabels: string[] = JSON.parse(raw.outcomes);
    const outcomePrices: string[] = JSON.parse(raw.outcomePrices);

    const outcomes: MarketOutcome[] = outcomeLabels.map((label, i) => ({
      label,
      price: parseFloat(outcomePrices[i] ?? '0'),
    }));

    return {
      id: raw.id,
      platform: 'polymarket',
      question: raw.question,
      outcomes,
      endDate: raw.endDate,
      volume24h: raw.volume ? parseFloat(raw.volume) : undefined,
      liquidity: raw.liquidity ? parseFloat(raw.liquidity) : undefined,
      slug: raw.slug,
      url: `https://polymarket.com/event/${raw.slug}`,
      keywords: extractKeywords(raw.question),
      lastUpdated: Date.now(),
    };
  } catch {
    return null;
  }
}