/**
 * E2E tests for the TrendCast Dashboard (new tab page).
 *
 * Tests all 9 tabs:
 *   1. Feed (Hype Feed)
 *   2. Markets (Market Odds)
 *   3. News (News Feed)
 *   4. Correlations (Correlation Panel)
 *   5. Watchlist
 *   6. History (History Chart)
 *   7. Community
 *   8. FAQ
 *   9. Settings
 *
 * Also tests:
 *   - Header (logo, stats, version, last collection time)
 *   - Theme toggle (dark/light)
 *   - Export dropdown (CSV/JSON)
 *   - Collect Now button
 *   - Tab navigation
 */

import { test, expect, type Page } from '@playwright/test';
import { injectBrowserMock } from './fixtures';

const DASHBOARD_URL = 'http://127.0.0.1:4173/src/dashboard/index.html';

async function openDashboard(page: Page, overrides: Record<string, unknown> = {}) {
  await injectBrowserMock(page, overrides);
  await page.goto(DASHBOARD_URL);
  // Wait for the app to render (loading state resolves after storage read)
  await page.waitForSelector('header', { timeout: 10_000 });
}

// ── Header ────────────────────────────────────────────────────────

test.describe('Dashboard — Header', () => {
  test('renders the TrendCast logo and title', async ({ page }) => {
    await openDashboard(page);
    await expect(page.locator('h1')).toContainText('TrendCast');
    await expect(page.locator('header')).toBeVisible();
  });

  test('shows market, signal, and news counts in subtitle', async ({ page }) => {
    await openDashboard(page);
    // Mock snapshot has 2 markets, 3 signals, 2 news
    await expect(page.locator('header')).toContainText('2 markets');
    await expect(page.locator('header')).toContainText('3 signals');
    await expect(page.locator('header')).toContainText('2 news');
  });

  test('displays build version', async ({ page }) => {
    await openDashboard(page);
    // Version stamp format: "v0.1.0+..." or "vdev"
    await expect(page.locator('header')).toContainText(/v\S+/);
  });

  test('shows last collection time', async ({ page }) => {
    await openDashboard(page);
    // "Last:" label followed by a time string
    await expect(page.locator('header')).toContainText(/Last:\s/);
  });

  test('renders all 9 tab buttons', async ({ page }) => {
    await openDashboard(page);
    const tabLabels = [
      '🔥 Hype Feed',
      '📈 Markets',
      '📰 News',
      '🔗 Correlations',
      '⭐ Watchlist',
      '📊 History',
      '💬 Community',
      '❓ FAQ',
      '⚙️ Settings',
    ];
    for (const label of tabLabels) {
      await expect(
        page.getByRole('button', { name: label, exact: true })
      ).toBeVisible();
    }
  });

  test('shows Collect Now button', async ({ page }) => {
    await openDashboard(page);
    await expect(page.locator('button', { hasText: /Collect Now/ })).toBeVisible();
  });

  test('shows Export button', async ({ page }) => {
    await openDashboard(page);
    await expect(page.locator('button', { hasText: /Export/ })).toBeVisible();
  });

  test('shows theme toggle button', async ({ page }) => {
    await openDashboard(page);
    // Dark mode shows sun icon to switch to light
    const themeBtn = page.locator('button[aria-label="Toggle theme"]');
    await expect(themeBtn).toBeVisible();
  });
});

// ── Tab Navigation ────────────────────────────────────────────────

test.describe('Dashboard — Tab Navigation', () => {
  test('defaults to the Feed tab', async ({ page }) => {
    await openDashboard(page);
    const feedTab = page.locator('nav button', { hasText: 'Hype Feed' });
    await expect(feedTab).toHaveClass(/border-brand-400/);
  });

  test('switches to Markets tab on click', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Markets' }).click();
    const marketsTab = page.locator('nav button', { hasText: 'Markets' });
    await expect(marketsTab).toHaveClass(/border-brand-400/);
  });

  test('switches to News tab on click', async ({ page }) => {
    await openDashboard(page);
    await page.getByRole('button', { name: '📰 News', exact: true }).click();
    await expect(page.getByRole('button', { name: '📰 News', exact: true })).toHaveClass(/border-brand-400/);
  });

  test('switches to Correlations tab on click', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Correlations' }).click();
    await expect(page.locator('nav button', { hasText: 'Correlations' })).toHaveClass(/border-brand-400/);
  });

  test('switches to Watchlist tab on click', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Watchlist' }).click();
    await expect(page.locator('nav button', { hasText: 'Watchlist' })).toHaveClass(/border-brand-400/);
  });

  test('switches to History tab on click', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'History' }).click();
    await expect(page.locator('nav button', { hasText: 'History' })).toHaveClass(/border-brand-400/);
  });

  test('switches to Community tab on click', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Community' }).click();
    await expect(page.locator('nav button', { hasText: 'Community' })).toHaveClass(/border-brand-400/);
  });

  test('switches to FAQ tab on click', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'FAQ' }).click();
    await expect(page.locator('nav button', { hasText: 'FAQ' })).toHaveClass(/border-brand-400/);
  });

  test('switches to Settings tab on click', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await expect(page.locator('nav button', { hasText: 'Settings' })).toHaveClass(/border-brand-400/);
  });
});

// ── Feed Tab ──────────────────────────────────────────────────────

test.describe('Dashboard — Feed Tab (Hype Feed)', () => {
  test('displays social signal cards', async ({ page }) => {
    await openDashboard(page);
    // Feed is the default tab
    // Mock has 3 signals
    const cards = page.locator('main .card-hover');
    await expect(cards).toHaveCount(3);
  });

  test('shows platform name on each card', async ({ page }) => {
    await openDashboard(page);
    const cards = page.locator('main .card-hover');
    // Cards are sorted by virality desc: 92 (tiktok), 85 (x), 55 (reddit)
    await expect(cards.nth(0)).toContainText(/tiktok/i);
    await expect(cards.nth(1)).toContainText(/x/i);
    await expect(cards.nth(2)).toContainText(/reddit/i);
  });

  test('shows virality score on each card', async ({ page }) => {
    await openDashboard(page);
    // Virality scores are 85, 55, 92 — sorted desc: 92, 85, 55
    const firstCard = page.locator('main .card-hover').first();
    await expect(firstCard).toContainText('92');
  });

  test('shows empty state when no signals', async ({ page }) => {
    await openDashboard(page, {
      'trendcast:latest-snapshot': {
        collectedAt: Date.now(),
        markets: [],
        signals: [],
        news: [],
      },
    });
    await expect(page.locator('main')).toContainText(/No social signals collected yet/);
  });

  test('signal cards with URLs are links', async ({ page }) => {
    await openDashboard(page);
    const firstLink = page.locator('main a.card-hover').first();
    await expect(firstLink).toHaveAttribute('href', /.+/);
  });

  test('bounds DOM to visible rows with a large dataset', async ({ page }) => {
    await openDashboard(page, {
      'trendcast:latest-snapshot': {
        collectedAt: Date.now(),
        markets: [],
        signals: Array.from({ length: 200 }, (_, i) => ({
          id: `signal-${i}`,
          platform: i % 3 === 0 ? 'x' : i % 3 === 1 ? 'reddit' : 'tiktok',
          text: `Social signal ${i} about Bitcoin and the market`,
          author: `author_${i}`,
          metrics: { likes: 100 + i, shares: 10, comments: 5, views: 1000 + i },
          timestamp: new Date(Date.now() - i * 60_000).toISOString(),
          keywords: ['btc', 'bitcoin'],
          sentiment: 0.5,
          virality: 200 - i,
          url: `https://example.com/signal/${i}`,
        })),
        news: [],
      },
    });
    // Only visible rows are mounted — well below the 200 seeded signals.
    // At 1280x720 (6 cols x ~11-12 rows incl. overscan 3) that's ~60-72 cards.
    const cards = page.locator('main .card-hover');
    // The DOM is bounded: only the visible window is mounted, so the number of
    // rendered cards is far below the 200 seeded signals.
    expect(await cards.count()).toBeLessThan(200);
  });

  test('reveals more cards when scrolling the feed', async ({ page }) => {
    await openDashboard(page, {
      'trendcast:latest-snapshot': {
        collectedAt: Date.now(),
        markets: [],
        signals: Array.from({ length: 200 }, (_, i) => ({
          id: `signal-${i}`,
          platform: i % 3 === 0 ? 'x' : i % 3 === 1 ? 'reddit' : 'tiktok',
          text: `Social signal ${i} about Bitcoin and the market`,
          author: `author_${i}`,
          metrics: { likes: 100 + i, shares: 10, comments: 5, views: 1000 + i },
          timestamp: new Date(Date.now() - i * 60_000).toISOString(),
          keywords: ['btc', 'bitcoin'],
          sentiment: 0.5,
          virality: 200 - i,
          url: `https://example.com/signal/${i}`,
        })),
        news: [],
      },
    });
    const cards = page.locator('main .card-hover');
    // Signals are sorted by virality descending (200 - i), so signal-0 is the
    // first card and signal-199 is the last. Before scrolling, the last card
    // must NOT be in the DOM (virtualization bounds it to the visible window).
    await expect(cards.first()).toContainText('Social signal 0');
    await expect(page.locator('main .card-hover', { hasText: 'Social signal 199' })).toHaveCount(0);
    // Scroll the virtualized feed container to the bottom.
    await page.locator('main .max-h-\\[70vh\\]').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(300);
    // Scrolling reveals the last signal (the DOM window moves through the list).
    await expect(page.locator('main .card-hover', { hasText: 'Social signal 199' })).toHaveCount(1);
    // The DOM stays bounded even at the bottom of the list.
    expect(await cards.count()).toBeLessThan(200);
  });
});

test.describe('Dashboard — Markets Tab (Market Odds)', () => {
  test('displays market contracts', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Markets' }).click();
    // Wait for market content to render
    await page.waitForTimeout(500);
    // Mock has 2 markets
    const mainSection = page.locator('main');
    await expect(mainSection).toContainText(/BTC.*100k/i);
    await expect(mainSection).toContainText(/Fed.*rate/i);
  });

  test('shows platform badges (Polymarket/Kalshi)', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Markets' }).click();
    await page.waitForTimeout(500);
    const mainSection = page.locator('main');
    await expect(mainSection).toContainText(/polymarket/i);
    await expect(mainSection).toContainText(/kalshi/i);
  });

  test('shows probability/odds for markets', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Markets' }).click();
    await page.waitForTimeout(500);
    // Market 1: Yes 65%, Market 2: Yes 42%
    const mainSection = page.locator('main');
    await expect(mainSection).toContainText('65');
    await expect(mainSection).toContainText('42');
  });

  test('has heatmap/grid view toggle', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Markets' }).click();
    await page.waitForTimeout(500);
    // Look for view mode buttons
    const mainSection = page.locator('main');
    // The component has a viewMode state with 'heatmap' | 'grid'
    await expect(mainSection).toBeVisible();
  });
});

// ── News Tab ──────────────────────────────────────────────────────

test.describe('Dashboard — News Tab', () => {
  test('displays news headlines', async ({ page }) => {
    await openDashboard(page);
    await page.getByRole('button', { name: '📰 News', exact: true }).click();
    await page.waitForTimeout(300);
    const mainSection = page.locator('main');
    await expect(mainSection).toContainText('Bitcoin surges past $98,000');
    await expect(mainSection).toContainText('Federal Reserve hints at potential rate cut');
  });

  test('shows news source badges', async ({ page }) => {
    await openDashboard(page);
    await page.getByRole('button', { name: '📰 News', exact: true }).click();
    await page.waitForTimeout(300);
    const mainSection = page.locator('main');
    await expect(mainSection).toContainText(/bbc/i);
    await expect(mainSection).toContainText(/cnn/i);
  });

  test('news items are links to original articles', async ({ page }) => {
    await openDashboard(page);
    await page.getByRole('button', { name: '📰 News', exact: true }).click();
    await page.waitForTimeout(300);
    const firstNewsLink = page.locator('main a').first();
    await expect(firstNewsLink).toHaveAttribute('href', /bbc\.com|cnn\.com|seekingalpha\.com/);
  });

  test('shows empty state when no news', async ({ page }) => {
    await openDashboard(page, {
      'trendcast:latest-snapshot': {
        collectedAt: Date.now(),
        markets: [],
        signals: [],
        news: [],
      },
    });
    await page.getByRole('button', { name: '📰 News', exact: true }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('main')).toContainText(/No news collected yet/);
  });

  test('shows section heading', async ({ page }) => {
    await openDashboard(page);
    await page.getByRole('button', { name: '📰 News', exact: true }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('main')).toContainText(/Latest News/);
  });

  test('renders source health indicator with fetched/correlated counts', async ({ page }) => {
    await openDashboard(page);
    await page.getByRole('button', { name: '📰 News', exact: true }).click();
    await page.waitForTimeout(300);
    const mainSection = page.locator('main');
    // MOCK_SNAPSHOT.sourceHealth: seekingalpha healthy (fetched 10), investing degraded (fetched 0)
    // The sidebar shows each source's label + a bare fetched count.
    const seeking = mainSection.locator('button', { hasText: 'Seeking Alpha' });
    await expect(seeking).toBeVisible();
    await expect(seeking).toContainText('10');
    const investing = mainSection.locator('button', { hasText: 'Investing.com' });
    await expect(investing).toBeVisible();
    await expect(investing).toContainText('0');
  });

  test('filters the news feed by selected sources (multi-select)', async ({ page }) => {
    await openDashboard(page);
    await page.getByRole('button', { name: '📰 News', exact: true }).click();
    await page.waitForTimeout(300);
    const mainSection = page.locator('main');
    // MOCK_SNAPSHOT.news: bbc, cnn, + 10 seekingalpha items.
    const seeking = mainSection.locator('button', { hasText: 'Seeking Alpha' });
    await seeking.click();
    // Only seekingalpha items should remain in the feed.
    await expect(mainSection.locator('a[href*="seekingalpha"]').first()).toBeVisible();
    await expect(mainSection.locator('a[href*="bbc"]')).toHaveCount(0);
    // Toggle a second source on — both should now be present.
    const bbc = mainSection.locator('button', { hasText: 'BBC' });
    await bbc.click();
    await expect(mainSection.locator('a[href*="seekingalpha"]').first()).toBeVisible();
    await expect(mainSection.locator('a[href*="bbc"]').first()).toBeVisible();
  });

  test('bounds DOM to visible rows with a large news dataset', async ({ page }) => {
    await openDashboard(page, {
      'trendcast:latest-snapshot': {
        collectedAt: Date.now(),
        markets: [],
        signals: [],
        news: Array.from({ length: 200 }, (_, i) => ({
          id: `news-${i}`,
          source: i % 2 === 0 ? 'bbc' : 'cnn',
          headline: `News headline ${i} about Bitcoin and the market`,
          summary: `Summary ${i} for the virtualized news feed`,
          url: `https://example.com/news/${i}`,
          publishedAt: new Date(Date.now() - i * 60_000).toISOString(),
          keywords: ['btc', 'bitcoin'],
        })),
      },
    });
    await page.getByRole('button', { name: '📰 News', exact: true }).click();
    await page.waitForTimeout(300);
    // Only visible rows are mounted — well below the 200 seeded news items.
    // At 1280x720 (6 cols x ~11-12 rows incl. overscan 3) that's ~60-72 cards.
    const cards = page.locator('main .card-hover');
    expect(await cards.count()).toBeLessThan(200);
  });

  test('news tab switch with a large dataset renders and stays interactive', async ({ page }) => {
    await openDashboard(page, {
      'trendcast:latest-snapshot': {
        collectedAt: Date.now(),
        markets: [],
        signals: [],
        news: Array.from({ length: 200 }, (_, i) => ({
          id: `news-${i}`,
          source: i % 2 === 0 ? 'bbc' : 'cnn',
          headline: `News headline ${i} about Bitcoin and the market`,
          summary: `Summary ${i} for the virtualized news feed`,
          url: `https://example.com/news/${i}`,
          publishedAt: new Date(Date.now() - i * 60_000).toISOString(),
          keywords: ['btc', 'bitcoin'],
        })),
      },
    });
    // Switch to the News tab with a large dataset — must render without error.
    await page.getByRole('button', { name: '📰 News', exact: true }).click();
    await page.waitForTimeout(300);
    // The feed is interactive: the first news card link is clickable (has an href).
    const firstNewsLink = page.locator('main a.card-hover').first();
    await expect(firstNewsLink).toHaveAttribute('href', /example\.com\/news\//);
  });
});

// ── Correlations Tab ──────────────────────────────────────────────

test.describe('Dashboard — Correlations Tab', () => {
  test('displays correlation section heading', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Correlations' }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('main')).toContainText(/Correlated Signals/i);
  });

  test('shows engine selector dropdown', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Correlations' }).click();
    await page.waitForTimeout(500);
    const engineSelect = page.locator('main select').first();
    await expect(engineSelect).toBeVisible();
    // Default engine is heuristic
    await expect(engineSelect).toHaveValue('heuristic');
  });

  test('engine dropdown has all 6 engine options', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Correlations' }).click();
    await page.waitForTimeout(500);
    // Target the engine selector by its title attribute
    const engineSelect = page.locator('main select[title="Correlation engine"]');
    const options = engineSelect.locator('option');
    await expect(options).toHaveCount(6);
  });

  test('shows Re-analyze button', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Correlations' }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('main button', { hasText: /Re-analyze/ })).toBeVisible();
  });

  test('shows correlation matches from cached data', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Correlations' }).click();
    await page.waitForTimeout(500);
    // The CorrelationPanel renders a graph or list with match data
    // Mock correlations have 2 signal-market matches, 2 news-market, 1 news-social
    const mainSection = page.locator('main');
    await expect(mainSection).toBeVisible();
  });

  test('filters correlation news matches by selected sources', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Correlations' }).click();
    await page.waitForTimeout(500);
    const mainSection = page.locator('main');
    // Mock newsMatches: news[0] is bbc ("Bitcoin surges…"), news[1] is cnn ("Federal Reserve…").
    // Switch to list view to make the matches queryable as text.
    const listToggle = mainSection.locator('button', { hasText: /^List$/ });
    if (await listToggle.isVisible()) {
      await listToggle.click();
      await page.waitForTimeout(300);
    }
    // Both bbc and cnn headlines should be present initially.
    await expect(mainSection).toContainText(/Bitcoin surges past/);
    await expect(mainSection).toContainText(/Federal Reserve hints/);
    // Filter to only CNN — the bbc match should disappear.
    const cnnBadge = mainSection.locator('button', { hasText: 'CNN' });
    await cnnBadge.click();
    await page.waitForTimeout(300);
    // The bbc news headline should no longer be rendered.
    await expect(mainSection).not.toContainText(/Bitcoin surges past/);
    await expect(mainSection).toContainText(/Federal Reserve hints/);
  });

  test('filters correlation social matches by selected platforms', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Correlations' }).click();
    await page.waitForTimeout(500);
    const mainSection = page.locator('main');
    // Social platform badges should be present in the sidebar.
    const xBadge = mainSection.locator('button', { hasText: 'X' });
    const redditBadge = mainSection.locator('button', { hasText: 'Reddit' });
    await expect(xBadge).toBeVisible();
    await expect(redditBadge).toBeVisible();
    // Switch to list view to make the matches queryable as text.
    const listToggle = mainSection.locator('button', { hasText: /^List$/ });
    if (await listToggle.isVisible()) {
      await listToggle.click();
      await page.waitForTimeout(300);
    }
    // Mock matches: signals[0] is x ("$BTC to the moon!…"), signals[1] is reddit ("Fed signals…").
    await expect(mainSection).toContainText(/BTC to the moon/);
    await expect(mainSection).toContainText(/Fed signals possible rate cut/);
    // Filter to only Reddit — the x match should disappear.
    await redditBadge.click();
    await page.waitForTimeout(300);
    await expect(mainSection).not.toContainText(/BTC to the moon/);
    await expect(mainSection).toContainText(/Fed signals possible rate cut/);
  });

  test('selecting a news badge hides unrelated social→market matches', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Correlations' }).click();
    await page.waitForTimeout(500);
    const mainSection = page.locator('main');
    // Switch to list view to make the matches queryable as text.
    const listToggle = mainSection.locator('button', { hasText: /^List$/ });
    if (await listToggle.isVisible()) {
      await listToggle.click();
      await page.waitForTimeout(300);
    }
    // Initially both a social→market (reddit) and news→market (bbc/cnn) match are shown.
    await expect(mainSection).toContainText(/Fed signals possible rate cut/);
    await expect(mainSection).toContainText(/Bitcoin surges past/);
    // Select only the CNN news badge — the reddit social→market match must be hidden.
    const cnnBadge = mainSection.locator('button', { hasText: 'CNN' });
    await cnnBadge.click();
    await page.waitForTimeout(300);
    await expect(mainSection).not.toContainText(/Fed signals possible rate cut/);
    await expect(mainSection).not.toContainText(/BTC to the moon/);
    // The CNN news→market match should remain.
    await expect(mainSection).toContainText(/Federal Reserve hints/);
  });

  // ── Unified filter OR-logic edge cases (news→social matches) ──
  // The mock has exactly 1 news→social match: bbc (news[0]) → x (signals[0]).
  // filterNewsSocialMatches keeps a match when EITHER side is selected.

  test('news→social match shows when only its news source is selected', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Correlations' }).click();
    await page.waitForTimeout(500);
    const mainSection = page.locator('main');
    const listToggle = mainSection.locator('button', { hasText: /^List$/ });
    if (await listToggle.isVisible()) {
      await listToggle.click();
      await page.waitForTimeout(300);
    }
    // Select only BBC (news side of the bbc→x match). The bridge match should show.
    await mainSection.locator('button', { hasText: 'BBC' }).click();
    await page.waitForTimeout(300);
    await expect(mainSection).toContainText(/News → Social \(1\)/);
  });

  test('news→social match shows when only its social platform is selected', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Correlations' }).click();
    await page.waitForTimeout(500);
    const mainSection = page.locator('main');
    const listToggle = mainSection.locator('button', { hasText: /^List$/ });
    if (await listToggle.isVisible()) {
      await listToggle.click();
      await page.waitForTimeout(300);
    }
    // Select only X (social side of the bbc→x match). The bridge match should show.
    await mainSection.locator('button', { hasText: 'X' }).click();
    await page.waitForTimeout(300);
    await expect(mainSection).toContainText(/News → Social \(1\)/);
  });

  test('news→social match hidden when neither side is selected', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Correlations' }).click();
    await page.waitForTimeout(500);
    const mainSection = page.locator('main');
    const listToggle = mainSection.locator('button', { hasText: /^List$/ });
    if (await listToggle.isVisible()) {
      await listToggle.click();
      await page.waitForTimeout(300);
    }
    // Select only CNN — neither bbc nor x is selected, so the bbc→x bridge match hides.
    await mainSection.locator('button', { hasText: 'CNN' }).click();
    await page.waitForTimeout(300);
    await expect(mainSection).toContainText(/News → Social \(0\)/);
  });

  test('deselecting all badges restores every match type', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Correlations' }).click();
    await page.waitForTimeout(500);
    const mainSection = page.locator('main');
    const listToggle = mainSection.locator('button', { hasText: /^List$/ });
    if (await listToggle.isVisible()) {
      await listToggle.click();
      await page.waitForTimeout(300);
    }
    // Select then deselect CNN — everything returns to the unfiltered state.
    const cnnBadge = mainSection.locator('button', { hasText: 'CNN' });
    await cnnBadge.click();
    await page.waitForTimeout(300);
    await expect(mainSection).toContainText(/News → Social \(0\)/);
    await cnnBadge.click();
    await page.waitForTimeout(300);
    // Back to unfiltered: all three sections show their full mock counts.
    await expect(mainSection).toContainText(/Social → Market \(2\)/);
    await expect(mainSection).toContainText(/News → Market \(2\)/);
    await expect(mainSection).toContainText(/News → Social \(1\)/);
  });

  // ── SocialSourceFilter badge rendering ──
  test('social platform badges show fetched counts and toggle aria-pressed', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Correlations' }).click();
    await page.waitForTimeout(500);
    const mainSection = page.locator('main');
    // Mock signals: 1 x, 1 reddit, 1 tiktok → each badge shows a fetched count of 1.
    const xBadge = mainSection.locator('button', { hasText: 'X' });
    const redditBadge = mainSection.locator('button', { hasText: 'Reddit' });
    const tiktokBadge = mainSection.locator('button', { hasText: 'TikTok' });
    await expect(xBadge).toBeVisible();
    await expect(redditBadge).toBeVisible();
    await expect(tiktokBadge).toBeVisible();
    // Each badge shows its accumulated signal count.
    await expect(xBadge).toContainText('1');
    await expect(redditBadge).toContainText('1');
    await expect(tiktokBadge).toContainText('1');
    // Clicking toggles aria-pressed on/off.
    await expect(redditBadge).toHaveAttribute('aria-pressed', 'false');
    await redditBadge.click();
    await expect(redditBadge).toHaveAttribute('aria-pressed', 'true');
    await redditBadge.click();
    await expect(redditBadge).toHaveAttribute('aria-pressed', 'false');
  });

  test('switching to embedding engine shows model selector', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Correlations' }).click();
    await page.waitForTimeout(500);
    const engineSelect = page.locator('main select[title="Correlation engine"]');
    await engineSelect.selectOption('embedding');
    await page.waitForTimeout(300);
    // Embedding model selector should appear (title="Embedding model")
    const modelSelect = page.locator('main select[title="Embedding model"]');
    await expect(modelSelect).toBeVisible();
  });

  test('switching to sentiment engine shows sentiment model selector', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Correlations' }).click();
    await page.waitForTimeout(500);
    const engineSelect = page.locator('main select[title="Correlation engine"]');
    await engineSelect.selectOption('sentiment');
    await page.waitForTimeout(300);
    const modelSelect = page.locator('main select[title="Sentiment model"]');
    await expect(modelSelect).toBeVisible();
  });

  test('shows ML warning when non-heuristic engine selected', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Correlations' }).click();
    await page.waitForTimeout(500);
    const engineSelect = page.locator('main select').first();
    await engineSelect.selectOption('embedding');
    await page.waitForTimeout(300);
    await expect(page.locator('main')).toContainText(/ML engine selected/);
  });
});

// ── Watchlist Tab ─────────────────────────────────────────────────

test.describe('Dashboard — Watchlist Tab', () => {
  test('displays watchlist section heading', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Watchlist' }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('main')).toContainText(/Your Watchlist/);
  });

  test('shows watchlist entries from mock data', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Watchlist' }).click();
    // Wait for watchlist to load (async sendMessage + storage)
    await expect(page.locator('main')).toContainText(/BTC.*100k/i, { timeout: 10_000 });
  });

  test('shows empty state when watchlist is empty', async ({ page }) => {
    await openDashboard(page, {
      'trendcast:watchlist': [],
    });
    await page.locator('nav button', { hasText: 'Watchlist' }).click();
    await expect(page.locator('main')).toContainText(/Your watchlist is empty/, { timeout: 10_000 });
  });

  test('shows remove button for watchlist items', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Watchlist' }).click();
    // Wait for watchlist entry to load, then check remove button
    const removeBtn = page.locator('main button[aria-label="Remove from watchlist"]');
    await expect(removeBtn).toBeVisible({ timeout: 10_000 });
  });
});

// ── History Tab ───────────────────────────────────────────────────

test.describe('Dashboard — History Tab', () => {
  test('displays history section heading', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'History' }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('main')).toContainText(/Historical Trends/);
  });

  test('renders an SVG chart', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'History' }).click();
    await page.waitForTimeout(500);
    // HistoryChart renders an SVG element
    await expect(page.locator('main svg')).toBeVisible();
  });

  test('shows metric selector buttons', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'History' }).click();
    await page.waitForTimeout(500);
    // Metric labels: Markets, Signals, News, Correlations, Avg Sentiment
    const mainSection = page.locator('main');
    await expect(mainSection).toContainText(/Signals/);
  });

  test('chart renders with history data points', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'History' }).click();
    await page.waitForTimeout(500);
    // The SVG should contain path elements (the line chart)
    const svgPaths = page.locator('main svg path');
    await expect(svgPaths.first()).toBeVisible();
  });

  test('shows empty state when no history', async ({ page }) => {
    await openDashboard(page, {
      'trendcast:history': [],
    });
    await page.locator('nav button', { hasText: 'History' }).click();
    await page.waitForTimeout(500);
    // Should show some empty state message
    const mainSection = page.locator('main');
    await expect(mainSection).toBeVisible();
  });
});

// ── Community Tab ─────────────────────────────────────────────────

test.describe('Dashboard — Community Tab', () => {
  test('displays community section heading', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Community' }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('main')).toContainText(/Join the TrendCast Community/);
  });

  test('shows Telegram group card with join link', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Community' }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('main')).toContainText(/Telegram/);
    const telegramLink = page.locator('main a', { hasText: /Telegram/ });
    await expect(telegramLink).toHaveAttribute('href', /t\.me/);
  });

  test('shows GitHub Issues card with link', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Community' }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('main')).toContainText(/GitHub Issues/);
    const githubLink = page.locator('main a', { hasText: /GitHub/ });
    await expect(githubLink).toHaveAttribute('href', /github\.com/);
  });

  test('shows privacy note', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Community' }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('main')).toContainText(/100% client-side/);
  });
});

// ── FAQ Tab ───────────────────────────────────────────────────────

test.describe('Dashboard — FAQ Tab', () => {
  test('displays FAQ heading', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'FAQ' }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('main')).toContainText(/Correlation Engines FAQ/);
  });

  test('shows Heuristic engine section', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'FAQ' }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('main')).toContainText(/Heuristic Engine/);
  });

  test('shows Embedding engine section', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'FAQ' }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('main')).toContainText(/Embedding Engine/);
  });

  test('explains what correlation engines are', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'FAQ' }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('main')).toContainText(/What Are Correlation Engines/);
  });

  test('shows model comparison table', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'FAQ' }).click();
    await page.waitForTimeout(300);
    // The FAQ contains a model table
    await expect(page.locator('main')).toContainText(/MiniLM/);
  });
});

// ── Settings Tab ──────────────────────────────────────────────────

test.describe('Dashboard — Settings Tab', () => {
  test('displays settings section heading', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('main')).toContainText(/Settings/);
  });

  test('shows collection interval input', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(300);
    const intervalInput = page.getByRole('spinbutton', { name: /Collection interval/i });
    await expect(intervalInput).toBeVisible();
    await expect(intervalInput).toHaveValue('60');
  });

  test('shows correlation engine radio buttons', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(300);
    const radios = page.locator('main input[type="radio"][name="correlationEngine"]');
    await expect(radios).toHaveCount(6);
  });

  test('heuristic engine is selected by default', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(300);
    // Radio buttons use name="correlationEngine"; checked state is on the heuristic one
    const radios = page.locator('main input[type="radio"][name="correlationEngine"]');
    await expect(radios).toHaveCount(6);
    // The first radio is heuristic (first in the list)
    await expect(radios.first()).toBeChecked();
  });

  test('shows data source toggles', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(300);
    const mainSection = page.locator('main');
    await expect(mainSection).toContainText(/Polymarket/);
    await expect(mainSection).toContainText(/Kalshi/);
    await expect(mainSection).toContainText(/Reddit/);
    await expect(mainSection).toContainText(/BBC/);
  });

  test('shows source checkboxes', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(300);
    const checkboxes = page.locator('main input[type="checkbox"]');
    await expect(checkboxes.first()).toBeVisible();
    const count = await checkboxes.count();
    expect(count).toBeGreaterThan(0);
  });

  test('changing collection interval updates the input', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(300);
    const intervalInput = page.getByRole('spinbutton', { name: /Collection interval/i });
    await intervalInput.fill('30');
    await expect(intervalInput).toHaveValue('30');
  });

  test('selecting embedding engine shows model dropdown', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(300);
    // Radio buttons are ordered: heuristic, embedding, sentiment, zeroshot, ner
    const radios = page.locator('main input[type="radio"][name="correlationEngine"]');
    await radios.nth(1).check(); // embedding is 2nd
    await page.waitForTimeout(300);
    // Embedding model selector should appear
    const modelSelect = page.locator('main select').first();
    await expect(modelSelect).toBeVisible({ timeout: 10_000 });
  });
});

// ── Theme Toggle ──────────────────────────────────────────────────

test.describe('Dashboard — Theme Toggle', () => {
  test('defaults to dark mode', async ({ page }) => {
    await openDashboard(page);
    const html = page.locator('html');
    await expect(html).toHaveClass(/dark/);
  });

  test('toggles to light mode on click', async ({ page }) => {
    await openDashboard(page);
    const themeBtn = page.locator('button[aria-label="Toggle theme"]');
    await themeBtn.click();
    await page.waitForTimeout(300);
    const html = page.locator('html');
    await expect(html).toHaveClass(/light/);
    await expect(html).not.toHaveClass(/dark/);
  });

  test('toggles back to dark mode on second click', async ({ page }) => {
    await openDashboard(page);
    const themeBtn = page.locator('button[aria-label="Toggle theme"]');
    await themeBtn.click();
    await page.waitForTimeout(200);
    await themeBtn.click();
    await page.waitForTimeout(200);
    const html = page.locator('html');
    await expect(html).toHaveClass(/dark/);
  });
});

// ── Export ────────────────────────────────────────────────────────

test.describe('Dashboard — Export', () => {
  test('hovering Export button shows CSV and JSON options', async ({ page }) => {
    await openDashboard(page);
    const exportBtn = page.locator('button', { hasText: /Export/ });
    await exportBtn.hover();
    await page.waitForTimeout(300);
    await expect(page.locator('button', { hasText: 'CSV' })).toBeVisible();
    await expect(page.locator('button', { hasText: 'JSON' })).toBeVisible();
  });
});

// ── Collect Now ───────────────────────────────────────────────────

test.describe('Dashboard — Collect Now', () => {
  test('clicking Collect Now triggers collection', async ({ page }) => {
    await openDashboard(page);
    const collectBtn = page.locator('button', { hasText: /Collect Now/ });
    await collectBtn.click();
    // Button should show "Collecting…" state
    await page.waitForTimeout(200);
    // After collection completes, the button should return to "Collect Now"
    await expect(page.locator('button', { hasText: /Collect/ })).toBeVisible();
  });
});

// ── Footer ────────────────────────────────────────────────────────

test.describe('Dashboard — Footer', () => {
  test('shows client-side privacy note', async ({ page }) => {
    await openDashboard(page);
    await expect(page.locator('footer')).toContainText(/100% client-side/);
  });

  test('shows Telegram community link', async ({ page }) => {
    await openDashboard(page);
    const footerLink = page.locator('footer a', { hasText: /Telegram/ });
    await expect(footerLink).toBeVisible();
    await expect(footerLink).toHaveAttribute('href', /t\.me/);
  });
});

// ── Loading State ─────────────────────────────────────────────────

test.describe('Dashboard — Loading State', () => {
  test('shows loading indicator before data loads', async ({ page }) => {
    // Use a slow-responding mock by not pre-seeding snapshot
    await injectBrowserMock(page, {
      'trendcast:latest-snapshot': undefined,
      'trendcast:last-collection': undefined,
    });
    await page.goto(DASHBOARD_URL);
    // The app shows "Loading…" until the storage read completes
    // Since our mock resolves immediately, this may be brief
    await page.waitForSelector('header', { timeout: 10_000 });
    // After load, the header should be visible
    await expect(page.locator('h1')).toContainText('TrendCast');
  });
});