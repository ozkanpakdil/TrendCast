/**
 * Content script for prediction market sites (Polymarket & Kalshi).
 *
 * Responsibility:
 *   Scrape market data from the DOM when the user visits Polymarket or
 *   Kalshi. The scraped data is sent to the background worker via
 *   REPORT_MARKET_DATA, which stores it in chrome.storage.local.
 *
 *   This supplements the hourly background collection (which uses public
 *   API endpoints). When the user is actively browsing, we get real-time
 *   data from the page they're viewing.
 *
 * ⚠️ Pitfall: Content scripts run in an isolated world. They cannot access
 *    page JavaScript variables directly. We read the DOM only.
 *
 * ⚠️ Pitfall: SPAs (Polymarket, Kalshi) change routes without a page reload.
 *    We use a `MutationObserver` + URL polling to detect route changes and
 *    re-scrape. The observer is debounced to avoid thrashing.
 */

import { sendMessage } from '@/messaging';
import type { MarketContract, MarketOutcome } from '@/types';
import { extractKeywords } from '@/utils/keywords';
import { CONFIG } from '@/config';

let lastUrl = '';
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Detect which platform we're on. */
function detectPlatform(): 'polymarket' | 'kalshi' | null {
  const host = window.location.hostname;
  if (host.includes('polymarket.com')) return 'polymarket';
  if (host.includes('kalshi.com')) return 'kalshi';
  return null;
}

/** Check if the URL changed and re-scrape. */
async function checkUrlChange(): Promise<void> {
  const currentUrl = window.location.href;
  if (currentUrl === lastUrl) return;
  lastUrl = currentUrl;

  const platform = detectPlatform();
  if (!platform) return;

  // Only process if we're on a market/event page.
  const isMarketPage =
    currentUrl.includes('/event/') ||
    currentUrl.includes('/markets/') ||
    currentUrl.includes('/market/');
  if (!isMarketPage) return;

  console.log('[TrendCast] Detected market page:', currentUrl);

  // Wait a moment for the SPA to render market data.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const markets = scrapeMarketsFromDom(platform);
  if (markets.length > 0) {
    try {
      await sendMessage('REPORT_MARKET_DATA', { markets });
      console.log(`[TrendCast] Reported ${markets.length} markets from DOM`);
    } catch (err) {
      console.error('[TrendCast] Failed to report market data:', err);
    }
  }
}

/** Scrape market data from the DOM (platform-specific). */
function scrapeMarketsFromDom(platform: 'polymarket' | 'kalshi'): MarketContract[] {
  return platform === 'polymarket'
    ? scrapePolymarketDom()
    : scrapeKalshiDom();
}

/** Scrape Polymarket market cards from the DOM. */
function scrapePolymarketDom(): MarketContract[] {
  const markets: MarketContract[] = [];

  // Polymarket market cards typically have question + outcome buttons.
  // This is fragile — selectors may need updating as Polymarket changes.

  // Try to find market cards with outcome prices.
  const cards = document.querySelectorAll('[class*="market-card"], [class*="event-card"], article');

  cards.forEach((card) => {
    const questionEl = card.querySelector('[class*="title"], [class*="question"], h2, h3');
    const question = questionEl?.textContent?.trim();
    if (!question) return;

    // Look for Yes/No price buttons.
    const buttons = card.querySelectorAll('button');
    const outcomes: MarketOutcome[] = [];
    buttons.forEach((btn) => {
      const text = btn.textContent?.trim() ?? '';
      const match = text.match(/(Yes|No)\s*(\d+)%/i);
      if (match) {
        outcomes.push({
          label: match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase(),
          price: parseInt(match[2], 10) / 100,
        });
      }
    });

    if (outcomes.length === 0) return;

    markets.push({
      id: `polymarket-dom:${window.location.pathname}`,
      platform: 'polymarket',
      question,
      outcomes,
      endDate: '',
      keywords: extractKeywords(question),
      lastUpdated: Date.now(),
      slug: window.location.pathname.split('/').pop() ?? undefined,
    });
  });

  return markets;
}

/** Scrape Kalshi market data from the DOM. */
function scrapeKalshiDom(): MarketContract[] {
  const markets: MarketContract[] = [];

  // Kalshi market pages show the question and Yes/No prices.
  const titleEl = document.querySelector('h1, [class*="market-title"], [class*="title"]');
  const question = titleEl?.textContent?.trim();
  if (!question) return markets;

  // Look for Yes/No price displays.
  const priceEls = document.querySelectorAll('[class*="price"], [class*="outcome"]');
  const outcomes: MarketOutcome[] = [];

  priceEls.forEach((el) => {
    const text = el.textContent?.trim() ?? '';
    const match = text.match(/(Yes|No)\s*[:\s]*(\d+)/i);
    if (match) {
      outcomes.push({
        label: match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase(),
        price: parseInt(match[2], 10) / 100,
      });
    }
  });

  if (outcomes.length === 0) return markets;

  markets.push({
    id: `kalshi-dom:${window.location.pathname}`,
    platform: 'kalshi',
    question,
    outcomes,
    endDate: '',
    keywords: extractKeywords(question),
    lastUpdated: Date.now(),
    slug: window.location.pathname.split('/').pop() ?? undefined,
  });

  return markets;
}

/** Debounced URL change handler. */
function debouncedCheck(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(checkUrlChange, CONFIG.overlay.mutationDebounceMs);
}

// ── MutationObserver for SPA route changes ───────────────────────
const observer = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    debouncedCheck();
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

window.addEventListener('popstate', debouncedCheck);

// Initial check on script load.
checkUrlChange();