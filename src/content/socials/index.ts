/**
 * Content script for social platforms (X, Reddit, TikTok).
 *
 * Responsibility:
 *   Detect trending topics / keywords on the current page and inject
 *   an overlay showing correlated prediction market odds.
 *
 * ⚠️ Pitfall: Each social platform has a different DOM structure. We
 *    detect the platform from the hostname and use platform-specific
 *    extraction logic. This is the most fragile part of the extension
 *    — social platforms change their DOM frequently.
 *
 * ⚠️ Pitfall: X (Twitter) uses heavy virtualisation and dynamic loading.
 *    Tweet elements may not exist in the DOM until scrolled into view.
 *    We use a MutationObserver with debouncing to handle this.
 *
 * ⚠️ Pitfall: TikTok aggressively blocks content scripts in some regions.
 *    The overlay may not inject on all TikTok pages.
 */

import { sendMessage } from '@/messaging';
import type { CorrelationMatch, SocialSignal } from '@/types';
import { extractKeywords } from '@/utils/keywords';
import { CONFIG } from '@/config';

type SocialPlatform = 'x' | 'reddit' | 'tiktok';

/** Detect which social platform we're on. */
function detectPlatform(): SocialPlatform | null {
  const host = window.location.hostname;
  if (host.includes('x.com') || host.includes('twitter.com')) return 'x';
  if (host.includes('reddit.com')) return 'reddit';
  if (host.includes('tiktok.com')) return 'tiktok';
  return null;
}

/** Extract trending text/keywords from the current page (platform-specific). */
function extractPageKeywords(): string[] {
  const platform = detectPlatform();
  if (!platform) return [];

  switch (platform) {
    case 'x':
      return extractXKeywords();
    case 'reddit':
      return extractRedditKeywords();
    case 'tiktok':
      return extractTiktokKeywords();
  }
}

/** Extract keywords from visible tweets on X. */
function extractXKeywords(): string[] {
  // X tweet elements use `article` tags with `data-testid="tweet"`.
  const tweets = document.querySelectorAll('article[data-testid="tweet"]');
  const texts: string[] = [];
  tweets.forEach((tweet) => {
    const textEl = tweet.querySelector('[data-testid="tweetText"]');
    if (textEl) texts.push(textEl.textContent ?? '');
  });
  return extractKeywords(texts.join(' '));
}

/** Extract keywords from Reddit posts. */
function extractRedditKeywords(): string[] {
  // Reddit post titles use `h3` inside post elements.
  const titles = document.querySelectorAll('h3, [data-testid="post-title"]');
  const texts: string[] = [];
  titles.forEach((el) => texts.push(el.textContent ?? ''));
  return extractKeywords(texts.join(' '));
}

/** Extract keywords from TikTok discover/trending page. */
function extractTiktokKeywords(): string[] {
  // TikTok trend titles are in `div` elements with trend-related classes.
  // This is fragile — TikTok changes classes frequently.
  const trendEls = document.querySelectorAll('[data-e2e="trend-desc"], .tiktok-trend-title');
  const texts: string[] = [];
  trendEls.forEach((el) => texts.push(el.textContent ?? ''));
  // Also grab the page title as a fallback.
  texts.push(document.title);
  return extractKeywords(texts.join(' '));
}

/** Inject the odds overlay into the page. */
function injectOverlay(matches: CorrelationMatch[]): void {
  // Remove existing overlay if present.
  const existing = document.getElementById(CONFIG.overlay.containerId);
  if (existing) existing.remove();

  if (matches.length === 0) return;

  const container = document.createElement('div');
  container.id = CONFIG.overlay.containerId;
  container.className = 'hypemarket-overlay';

  // Build the overlay HTML.
  const topMatches = matches.slice(0, 5);
  container.innerHTML = `
    <div class="hypemarket-overlay__header">
      <span class="hypemarket-overlay__logo">📊 HypeMarket</span>
      <button class="hypemarket-overlay__close" aria-label="Close">×</button>
    </div>
    <div class="hypemarket-overlay__body">
      ${topMatches.map((m) => `
        <div class="hypemarket-overlay__match" data-confidence="${(m.confidence * 100).toFixed(0)}%">
          <div class="hypemarket-overlay__question">${escapeHtml(m.contract.question)}</div>
          <div class="hypemarket-overlay__odds">
            ${m.contract.outcomes.map((o) => `
              <span class="hypemarket-overlay__outcome hypemarket-overlay__outcome--${o.label.toLowerCase()}">
                ${o.label}: ${(o.price * 100).toFixed(0)}%
              </span>
            `).join('')}
          </div>
          <div class="hypemarket-overlay__meta">
            <span class="hypemarket-overlay__platform">${m.contract.platform}</span>
            <span class="hypemarket-overlay__confidence">${(m.confidence * 100).toFixed(0)}% match</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  // Close button handler.
  container.querySelector('.hypemarket-overlay__close')?.addEventListener('click', () => {
    container.remove();
  });

  document.body.appendChild(container);
}

/** Escape HTML to prevent XSS when injecting user-visible text. */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── Main logic ───────────────────────────────────────────────────

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastKeywordsHash = '';

async function scanAndCorrelate(): Promise<void> {
  const keywords = extractPageKeywords();
  if (keywords.length === 0) return;

  // Avoid re-processing the same keywords.
  const hash = keywords.sort().join(',');
  if (hash === lastKeywordsHash) return;
  lastKeywordsHash = hash;

  console.log('[HypeMarket] Extracted keywords:', keywords);

  try {
    // Fetch social signals (from background, which calls Reddit API etc.)
    const platform = detectPlatform();
    if (!platform) return;

    const signalsResult = await sendMessage('FETCH_SOCIAL_SIGNALS', {
      platform,
      keywords,
    });
    const signalsResponse = signalsResult as { ok: boolean; data: SocialSignal[] };
    const signals = signalsResponse?.data ?? [];

    // Fetch cached markets from background.
    const marketsResult = await sendMessage('FETCH_MARKETS', { platform: 'polymarket' });
    const marketsResponse = marketsResult as { ok: boolean; data: MarketContract[] };

    // Run correlation (import dynamically to avoid bundling engine in content script).
    const { correlate } = await import('@/services/engine/correlation');
    const matches = correlate(signals, marketsResponse?.data ?? []);

    if (matches.length > 0) {
      injectOverlay(matches);
    }
  } catch (err) {
    console.error('[HypeMarket] Scan failed:', err);
  }
}

// Need to import MarketContract type for the cast above.
import type { MarketContract } from '@/types';

function debouncedScan(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(scanAndCorrelate, CONFIG.overlay.mutationDebounceMs);
}

// ── MutationObserver ─────────────────────────────────────────────
const observer = new MutationObserver(() => debouncedScan());
observer.observe(document.body, { childList: true, subtree: true });

// Initial scan.
scanAndCorrelate();