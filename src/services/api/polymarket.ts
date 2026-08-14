/**
 * Polymarket CLOB + Gamma API client.
 *
 * Polymarket exposes two APIs:
 *  - Gamma API: market metadata (questions, slugs, descriptions)
 *  - CLOB API: order book / prices / live odds
 *
 * Both are public for read-only market data — no API key required.
 *
 * Docs:
 *  - Gamma: https://docs.polymarket.com (gamma-api endpoints)
 *  - CLOB:  https://docs.polymarket.com/developers/CLOB
 *
 * ⚠️ Pitfall: Polymarket's Gamma API returns markets in a different shape
 *    than the CLOB API. We normalise both into our `MarketContract` type.
 */

import type { MarketContract, MarketOutcome } from '@/types';
import { CONFIG } from '@/config';
import { RateLimiter } from '@/utils/rate-limiter';
import { extractKeywords } from '@/utils/keywords';

const limiter = new RateLimiter(CONFIG.rateLimits.polymarket);

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

/** Fetch active markets from the Gamma API. */
export async function fetchPolymarketMarkets(limit = 100): Promise<MarketContract[]> {
  await limiter.waitForToken();

  const url = `${CONFIG.apis.polymarket.gamma}/markets?limit=${limit}&active=true&closed=false&order=volume&ascending=false`;

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Polymarket Gamma API error: ${response.status} ${response.statusText}`);
  }

  const data: GammaMarket[] = await response.json();

  return data.map(normaliseGammaMarket).filter((m): m is MarketContract => m !== null);
}

/** Fetch a single market by its slug (used by content scripts on polymarket.com). */
export async function fetchPolymarketMarketBySlug(slug: string): Promise<MarketContract | null> {
  await limiter.waitForToken();

  const url = `${CONFIG.apis.polymarket.gamma}/markets?slug=${encodeURIComponent(slug)}`;

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) return null;

  const data: GammaMarket[] = await response.json();
  if (data.length === 0) return null;

  return normaliseGammaMarket(data[0]);
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
      keywords: extractKeywords(raw.question),
      lastUpdated: Date.now(),
    };
  } catch {
    // Malformed market data — skip it.
    return null;
  }
}