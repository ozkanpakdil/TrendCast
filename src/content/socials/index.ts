/**
 * Content script for social platforms (TikTok).
 *
 * Responsibility:
 *   Scrape trending topics from the TikTok discover page DOM when the user
 *   visits tiktok.com. The scraped trends are normalized to SocialSignal and
 *   sent to the background worker via REPORT_SOCIAL_DATA, which stores them
 *   in chrome.storage.local.
 *
 *   TikTok has no free public API for trends/discover content, so DOM
 *   scraping is the only viable approach. This is inherently best-effort:
 *   TikTok's discover page is a heavily-obfuscated SPA, so we use broad
 *   defensive selectors and gracefully return [] when nothing matches.
 *
 *   X and Reddit are NOT scraped here (D-01) — they already have background
 *   collectors (collectRedditSignals / collectXTrends). On those hosts this
 *   script no-ops.
 *
 * ⚠️ Pitfall: Content scripts run in an isolated world. They cannot access
 *    page JavaScript variables directly. We read the DOM only.
 *
 * ⚠️ Pitfall: TikTok DOM changes frequently. Broad selectors + graceful []
 *    ensure a DOM change never breaks the host page or the collection
 *    pipeline. The report is wrapped in a 5s Promise.race timeout (D-04) so
 *    a hung background never throws uncaught.
 */

import { sendMessage } from '@/messaging';
import type { SocialPlatform, SocialSignal, SourceHealthEntry } from '@/types';
import { normaliseTikTokTrend, type RawTikTokTrend } from '@/utils/tiktok';
import { CONFIG } from '@/config';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastScanHash = '';
let consecutiveFailures = 0;

/** Hard timeout for the background report (D-04). */
const REPORT_TIMEOUT_MS = 5000;

/** Max trends to scrape per scan. */
const MAX_TRENDS = 30;

/**
 * Detect which social platform we're on.
 * Returns 'tiktok' on tiktok.com; null otherwise (X/Reddit no-op per D-01).
 */
export function detectPlatform(): SocialPlatform | null {
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname;
  if (host.includes('tiktok.com')) return 'tiktok';
  return null;
}

/**
 * Scrape TikTok discover-page trend titles from the DOM.
 * Uses broad defensive selectors; dedups by title; caps at MAX_TRENDS.
 * Returns [] when nothing matches (graceful degradation on DOM change).
 */
export function scrapeTikTok(): RawTikTokTrend[] {
  if (typeof document === 'undefined') return [];

  const trends: RawTikTokTrend[] = [];
  const seenTitles = new Set<string>();

  // Broad defensive selectors for discover-page trend cards AND arbitrary
  // TikTok pages (video /video/, hashtag /tag/ + /challenge/, profile).
  // TikTok's DOM is a heavily-obfuscated SPA, so these are best-effort.
  const trendSelectors = [
    '[data-e2e*="trend"]',
    '[data-e2e*="challenge"]',
    '[data-e2e*="video"]',
    '[class*="trend"]',
    '[class*="card"] a',
    '[class*="title"]',
    'h1',
    'h3',
  ];

  for (const selector of trendSelectors) {
    const els = document.querySelectorAll(selector);
    els.forEach((el) => {
      const text = el.textContent?.trim() ?? '';

      // Skip empty/short titles and duplicates.
      if (text.length < 2 || seenTitles.has(text)) return;
      seenTitles.add(text);

      trends.push({ title: text, rank: trends.length });
    });

    // Stop after collecting enough trends.
    if (trends.length >= MAX_TRENDS) break;
  }

  return trends.slice(0, MAX_TRENDS);
}

/** Report TikTok health to the background (Phase 7, D-02). Never throws. */
async function reportHealth(entry: SourceHealthEntry): Promise<void> {
  try {
    await Promise.race([
      sendMessage('REPORT_SOCIAL_HEALTH', { platform: 'tiktok', entry }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('tiktok health report timeout')), REPORT_TIMEOUT_MS),
      ),
    ]);
  } catch (err) {
    console.warn('[TrendCast] TikTok health report failed (isolated):', err);
  }
}

/** Scan the page and report TikTok trends to the background. */
async function scanAndReport(): Promise<void> {
  if (detectPlatform() !== 'tiktok') return;

  const trends = scrapeTikTok();
  if (trends.length === 0) {
    // No trends scraped — record a failure so the badge shows degraded.
    consecutiveFailures += 1;
    await reportHealth({
      lastFetchedAt: Date.now(),
      itemCount: 0,
      consecutiveFailures,
    });
    return;
  }

  const signals: SocialSignal[] = trends.map(normaliseTikTokTrend);

  // Avoid re-reporting the same trends.
  const hash = signals.map((s) => s.id).sort().join('|');
  if (hash === lastScanHash) return;
  lastScanHash = hash;

  console.log(`[TrendCast] Scraped ${signals.length} TikTok trends`);

  // Wrap the report in a 5s Promise.race timeout (D-04) so a hung
  // background never throws uncaught or breaks the host page.
  try {
    await Promise.race([
      sendMessage('REPORT_SOCIAL_DATA', { signals }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('tiktok report timeout')), REPORT_TIMEOUT_MS),
      ),
    ]);
    // Success — reset failures and report healthy.
    consecutiveFailures = 0;
    await reportHealth({
      lastFetchedAt: Date.now(),
      itemCount: signals.length,
      consecutiveFailures: 0,
    });
  } catch (err) {
    console.warn('[TrendCast] TikTok report failed (isolated):', err);
    consecutiveFailures += 1;
    await reportHealth({
      lastFetchedAt: Date.now(),
      itemCount: 0,
      consecutiveFailures,
      lastError: err instanceof Error ? err.message : String(err),
    });
  }
}

function debouncedScan(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(scanAndReport, CONFIG.overlay.mutationDebounceMs);
}

// ── Bootstrap (guarded so unit-test imports don't auto-run) ──────
if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.body) {
  // MutationObserver for dynamic content loading (TikTok is a SPA).
  const observer = new MutationObserver(() => debouncedScan());
  observer.observe(document.body, { childList: true, subtree: true });

  // Initial scan after a short delay for page to render.
  setTimeout(scanAndReport, 2000);
}
