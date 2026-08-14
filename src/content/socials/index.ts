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
import { analyzeSentiment } from '@/utils/sentiment';
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

/** Scrape tweets from X, including the explore/trending page. */
function scrapeXSignals(): SocialSignal[] {
  const signals: SocialSignal[] = [];

  // Check if we're on the explore/trending page
  const path = window.location.pathname;
  const isExplorePage = path.includes('/explore') || path.includes('/trending');

  if (isExplorePage) {
    signals.push(...scrapeXTrending());
  }

  // Always also scrape tweets on the page (explore pages have tweets too)
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

    const sentimentResult = analyzeSentiment(text);

    signals.push({
      id: `x:${Date.now()}-${i}`,
      platform: 'x',
      text,
      author: 'x-user',
      metrics: { likes, shares, comments, views: views || undefined },
      timestamp: new Date().toISOString(),
      keywords: extractKeywords(text),
      sentiment: sentimentResult.score,
      virality,
    });
  });

  return signals;
}

/**
 * Scrape trending topics from X's explore/trending page.
 * X shows trending topics in a sidebar or tabbed list with:
 *   - Topic name
 *   - Tweet count (e.g., "1,234 Tweets")
 *   - Sometimes a category/description
 *
 * Selectors are fragile — X changes their DOM frequently. We try
 * multiple known selector patterns for robustness.
 */
function scrapeXTrending(): SocialSignal[] {
  const signals: SocialSignal[] = [];

  // Strategy 1: Trending topic rows in the sidebar/main column.
  // X uses [data-testid="trend"] for trending items (varies by version).
  const trendSelectors = [
    '[data-testid="trend"]',
    'div[role="listitem"] a[href*="/explore/tabs/trending"]',
    'div[data-testid="trendContainer"]',
    '[data-testid="sidebarColumn"] [role="listitem"]',
  ];

  const trendEls: Element[] = [];
  for (const selector of trendSelectors) {
    const els = document.querySelectorAll(selector);
    if (els.length > 0) {
      trendEls.push(...Array.from(els));
      break;
    }
  }

  trendEls.forEach((el, i) => {
    // The trending topic name is usually in a heading or span.
    // X's structure: category (small) → topic name (bold) → tweet count.
    const nameEl = el.querySelector('span[dir="auto"]') ?? el.querySelector('span');
    const name = nameEl?.textContent?.trim() ?? '';
    if (!name) return;

    // Extract tweet count from text like "1,234 Tweets" or "12.3K Tweets"
    const allText = el.textContent ?? '';
    const tweetCountMatch = allText.match(/([\d,.]+[KM]?)\s*Tweets?/i);
    const tweetCount = tweetCountMatch ? parseMetric(tweetCountMatch[1]) : 0;

    // Skip if it's just a category label (short, no tweet count)
    if (name.length < 2) return;

    const engagement = tweetCount;
    const virality = Math.min(100, Math.log10(engagement + 1) * 20);

    const sentimentResult = analyzeSentiment(name);

    signals.push({
      id: `x-trending:${Date.now()}-${i}`,
      platform: 'x',
      text: `Trending: ${name}`,
      author: 'x-trending',
      metrics: { likes: 0, shares: 0, comments: 0, views: tweetCount || undefined },
      timestamp: new Date().toISOString(),
      keywords: extractKeywords(name),
      sentiment: sentimentResult.score,
      virality: Math.max(virality, 60), // Trending topics get a baseline virality
    });
  });

  // Strategy 2: If no structured trends found, try generic links to trending topics
  if (signals.length === 0) {
    const trendLinks = document.querySelectorAll('a[href*="/explore/tabs/trending"]');
    trendLinks.forEach((link, i) => {
      const name = link.textContent?.trim() ?? '';
      if (name.length < 2 || name.length > 200) return;
      const sentimentResult = analyzeSentiment(name);
      signals.push({
        id: `x-trending-link:${Date.now()}-${i}`,
        platform: 'x',
        text: `Trending: ${name}`,
        author: 'x-trending',
        metrics: { likes: 0, shares: 0, comments: 0 },
        timestamp: new Date().toISOString(),
        keywords: extractKeywords(name),
        sentiment: sentimentResult.score,
        virality: 65,
      });
    });
  }

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

    // Use lexicon-based sentiment analysis instead of neutral default
    const sentimentResult = analyzeSentiment(title);

    signals.push({
      id: `reddit:${Date.now()}-${i}`,
      platform: 'reddit',
      text: title,
      author: 'r/unknown',
      metrics: { likes: ups, shares: 0, comments },
      timestamp: new Date().toISOString(),
      keywords: extractKeywords(title),
      sentiment: sentimentResult.score,
      virality,
    });
  });

  return signals;
}

/**
 * Scrape trending topics from TikTok, including the discover page.
 *
 * TikTok's discover page shows trending hashtags, sounds, and creators
 * with view counts and video counts. The DOM structure varies but
 * typically uses cards with trend descriptions and metrics.
 */
function scrapeTiktokSignals(): SocialSignal[] {
  const signals: SocialSignal[] = [];

  const path = window.location.pathname;
  const isDiscoverPage = path.includes('/discover') || path.includes('/explore');

  // Strategy 1: TikTok discover page trend cards
  // TikTok uses various selectors for trend cards — we try multiple patterns.
  const trendSelectors = [
    '[data-e2e="trend-desc"]',
    '[data-e2e="discover-item"]',
    'div[class*="TrendContainer"]',
    'div[class*="trend-card"]',
    'a[href*="/tag/"]',
    'a[href*="/trending"]',
  ];

  const trendEls: Element[] = [];
  for (const selector of trendSelectors) {
    const els = document.querySelectorAll(selector);
    if (els.length > 0) {
      trendEls.push(...Array.from(els));
      break;
    }
  }

  trendEls.forEach((el, i) => {
    // Trend title/name
    const titleEl = el.querySelector('[data-e2e="trend-title"], [class*="title"], h2, h3, span');
    const title = titleEl?.textContent?.trim() ?? el.textContent?.trim() ?? '';
    if (!title || title.length < 2) return;

    // Extract view/video count from text like "1.2B views" or "5.6M videos"
    const allText = el.textContent ?? '';
    const viewsMatch = allText.match(/([\d,.]+[KMB]?)\s*views?/i);
    const videosMatch = allText.match(/([\d,.]+[KMB]?)\s*videos?/i);
    const views = viewsMatch ? parseMetric(viewsMatch[1]) : 0;
    const videos = videosMatch ? parseMetric(videosMatch[1]) : 0;

    const engagement = views + videos;
    const virality = Math.min(100, Math.log10(engagement + 1) * 18);

    const sentimentResult = analyzeSentiment(title);

    signals.push({
      id: `tiktok:${Date.now()}-${i}`,
      platform: 'tiktok',
      text: title,
      author: 'tiktok-trend',
      metrics: { likes: 0, shares: 0, comments: 0, views: views || undefined },
      timestamp: new Date().toISOString(),
      keywords: extractKeywords(title),
      sentiment: sentimentResult.score,
      virality: Math.max(virality, isDiscoverPage ? 55 : 40),
    });
  });

  // Strategy 2: Hashtag links on discover page
  if (signals.length === 0 && isDiscoverPage) {
    const hashtagLinks = document.querySelectorAll('a[href*="/tag/"]');
    hashtagLinks.forEach((link, i) => {
      const title = link.textContent?.trim() ?? '';
      if (title.length < 2) return;

      // Try to find view count near the link
      const parent = link.closest('div');
      const parentText = parent?.textContent ?? '';
      const viewsMatch = parentText.match(/([\d,.]+[KMB]?)\s*views?/i);
      const views = viewsMatch ? parseMetric(viewsMatch[1]) : 0;

      const sentimentResult = analyzeSentiment(title);

      signals.push({
        id: `tiktok-tag:${Date.now()}-${i}`,
        platform: 'tiktok',
        text: `#${title}`,
        author: 'tiktok-trend',
        metrics: { likes: 0, shares: 0, comments: 0, views: views || undefined },
        timestamp: new Date().toISOString(),
        keywords: extractKeywords(title),
        sentiment: sentimentResult.score,
        virality: Math.max(Math.min(100, Math.log10(views + 1) * 18), 50),
      });
    });
  }

  // Strategy 3: Video descriptions on any TikTok page
  const videoDescEls = document.querySelectorAll('[data-e2e="video-desc"], [class*="video-desc"]');
  videoDescEls.forEach((el, i) => {
    const text = el.textContent?.trim() ?? '';
    if (!text || text.length < 2) return;

    const sentimentResult = analyzeSentiment(text);

    signals.push({
      id: `tiktok-video:${Date.now()}-${i}`,
      platform: 'tiktok',
      text,
      author: 'tiktok-creator',
      metrics: { likes: 0, shares: 0, comments: 0 },
      timestamp: new Date().toISOString(),
      keywords: extractKeywords(text),
      sentiment: sentimentResult.score,
      virality: 45,
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
  container.className = 'trendcast-overlay';

  const topMatches = matches.slice(0, 5);
  container.innerHTML = `
    <div class="trendcast-overlay__header">
      <span class="trendcast-overlay__logo">📊 TrendCast</span>
      <button class="trendcast-overlay__close" aria-label="Close">×</button>
    </div>
    <div class="trendcast-overlay__body">
      ${topMatches.map((m) => `
        <div class="trendcast-overlay__match" data-confidence="${(m.confidence * 100).toFixed(0)}%">
          <div class="trendcast-overlay__question">${escapeHtml(m.contract.question)}</div>
          <div class="trendcast-overlay__odds">
            ${m.contract.outcomes.map((o) => `
              <span class="trendcast-overlay__outcome trendcast-overlay__outcome--${o.label.toLowerCase()}">
                ${o.label}: ${(o.price * 100).toFixed(0)}%
              </span>
            `).join('')}
          </div>
          <div class="trendcast-overlay__meta">
            <span class="trendcast-overlay__platform">${m.contract.platform}</span>
            <span class="trendcast-overlay__confidence">${(m.confidence * 100).toFixed(0)}% match</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  container.querySelector('.trendcast-overlay__close')?.addEventListener('click', () => {
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

  console.log(`[TrendCast] Scraped ${signals.length} signals from ${detectPlatform()}`);

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
    console.error('[TrendCast] Scan failed:', err);
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