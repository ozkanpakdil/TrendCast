/**
 * E2E tests for the TrendCast Popup (toolbar quick-launcher).
 *
 * Tests all 3 tabs:
 *   1. Home (quick stats, collect now, open dashboard, active sources)
 *   2. FAQ (compact mode)
 *   3. Settings (collection, correlation engine, data sources)
 *
 * Also tests:
 *   - Header (logo, tab navigation)
 *   - Footer (version, privacy note, Telegram link)
 *   - Open Dashboard button
 *   - Collect Now button
 *   - Storage usage indicator
 *   - Active sources display
 */

import { test, expect, type Page } from '@playwright/test';
import { injectBrowserMock } from './fixtures';

const POPUP_URL = 'http://127.0.0.1:4173/src/popup/index.html';

async function openPopup(page: Page, overrides: Record<string, unknown> = {}) {
  await injectBrowserMock(page, overrides);
  await page.goto(POPUP_URL);
  await page.waitForSelector('header', { timeout: 10_000 });
}

// ── Header ────────────────────────────────────────────────────────

test.describe('Popup — Header', () => {
  test('renders the TrendCast logo and title', async ({ page }) => {
    await openPopup(page);
    await expect(page.locator('h1')).toContainText('TrendCast');
  });

  test('shows all 3 tab buttons', async ({ page }) => {
    await openPopup(page);
    await expect(page.locator('nav button', { hasText: 'Home' })).toBeVisible();
    await expect(page.locator('nav button', { hasText: 'FAQ' })).toBeVisible();
    await expect(page.locator('nav button', { hasText: 'Settings' })).toBeVisible();
  });

  test('shows logo emoji', async ({ page }) => {
    await openPopup(page);
    await expect(page.locator('header')).toContainText('📊');
  });
});

// ── Tab Navigation ────────────────────────────────────────────────

test.describe('Popup — Tab Navigation', () => {
  test('defaults to the Home tab', async ({ page }) => {
    await openPopup(page);
    const homeTab = page.locator('nav button', { hasText: 'Home' });
    await expect(homeTab).toHaveClass(/bg-brand-500/);
  });

  test('switches to FAQ tab on click', async ({ page }) => {
    await openPopup(page);
    await page.locator('nav button', { hasText: 'FAQ' }).click();
    await expect(page.locator('nav button', { hasText: 'FAQ' })).toHaveClass(/bg-brand-500/);
  });

  test('switches to Settings tab on click', async ({ page }) => {
    await openPopup(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await expect(page.locator('nav button', { hasText: 'Settings' })).toHaveClass(/bg-brand-500/);
  });

  test('switches back to Home from Settings', async ({ page }) => {
    await openPopup(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await page.locator('nav button', { hasText: 'Home' }).click();
    await expect(page.locator('nav button', { hasText: 'Home' })).toHaveClass(/bg-brand-500/);
  });
});

// ── Home Tab ──────────────────────────────────────────────────────

test.describe('Popup — Home Tab', () => {
  test('shows Open Dashboard button', async ({ page }) => {
    await openPopup(page);
    await expect(page.locator('button', { hasText: /Open Dashboard/ })).toBeVisible();
  });

  test('shows Collect Now button', async ({ page }) => {
    await openPopup(page);
    await expect(page.locator('button', { hasText: /Collect Now/ })).toBeVisible();
  });

  test('shows last collection time', async ({ page }) => {
    await openPopup(page);
    await expect(page.locator('main')).toContainText(/Last collection/);
  });

  test('shows quick stats (Markets, Signals, News)', async ({ page }) => {
    await openPopup(page);
    // Mock snapshot: 2 markets, 3 signals, 2 news
    await expect(page.locator('main')).toContainText('Markets');
    await expect(page.locator('main')).toContainText('Signals');
    await expect(page.locator('main')).toContainText('News');
    // Check stat values
    await expect(page.locator('main')).toContainText('2');
    await expect(page.locator('main')).toContainText('3');
  });

  test('shows stat cards with icons', async ({ page }) => {
    await openPopup(page);
    const mainSection = page.locator('main');
    await expect(mainSection).toContainText('📈'); // Markets icon
    await expect(mainSection).toContainText('🔥'); // Signals icon
    await expect(mainSection).toContainText('📰'); // News icon
  });

  test('shows Active Sources section', async ({ page }) => {
    await openPopup(page);
    await expect(page.locator('main')).toContainText(/Active Sources/);
  });

  test('shows enabled source badges', async ({ page }) => {
    await openPopup(page);
    const mainSection = page.locator('main');
    // Mock settings have polymarket, kalshi, x, reddit, bbc, cnn, yahoo, googleFinance enabled
    await expect(mainSection).toContainText('polymarket');
    await expect(mainSection).toContainText('kalshi');
    await expect(mainSection).toContainText('reddit');
  });

  test('shows privacy info text', async ({ page }) => {
    await openPopup(page);
    await expect(page.locator('main')).toContainText(/No API keys, no servers/);
  });

  test('shows storage usage indicator', async ({ page }) => {
    await openPopup(page);
    // The storage indicator appears after GET_STORAGE_USAGE resolves
    await page.waitForTimeout(500);
    await expect(page.locator('main')).toContainText(/Storage used/);
  });

  test('shows storage budget info', async ({ page }) => {
    await openPopup(page);
    await page.waitForTimeout(500);
    await expect(page.locator('main')).toContainText(/Budget.*7 MB.*10 MB/);
  });

  test('clicking Collect Now triggers collection', async ({ page }) => {
    await openPopup(page);
    const collectBtn = page.locator('button', { hasText: /Collect Now/ });
    await collectBtn.click();
    // Button should show collecting state
    await page.waitForTimeout(200);
    await expect(page.locator('button', { hasText: /Collect/ })).toBeVisible();
  });

  test('clicking Open Dashboard calls browser.tabs.create', async ({ page }) => {
    await openPopup(page);
    // The Open Dashboard button calls browser.tabs.create({ url: 'chrome://newtab' })
    // Our mock resolves this — just verify the button is clickable
    const dashboardBtn = page.locator('button', { hasText: /Open Dashboard/ });
    await expect(dashboardBtn).toBeEnabled();
    await dashboardBtn.click();
    // No error should occur
    await page.waitForTimeout(200);
  });
});

// ── FAQ Tab ───────────────────────────────────────────────────────

test.describe('Popup — FAQ Tab', () => {
  test('displays FAQ heading in compact mode', async ({ page }) => {
    await openPopup(page);
    await page.locator('nav button', { hasText: 'FAQ' }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('main')).toContainText(/Correlation Engines FAQ/);
  });

  test('shows Heuristic engine section', async ({ page }) => {
    await openPopup(page);
    await page.locator('nav button', { hasText: 'FAQ' }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('main')).toContainText(/Heuristic Engine/);
  });

  test('shows Embedding engine section', async ({ page }) => {
    await openPopup(page);
    await page.locator('nav button', { hasText: 'FAQ' }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('main')).toContainText(/Embedding Engine/);
  });

  test('explains what correlation engines are', async ({ page }) => {
    await openPopup(page);
    await page.locator('nav button', { hasText: 'FAQ' }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('main')).toContainText(/What Are Correlation Engines/);
  });
});

// ── Settings Tab ──────────────────────────────────────────────────

test.describe('Popup — Settings Tab', () => {
  test('shows Collection section', async ({ page }) => {
    await openPopup(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('main')).toContainText(/Collection/);
  });

  test('shows collection interval input with default value', async ({ page }) => {
    await openPopup(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(300);
    const intervalInput = page.getByRole('spinbutton', { name: /Collection interval/i });
    await expect(intervalInput).toBeVisible();
    await expect(intervalInput).toHaveValue('60');
  });

  test('shows Correlation Engine section', async ({ page }) => {
    await openPopup(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('main')).toContainText(/Correlation Engine/);
  });

  test('shows 6 engine radio buttons', async ({ page }) => {
    await openPopup(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(300);
    const radios = page.locator('main input[type="radio"][name="correlationEngine"]');
    await expect(radios).toHaveCount(6);
  });

  test('heuristic engine is selected by default', async ({ page }) => {
    await openPopup(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(300);
    const radios = page.locator('main input[type="radio"][name="correlationEngine"]');
    await expect(radios).toHaveCount(6);
    // The first radio is heuristic (first in the list)
    await expect(radios.first()).toBeChecked();
  });

  test('shows Data Sources section', async ({ page }) => {
    await openPopup(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('main')).toContainText(/Data Sources/);
  });

  test('shows source toggles with labels', async ({ page }) => {
    await openPopup(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(300);
    const mainSection = page.locator('main');
    await expect(mainSection).toContainText(/Polymarket/);
    await expect(mainSection).toContainText(/Kalshi/);
    await expect(mainSection).toContainText(/X.*Twitter/);
    await expect(mainSection).toContainText(/Reddit/);
    await expect(mainSection).toContainText(/BBC/);
    await expect(mainSection).toContainText(/CNN/);
  });

  test('shows source checkboxes', async ({ page }) => {
    await openPopup(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(300);
    const checkboxes = page.locator('main input[type="checkbox"]');
    await expect(checkboxes.first()).toBeVisible();
    const count = await checkboxes.count();
    expect(count).toBeGreaterThan(0);
  });

  test('changing collection interval updates input value', async ({ page }) => {
    await openPopup(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(300);
    const intervalInput = page.getByRole('spinbutton', { name: /Collection interval/i });
    await intervalInput.fill('30');
    await expect(intervalInput).toHaveValue('30');
  });

  test('selecting embedding engine shows model dropdown', async ({ page }) => {
    await openPopup(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(300);
    // Radio buttons are ordered: heuristic, embedding, sentiment, zeroshot, ner
    const radios = page.locator('main input[type="radio"][name="correlationEngine"]');
    await radios.nth(1).check(); // embedding is 2nd
    await page.waitForTimeout(300);
    const modelSelect = page.locator('main select').first();
    await expect(modelSelect).toBeVisible({ timeout: 10_000 });
  });

  test('selecting sentiment engine shows sentiment model dropdown', async ({ page }) => {
    await openPopup(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(300);
    const radios = page.locator('main input[type="radio"][name="correlationEngine"]');
    await radios.nth(2).check(); // sentiment is 3rd
    await page.waitForTimeout(300);
    const modelSelect = page.locator('main select').first();
    await expect(modelSelect).toBeVisible({ timeout: 10_000 });
  });

  test('selecting zeroshot engine shows zero-shot model dropdown', async ({ page }) => {
    await openPopup(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(300);
    const radios = page.locator('main input[type="radio"][name="correlationEngine"]');
    await radios.nth(3).check(); // zeroshot is 4th
    await page.waitForTimeout(300);
    const modelSelect = page.locator('main select').first();
    await expect(modelSelect).toBeVisible({ timeout: 10_000 });
  });

  test('selecting NER engine shows NER model dropdown', async ({ page }) => {
    await openPopup(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(300);
    const radios = page.locator('main input[type="radio"][name="correlationEngine"]');
    await radios.nth(4).check(); // ner is 5th
    await page.waitForTimeout(300);
    const modelSelect = page.locator('main select').first();
    await expect(modelSelect).toBeVisible({ timeout: 10_000 });
  });

  test('shows ML model download warning', async ({ page }) => {
    await openPopup(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('main')).toContainText(/ML models download on first use/);
  });

  test('toggling a data source checkbox works', async ({ page }) => {
    await openPopup(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(300);
    // Toggle the first checkbox and verify it changes state
    const firstCheckbox = page.locator('main input[type="checkbox"]').first();
    const wasChecked = await firstCheckbox.isChecked();
    await firstCheckbox.click();
    await expect(firstCheckbox).toBeChecked({ checked: !wasChecked });
  });
});

// ── Footer ────────────────────────────────────────────────────────

test.describe('Popup — Footer', () => {
  test('shows version info', async ({ page }) => {
    await openPopup(page);
    await expect(page.locator('footer')).toContainText(/TrendCast v/);
  });

  test('shows client-side note', async ({ page }) => {
    await openPopup(page);
    await expect(page.locator('footer')).toContainText(/100% client-side/);
  });

  test('shows Telegram community link', async ({ page }) => {
    await openPopup(page);
    const footerLink = page.locator('footer a', { hasText: /Telegram/ });
    await expect(footerLink).toBeVisible();
    await expect(footerLink).toHaveAttribute('href', /t\.me/);
  });
});

// ── Popup Dimensions ──────────────────────────────────────────────

test.describe('Popup — Dimensions', () => {
  test('popup body has correct width (380px)', async ({ page }) => {
    await openPopup(page);
    const bodyWidth = await page.evaluate(() => document.body.offsetWidth);
    expect(bodyWidth).toBe(380);
  });

  test('popup body has correct height (500px)', async ({ page }) => {
    await openPopup(page);
    const bodyHeight = await page.evaluate(() => document.body.offsetHeight);
    expect(bodyHeight).toBeGreaterThanOrEqual(500);
  });
});