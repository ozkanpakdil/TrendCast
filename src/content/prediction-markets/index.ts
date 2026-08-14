/**
 * Content script for prediction market sites (Polymarket & Kalshi).
 *
 * Responsibility:
 *   Detect which contract the user is currently viewing and send the
 *   URL to the background worker, which resolves it to a `MarketContract`
 *   via the platform's API. The result is cached for the popup to display.
 *
 * ⚠️ Pitfall: Content scripts run in an isolated world. They cannot access
 *    page JavaScript variables directly. We read the DOM and the URL only.
 *
 * ⚠️ Pitfall: SPAs (Polymarket, Kalshi) change routes without a page reload.
 *    We use a `MutationObserver` + URL polling to detect route changes and
 *    re-send the contract context. The observer is debounced to avoid
 *    thrashing on rapid DOM updates.
 */

import { sendMessage } from '@/messaging';
import type { MarketContract } from '@/types';
import { CONFIG } from '@/config';

let lastUrl = '';
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Check if the URL changed and re-resolve the contract. */
async function checkUrlChange(): Promise<void> {
  const currentUrl = window.location.href;
  if (currentUrl === lastUrl) return;

  lastUrl = currentUrl;

  // Only process if we're on a market/event page.
  const isMarketPage =
    currentUrl.includes('/event/') || currentUrl.includes('/markets/');
  if (!isMarketPage) return;

  console.log('[HypeMarket] Detected market page:', currentUrl);

  try {
    const result = await sendMessage('GET_CONTRACT_CONTEXT', { url: currentUrl });
    const response = result as { ok: boolean; data: MarketContract | null };
    if (response?.ok && response.data) {
      console.log('[HypeMarket] Resolved contract:', response.data.question);
      // The contract is now cached in the background worker's storage.
      // The popup will read it from there.
    }
  } catch (err) {
    console.error('[HypeMarket] Failed to resolve contract:', err);
  }
}

/** Debounced URL change handler. */
function debouncedCheck(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(checkUrlChange, CONFIG.overlay.mutationDebounceMs);
}

// ── MutationObserver for SPA route changes ───────────────────────
// Polymarket and Kalshi are React SPAs — route changes don't trigger
// a page reload, so `popstate` alone isn't enough. We observe the body
// for child list changes and debounce the URL check.

const observer = new MutationObserver(() => {
  // Only react to URL changes, not every DOM mutation.
  if (window.location.href !== lastUrl) {
    debouncedCheck();
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

// Also listen for popstate (back/forward navigation).
window.addEventListener('popstate', debouncedCheck);

// Initial check on script load.
checkUrlChange();