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
import { conditionalFetchJson } from '@/utils/conditional-fetch';

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
  /** Nested event(s) this market belongs to. The event slug is what
   *  polymarket.com/event/<slug> expects — the market slug 404s. */
  events?: GammaEvent[];
}

interface GammaEvent {
  id: string;
  slug: string;
  title: string;
}

/**
 * Fetch active Polymarket markets from the public Gamma API.
 * No authentication required — this is read-only public data.
 */
export async function collectPolymarketMarkets(limit = 100): Promise<MarketContract[]> {
  const url = `${CONFIG.scrape.polymarket.gammaApi}&limit=${limit}`;

  const data = await conditionalFetchJson<GammaMarket[]>(url);
  if (data === null) {
    // 304 Not Modified — no new data since last fetch.
    console.log('[TrendCast] Polymarket: unchanged (304), skipping');
    return [];
  }

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

    // polymarket.com/event/<slug> expects the EVENT slug, not the market
    // slug. For multi-market events (e.g. elections with per-party sub-
    // markets) the market slug 404s. Prefer the nested event slug; fall
    // back to the market slug for standalone markets.
    const eventSlug = raw.events?.[0]?.slug ?? raw.slug;

    return {
      id: raw.id,
      platform: 'polymarket',
      question: raw.question,
      outcomes,
      endDate: raw.endDate,
      volume24h: raw.volume ? parseFloat(raw.volume) : undefined,
      liquidity: raw.liquidity ? parseFloat(raw.liquidity) : undefined,
      slug: eventSlug,
      url: `https://polymarket.com/event/${eventSlug}`,
      keywords: extractKeywords(raw.question),
      lastUpdated: Date.now(),
    };
  } catch {
    return null;
  }
}