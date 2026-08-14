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

/** Raw Kalshi market shape (subset of the trade-api/v2 response). */
interface KalshiMarket {
  ticker: string;
  event_ticker?: string;
  yes_sub_title?: string;
  no_sub_title?: string;
  rules_primary?: string;
  // Prices are dollar strings (e.g. "0.5600") in the 0–1 range.
  last_price_dollars?: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  no_bid_dollars?: string;
  no_ask_dollars?: string;
  // Volume / interest as fixed-point strings.
  volume_fp?: string;
  volume_24h_fp?: string;
  open_interest_fp?: string;
  // Date fields (ISO strings).
  close_time?: string;
  expiration_time?: string;
  status?: string;
}

/** Raw Kalshi event shape (from /events?with_nested_markets=true). */
interface KalshiEvent {
  event_ticker: string;
  series_ticker: string;
  title: string;
  sub_title?: string;
  category?: string;
  markets: KalshiMarket[];
}

/**
 * Fetch active Kalshi markets from the public API.
 * Uses the /events endpoint with nested markets — this returns real
 * markets with actual prices and volume, unlike the /markets endpoint
 * which returns dead quarter-by-quarter sports spreads.
 * Uses cursor-based pagination to fetch up to `limit` markets.
 */
export async function collectKalshiMarkets(limit = 100): Promise<MarketContract[]> {
  const results: MarketContract[] = [];
  let cursor: string | undefined;
  const pageSize = Math.min(limit, 100);
  let remaining = limit;

  while (remaining > 0) {
    const url = new URL(CONFIG.scrape.kalshi.api);
    url.searchParams.set('limit', String(Math.min(remaining, pageSize)));
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Kalshi API error: ${response.status} ${response.statusText}`);
    }

    const data: { events: KalshiEvent[]; cursor?: string } = await response.json();

    // Flatten events → markets, normalise each market.
    const normalised = data.events
      .flatMap((event) => {
        return event.markets.map((market) => normaliseKalshiMarket(market, event));
      })
      .filter((m): m is MarketContract => m !== null);

    results.push(...normalised);
    remaining -= data.events.length;

    if (!data.cursor || data.events.length === 0) break;
    cursor = data.cursor;
  }

  console.log(`[TrendCast] Kalshi: ${results.length} items collected`);
  return results;
}

/** Convert a Kalshi market into our normalised `MarketContract`. */
function normaliseKalshiMarket(raw: KalshiMarket, event?: KalshiEvent): MarketContract | null {
  try {
    // Prices are dollar strings in the 0–1 range (e.g. "0.5600").
    const parsePrice = (val: string | undefined): number | undefined => {
      if (val == null || val === '') return undefined;
      const n = parseFloat(val);
      return isNaN(n) ? undefined : n;
    };

    // Use last_price if available, otherwise fall back to yes_ask.
    const yesPrice = parsePrice(raw.last_price_dollars) ?? parsePrice(raw.yes_ask_dollars);

    const outcomes: MarketOutcome[] = [];
    if (yesPrice != null) {
      outcomes.push({ label: 'Yes', price: yesPrice });
      outcomes.push({ label: 'No', price: 1 - yesPrice });
    }

    if (outcomes.length === 0) return null;

    // Build a human-readable question.
    // Prefer the event title + yes_sub_title for context (e.g. "Next NATO Sec Gen — Klaus Iohannis").
    // Fall back to rules_primary, then just the sub_title.
    const eventTitle = event?.title;
    const subTitle = raw.yes_sub_title ?? raw.rules_primary ?? raw.ticker;
    const fullTitle = eventTitle && raw.yes_sub_title
      ? `${eventTitle} — ${raw.yes_sub_title}`
      : subTitle;

    // Build the Kalshi market URL.
    // Kalshi uses /markets/{series_ticker}/{event_ticker} (all lowercase) which
    // redirects to the full /markets/{series_ticker}/{slug}/{event_ticker} URL.
    const seriesTicker = event?.series_ticker ?? raw.event_ticker ?? raw.ticker;
    const eventTicker = raw.event_ticker ?? raw.ticker;
    const kalshiUrl = `https://kalshi.com/markets/${seriesTicker.toLowerCase()}/${eventTicker.toLowerCase()}`;

    // Use 24h volume if available, otherwise fall back to total volume.
    // Many Kalshi markets have volume_24h_fp: "0.00" but high volume_fp (total).
    const vol24h = parseFloat(raw.volume_24h_fp ?? '0') || 0;
    const volTotal = parseFloat(raw.volume_fp ?? '0') || 0;
    const volume = vol24h > 0 ? vol24h : volTotal;

    return {
      id: raw.ticker,
      platform: 'kalshi',
      question: fullTitle,
      outcomes,
      endDate: raw.close_time ?? raw.expiration_time ?? '',
      volume24h: volume,
      liquidity: parseFloat(raw.open_interest_fp ?? '0') || undefined,
      slug: raw.ticker,
      url: kalshiUrl,
      keywords: extractKeywords(fullTitle),
      lastUpdated: Date.now(),
    };
  } catch {
    return null;
  }
}