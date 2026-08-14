/**
 * Content script for social platforms (X, Reddit, TikTok).
 *
 * Responsibility:
 *   Scrape trending posts/keywords from the current page and report them
 *   to the background worker via REPORT_SOCIAL_DATA. The background stores
 *   them in chrome.storage.local for the dashboard to display.
 *
 *   Also injects an odds overlay showing correlated prediction market odds
 *   when matches are found.
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
import type { CorrelationMatch, SocialSignal, SocialPlatform } from '@/types';
import { extractKeywords } from '@/utils/keywords';
import { CONFIG } from '@/config';

/** Detect which social platform we're on. */
function detectPlatform(): SocialPlatform | null {
  const host = window.location.hostname;
  if (host.includes('x.com') || host.includes('twitter.com')) return 'x';
  if (host.includes('reddit.com')) return 'reddit';
  if (host.includes('tiktok.com')) return 'tiktok';
  return null;
}

/** Scrape social signals from the current page (platform-specific). */
function scrapeSignals(): SocialSignal[] {
  const platform = detectPlatform();
  if (!platform) return [];

  switch (platform) {
    case 'x':
      return scrapeXSignals();
    case 'reddit':
      return scrapeRedditSignals();
    case 'tiktok':
      return scrapeTiktokSignals();
  }
}

/** Scrape tweets from X. */
function scrapeXSignals(): SocialSignal[] {
  const signals: SocialSignal[] = [];
  const tweets = document.querySelectorAll('article[data-testid="tweet"]');

  tweets.forEach((tweet, i) => {
    const textEl = tweet.querySelector('[data-testid="tweetText"]');
    const text = textEl?.textContent?.trim() ?? '';
    if (!text) return;

    // Extract engagement metrics from the tweet's action buttons.
    const replyBtn = tweet.querySelector('[data-testid="reply"]');
    const retweetBtn = tweet.querySelector('[data-testid="retweet"]');
    const likeBtn = tweet.querySelector('[data-testid="like"]');
    const viewsEl = tweet.querySelector('a[href*="/analytics"]');

    const likes = parseMetric(likeBtn?.textContent ?? '0');
    const shares = parseMetric(retweetBtn?.textContent ?? '0');
    const comments = parseMetric(replyBtn?.textContent ?? '0');
    const views = parseMetric(viewsEl?.textContent ?? '0');

    const engagement = likes + shares + comments;
    const virality = Math.min(100, Math.log10(engagement + 1) * 25);

    signals.push({
      id: `x:${Date.now()}-${i}`,
      platform: 'x',
      text,
      author: 'x-user',
      metrics: { likes, shares, comments, views: views || undefined },
      timestamp: new Date().toISOString(),
      keywords: extractKeywords(text),
      sentiment: 0, // X sentiment requires NLP — neutral default for now
      virality,
    });
  });

  return signals;
}

/** Scrape posts from Reddit. */
function scrapeRedditSignals(): SocialSignal[] {
  const signals: SocialSignal[] = [];
  const posts = document.querySelectorAll('[data-testid="post-container"], shreddit-post, article');

  posts.forEach((post, i) => {
    const titleEl = post.querySelector('h3, [data-testid="post-title"], a[slot="title"]');
    const title = titleEl?.textContent?.trim() ?? '';
    if (!title) return;

    // Try to extract upvotes and comments.
    const voteEl = post.querySelector('[data-testid="post-upvote-count"], shreddit-post [score]');
    const commentEl = post.querySelector('[data-testid="post-comment-count"]');
    const ups = parseMetric(voteEl?.textContent ?? '0');
    const comments = parseMetric(commentEl?.textContent ?? '0');

    const engagement = ups + comments;
    const virality = Math.min(100, Math.log10(engagement + 1) * 25);

    signals.push({
      id: `reddit:${Date.now()}-${i}`,
      platform: 'reddit',
      text: title,
      author: 'r/unknown',
      metrics: { likes: ups, shares: 0, comments },
      timestamp: new Date().toISOString(),
      keywords: extractKeywords(title),
      sentiment: 0,
      virality,
    });
  });

  return signals;
}

/** Scrape trending topics from TikTok. */
function scrapeTiktokSignals(): SocialSignal[] {
  const signals: SocialSignal[] = [];
  const trendEls = document.querySelectorAll('[data-e2e="trend-desc"], [class*="trend-title"]');

  trendEls.forEach((el, i) => {
    const text = el.textContent?.trim() ?? '';
    if (!text) return;

    signals.push({
      id: `tiktok:${Date.now()}-${i}`,
      platform: 'tiktok',
      text,
      author: 'tiktok-trend',
      metrics: { likes: 0, shares: 0, comments: 0 },
      timestamp: new Date().toISOString(),
      keywords: extractKeywords(text),
      sentiment: 0,
      virality: 50, // Default — TikTok metrics are hard to scrape reliably
    });
  });

  return signals;
}

/** Parse a metric string like "1.2K" or "3.4M" into a number. */
function parseMetric(text: string): number {
  const cleaned = text.trim().replace(/,/g, '');
  const match = cleaned.match(/([\d.]+)\s*([KM])?/i);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const suffix = match[2]?.toUpperCase();
  if (suffix === 'K') return Math.round(num * 1000);
  if (suffix === 'M') return Math.round(num * 1_000_000);
  return Math.round(num);
}

/** Inject the odds overlay into the page. */
function injectOverlay(matches: CorrelationMatch[]): void {
  const existing = document.getElementById(CONFIG.overlay.containerId);
  if (existing) existing.remove();

  if (matches.length === 0) return;

  const container = document.createElement('div');
  container.id = CONFIG.overlay.containerId;
  container.className = 'hypemarket-overlay';

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

  container.querySelector('.hypemarket-overlay__close')?.addEventListener('click', () => {
    container.remove();
  });

  document.body.appendChild(container);
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── Main logic ───────────────────────────────────────────────────

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastScanHash = '';

async function scanAndReport(): Promise<void> {
  const signals = scrapeSignals();
  if (signals.length === 0) return;

  // Avoid re-reporting the same signals.
  const hash = signals.map((s) => s.text).sort().join('|');
  if (hash === lastScanHash) return;
  lastScanHash = hash;

  console.log(`[HypeMarket] Scraped ${signals.length} signals from ${detectPlatform()}`);

  try {
    // Report signals to background for storage.
    await sendMessage('REPORT_SOCIAL_DATA', { signals });

    // Also try to correlate with cached markets for the overlay.
    // We import the correlation engine dynamically to avoid bundling it.
    const { correlate } = await import('@/services/engine/correlation');
    const { browser } = await import('@/messaging/browser');
    const { CONFIG } = await import('@/config');

    const result = await browser.storage.local.get(CONFIG.storage.collectedMarkets);
    const markets = (result[CONFIG.storage.collectedMarkets] as MarketContract[]) ?? [];

    if (markets.length > 0) {
      const matches = correlate(signals, markets);
      if (matches.length > 0) {
        injectOverlay(matches);
      }
    }
  } catch (err) {
    console.error('[HypeMarket] Scan failed:', err);
  }
}

// Need MarketContract type for the cast above.
import type { MarketContract } from '@/types';

function debouncedScan(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(scanAndReport, CONFIG.overlay.mutationDebounceMs);
}

// ── MutationObserver ─────────────────────────────────────────────
const observer = new MutationObserver(() => debouncedScan());
observer.observe(document.body, { childList: true, subtree: true });

// Initial scan.
scanAndReport();