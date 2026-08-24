/**
 * Playwright screenshot generator for TrendCast documentation.
 *
 * This spec is NOT a test — it produces PNG screenshots and a short
 * WebM screen-cast that are committed to `docs/assets/screenshots/`
 * and referenced from the GitHub Pages documentation site.
 *
 * Run locally:
 *   bunx playwright test --config=playwright.screenshots.config.ts
 *
 * In CI, the `docs.yml` workflow runs this spec, copies the output
 * into the Jekyll tree, and pushes to the `gh-pages` branch.
 *
 * Every screenshot is tagged with the build version (injected via
 * the mock browser API) so docs always show the correct version stamp.
 */

/* eslint-disable -- screenshot spec uses intentional fixed waits for visual settling; not part of the linted test suite */

import { test, expect, type Page } from '@playwright/test';
import { injectBrowserMock } from '../e2e/fixtures';

const BASE_URL = 'http://127.0.0.1:4173';
const DASHBOARD_URL = `${BASE_URL}/src/dashboard/index.html`;
const POPUP_URL = `${BASE_URL}/src/popup/index.html`;

// Output directory — relative to project root.
// The screenshot config sets `outputDir` to `docs/static/assets/screenshots`.
const OUT = 'docs/static/assets/screenshots';

// ── Helpers ──────────────────────────────────────────────────────

async function openDashboard(page: Page, overrides: Record<string, unknown> = {}) {
  await injectBrowserMock(page, overrides);
  await page.goto(DASHBOARD_URL);
  await page.waitForSelector('header', { timeout: 10_000 });
  // Wait for content to settle (correlations hook fires on mount)
  await page.waitForTimeout(800);
}

async function openPopup(page: Page, overrides: Record<string, unknown> = {}) {
  await injectBrowserMock(page, overrides);
  await page.goto(POPUP_URL);
  await page.waitForSelector('header', { timeout: 10_000 });
  await page.waitForTimeout(500);
}

/** Click a dashboard tab by label and wait for it to become active. */
async function gotoTab(page: Page, label: string) {
  const index = await page.locator('nav button').evaluateAll((buttons, needle) => {
    const normalize = (value: string) =>
      value
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const target = normalize(needle);
    return buttons.findIndex((button) => normalize(button.textContent ?? '') === target);
  }, label);

  if (index === -1) {
    throw new Error(`Nav tab not found: ${label}`);
  }

  const button = page.locator('nav button').nth(index);
  await button.click();
  await expect(button).toHaveClass(/border-brand-400/);
  await page.waitForTimeout(400);
}

// ── Dashboard screenshots ────────────────────────────────────────

test.describe('Dashboard screenshots', () => {
  test('dashboard — feed tab (dark)', async ({ page }) => {
    await openDashboard(page);
    await gotoTab(page, 'Hype Feed');
    await page.screenshot({ path: `${OUT}/dashboard-feed-dark.png`, fullPage: true });
  });

  test('dashboard — feed tab (light)', async ({ page }) => {
    await openDashboard(page, {
      'trendcast:settings': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(await getSettings(page)) as any,
        theme: 'light',
      },
    });
    // Toggle theme via the header button (settings override is read on mount)
    await page.locator('button[aria-label="Toggle theme"]').click();
    await page.waitForTimeout(300);
    await gotoTab(page, 'Hype Feed');
    await page.screenshot({ path: `${OUT}/dashboard-feed-light.png`, fullPage: true });
  });

  test('dashboard — markets tab', async ({ page }) => {
    await openDashboard(page);
    await gotoTab(page, 'Markets');
    await page.screenshot({ path: `${OUT}/dashboard-markets.png`, fullPage: true });
  });

  test('dashboard — news tab', async ({ page }) => {
    await openDashboard(page);
    await gotoTab(page, 'News');
    await page.screenshot({ path: `${OUT}/dashboard-news.png`, fullPage: true });
  });

  test('dashboard — correlations tab', async ({ page }) => {
    await openDashboard(page);
    await gotoTab(page, 'Correlations');
    await page.waitForTimeout(1000); // network graph animation settles
    await page.screenshot({ path: `${OUT}/dashboard-correlations.png`, fullPage: true });
  });

  test('dashboard — watchlist tab', async ({ page }) => {
    await openDashboard(page);
    await gotoTab(page, 'Watchlist');
    await page.screenshot({ path: `${OUT}/dashboard-watchlist.png`, fullPage: true });
  });

  test('dashboard — alerts tab (cross-source)', async ({ page }) => {
    // Seed alert history with cross-source consensus alerts that carry
    // source links, so the screenshot shows the Phase 10 feature end-to-end.
    const now = Date.now();
    const crossSourceAlerts = [
      {
        id: `bitcoin:${now - 3_600_000}`,
        kind: 'crossSource',
        topicLabel: 'Bitcoin',
        sourceTypes: ['bbc', 'reddit', 'x'],
        direction: 'bullish',
        sentiment: 0.72,
        yesPrice: 0,
        topSignalText: 'Bitcoin is pumping to new highs 🚀',
        topSignalUrl: 'https://x.com/crypto_whale/status/123',
        topNewsHeadline: 'Bitcoin surges past $98,000 amid renewed investor optimism',
        topNewsUrl: 'https://bbc.com/news/business-123',
        confidence: 0.9,
        alertedAt: now - 3_600_000,
      },
      {
        id: `nvidia:${now - 7_200_000}`,
        kind: 'crossSource',
        topicLabel: 'Nvidia',
        sourceTypes: ['yahoo', 'reddit', 'x'],
        direction: 'bearish',
        sentiment: -0.55,
        yesPrice: 0,
        topSignalText: 'Nvidia pulling back hard after earnings.',
        topSignalUrl: 'https://reddit.com/r/stocks/comments/nvda',
        topNewsHeadline: 'Nvidia stock slips as AI demand cools',
        topNewsUrl: 'https://finance.yahoo.com/news/nvidia-slip',
        confidence: 0.84,
        alertedAt: now - 7_200_000,
      },
    ];
    await openDashboard(page, {
      'trendcast:alert-history': crossSourceAlerts,
    });
    await gotoTab(page, 'Alerts');
    await expect(page.locator('main')).toContainText('Cross-source');
    await expect(page.locator('a', { hasText: 'Source ↗' }).first()).toBeVisible();
    await page.screenshot({ path: `${OUT}/dashboard-alerts-cross-source.png`, fullPage: true });
  });

  test('dashboard — history tab', async ({ page }) => {
    await openDashboard(page);
    await gotoTab(page, 'History');
    await page.waitForTimeout(600); // chart renders
    await page.screenshot({ path: `${OUT}/dashboard-history.png`, fullPage: true });
  });

  test('dashboard — community tab', async ({ page }) => {
    await openDashboard(page);
    await gotoTab(page, 'Community');
    await page.screenshot({ path: `${OUT}/dashboard-community.png`, fullPage: true });
  });

  test('dashboard — FAQ tab', async ({ page }) => {
    await openDashboard(page);
    await gotoTab(page, 'FAQ');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/dashboard-faq.png`, fullPage: true });
  });

  test('dashboard — settings tab', async ({ page }) => {
    await openDashboard(page);
    await gotoTab(page, 'Settings');
    await page.screenshot({ path: `${OUT}/dashboard-settings.png`, fullPage: true });
  });

  test('dashboard — header close-up', async ({ page }) => {
    await openDashboard(page);
    const header = page.locator('header').first();
    await expect(header).toBeVisible();
    await header.screenshot({ path: `${OUT}/dashboard-header.png` });
  });

  test('dashboard — empty state', async ({ page }) => {
    await openDashboard(page, {
      'trendcast:latest-snapshot': {
        collectedAt: Date.now(),
        markets: [],
        signals: [],
        news: [],
      },
    });
    await expect(page.locator('main')).toContainText(/No social signals collected yet/);
    await page.screenshot({ path: `${OUT}/dashboard-empty.png`, fullPage: true });
  });
});

// ── Popup screenshots ────────────────────────────────────────────

test.describe('Popup screenshots', () => {
  test('popup — home tab', async ({ page }) => {
    await openPopup(page);
    await expect(page.locator('button', { hasText: /Open Dashboard/ })).toBeVisible();
    await page.screenshot({ path: `${OUT}/popup-home.png` });
  });

  test('popup — FAQ tab', async ({ page }) => {
    await openPopup(page);
    await page.locator('nav button', { hasText: 'FAQ' }).click();
    await expect(page.locator('main')).toContainText(/FAQ/);
    await page.screenshot({ path: `${OUT}/popup-faq.png` });
  });

  test('popup — settings tab', async ({ page }) => {
    await openPopup(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await expect(page.locator('nav button', { hasText: 'Settings' })).toHaveClass(/bg-brand-500/);
    await page.screenshot({ path: `${OUT}/popup-settings.png` });
  });
});

// ── Odds overlay mock ────────────────────────────────────────────

test.describe('Odds overlay screenshot', () => {
  test('overlay on a social platform', async ({ page }) => {
    // Build a fake social-media page and inject the overlay HTML
    // directly. The overlay CSS lives in src/content/socials/overlay.css.
    await page.goto(`${BASE_URL}/src/dashboard/index.html`);
    await expect(page.locator('body')).toBeVisible();
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div style="background:#0b0b0f;color:#e0e0e0;min-height:100vh;font-family:system-ui;padding:24px;">
          <h1 style="font-size:20px;margin-bottom:16px;">$BTC to the moon! 🚀</h1>
          <p style="color:#888;font-size:14px;">@crypto_whale · 2h</p>
          <p style="font-size:16px;margin-top:12px;">Bitcoin hitting new highs. This is just the beginning. #crypto #btc</p>
          <div style="margin-top:24px;color:#555;font-size:13px;">❤️ 1,200 · 🔁 340 · 💬 89</div>
        </div>
      `;
      const overlay = document.createElement('div');
      overlay.className = 'trendcast-overlay';
      overlay.innerHTML = `
        <div class="trendcast-overlay__header">
          <span class="trendcast-overlay__logo">📊 TrendCast</span>
          <button class="trendcast-overlay__close">×</button>
        </div>
        <div class="trendcast-overlay__body">
          <div class="trendcast-overlay__match">
            <div style="font-size:11px;color:#888;margin-bottom:4px;">🔵 Polymarket</div>
            <div style="font-size:13px;font-weight:600;margin-bottom:6px;">Will BTC close above $100k on Dec 31?</div>
            <div style="display:flex;gap:8px;align-items:center;">
              <span style="background:#16a34a;color:#fff;padding:2px 8px;border-radius:6px;font-size:12px;font-weight:700;">Yes 65%</span>
              <span style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:6px;font-size:12px;font-weight:700;">No 35%</span>
            </div>
            <div style="font-size:10px;color:#666;margin-top:6px;">Vol $1.5M · Conf 82%</div>
          </div>
          <div class="trendcast-overlay__match">
            <div style="font-size:11px;color:#888;margin-bottom:4px;">🟢 Kalshi</div>
            <div style="font-size:13px;font-weight:600;margin-bottom:6px;">Fed rate cut Q1 2026?</div>
            <div style="display:flex;gap:8px;align-items:center;">
              <span style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:6px;font-size:12px;font-weight:700;">Yes 42%</span>
              <span style="background:#16a34a;color:#fff;padding:2px 8px;border-radius:6px;font-size:12px;font-weight:700;">No 58%</span>
            </div>
            <div style="font-size:10px;color:#666;margin-top:6px;">Vol $800K · Conf 71%</div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    });
    // Inject the overlay CSS
    const link = page.addStyleTag({
      content: `
        .trendcast-overlay { position:fixed;bottom:16px;right:16px;width:320px;max-height:400px;overflow-y:auto;background:#1a1a2e;color:#e0e0e0;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.4);font-family:'Inter',system-ui,sans-serif;font-size:13px;z-index:2147483647;border:1px solid #2a2a4e; }
        .trendcast-overlay__header { display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#16213e;border-radius:12px 12px 0 0;border-bottom:1px solid #2a2a4e; }
        .trendcast-overlay__logo { font-weight:700;font-size:14px;color:#599dff; }
        .trendcast-overlay__close { background:none;border:none;color:#888;font-size:20px;cursor:pointer;padding:0;line-height:1; }
        .trendcast-overlay__body { padding:8px; }
        .trendcast-overlay__match { padding:10px;margin-bottom:6px;background:#1e1e3a;border-radius:8px; }
      `,
    });
    await link;
    await expect(page.locator('.trendcast-overlay')).toBeVisible();
    await page.screenshot({ path: `${OUT}/overlay-social.png`, fullPage: true });
  });
});

// ── Screen-cast: tab tour ────────────────────────────────────────

test.describe('Screen-cast', () => {
  test('dashboard tab tour (video)', async ({ browser }) => {
    const context = await browser.newContext({
      recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    await openDashboard(page);

    const tabs = [
      'Hype Feed',
      'Markets',
      'News',
      'Correlations',
      'Watchlist',
      'History',
      'Community',
      'FAQ',
      'Settings',
    ];
    for (const label of tabs) {
      await gotoTab(page, label);
      await page.waitForTimeout(800);
    }
    // Return to feed
    await gotoTab(page, 'Hype Feed');
    await expect(page.locator('nav button', { hasText: 'Hype Feed' })).toHaveClass(/border-brand-400/);

    await context.close();
    // Playwright saves video as <random>.webm — the workflow renames it.
  });
});

// ── Utility: read settings from the mock store ───────────────────

async function getSettings(_page: Page): Promise<Record<string, unknown>> {
  // The mock is seeded with MOCK_SETTINGS from fixtures. We return a
  // minimal copy here — the actual values are injected by injectBrowserMock.
  return {};
}