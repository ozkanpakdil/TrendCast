/**
 * Content script for news sites (BBC & CNN).
 *
 * Responsibility:
 *   Scrape headlines from the DOM when the user visits BBC or CNN.
 *   The scraped headlines are sent to the background worker via
 *   REPORT_NEWS_DATA, which stores them in chrome.storage.local.
 *
 *   This supplements the hourly background collection (which fetches RSS
 *   feeds directly). When the user is actively browsing news, we get
 *   real-time headlines from the page they're viewing.
 *
 * ⚠️ Pitfall: Content scripts run in an isolated world. They cannot access
 *    page JavaScript variables directly. We read the DOM only.
 *
 * ⚠️ Pitfall: News sites may use different DOM structures across sections.
 *    We use broad selectors to catch headlines in most layouts.
 */

import { sendMessage } from '@/messaging';
import type { NewsItem, NewsSource } from '@/types';
import { extractKeywords } from '@/utils/keywords';
import { CONFIG } from '@/config';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastScanHash = '';

/** Detect which news source we're on. */
function detectSource(): NewsSource | null {
  const host = window.location.hostname;
  if (host.includes('bbc.com') || host.includes('bbc.co.uk')) return 'bbc';
  if (host.includes('cnn.com')) return 'cnn';
  return null;
}

/** Scrape headlines from the DOM. */
function scrapeNews(): NewsItem[] {
  const source = detectSource();
  if (!source) return [];

  const items: NewsItem[] = [];

  // BBC and CNN use different DOM structures, but both have anchor tags
  // with headline text. We use broad selectors to catch most headlines.
  const headlineSelectors = [
    'h1 a', 'h2 a', 'h3 a',
    '[class*="headline"] a',
    '[class*="title"] a',
    '[data-testid*="headline"] a',
    '[class*="card"] a',
  ];

  const seenUrls = new Set<string>();

  for (const selector of headlineSelectors) {
    const els = document.querySelectorAll(selector);
    els.forEach((el) => {
      const anchor = el as HTMLAnchorElement;
      const href = anchor.href;
      const text = anchor.textContent?.trim() ?? '';

      // Skip empty, non-article links, and duplicates.
      if (!text || text.length < 10 || !href || seenUrls.has(href)) return;
      // Skip navigation/category links.
      if (text.length < 20 && !href.includes('/news/') && !href.includes('/article/')) return;

      seenUrls.add(href);

      // Try to find an image near the headline.
      const container = anchor.closest('article, [class*="card"], [class*="item"], li');
      const img = container?.querySelector('img');
      const imageUrl = img?.src ?? undefined;

      items.push({
        id: `${source}:${href}`,
        source,
        headline: text,
        url: href,
        publishedAt: new Date().toISOString(),
        keywords: extractKeywords(text),
        imageUrl: imageUrl ?? undefined,
      });
    });

    // Stop after collecting enough headlines.
    if (items.length >= 30) break;
  }

  return items;
}

/** Scan the page and report news to the background. */
async function scanAndReport(): Promise<void> {
  const news = scrapeNews();
  if (news.length === 0) return;

  // Avoid re-reporting the same headlines.
  const hash = news.map((n) => n.url).sort().join('|');
  if (hash === lastScanHash) return;
  lastScanHash = hash;

  console.log(`[TrendCast] Scraped ${news.length} headlines from ${detectSource()}`);

  try {
    await sendMessage('REPORT_NEWS_DATA', { news });
  } catch (err) {
    console.error('[TrendCast] Failed to report news:', err);
  }
}

function debouncedScan(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(scanAndReport, CONFIG.overlay.mutationDebounceMs);
}

// ── MutationObserver for dynamic content loading ─────────────────
const observer = new MutationObserver(() => debouncedScan());
observer.observe(document.body, { childList: true, subtree: true });

// Initial scan after a short delay for page to render.
setTimeout(scanAndReport, 2000);