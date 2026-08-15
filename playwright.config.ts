import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Playwright configuration for TrendCast.
 *
 * TrendCast is a browser extension, but its UI pages (dashboard + popup)
 * are plain React apps that only need the `chrome.*` / `browser.*` APIs
 * to be mocked. We load the built HTML files directly via `file://` and
 * inject a mock WebExtension API before each page loads.
 *
 * Prerequisites:
 *   npm run build          # produces dist/ with bundled HTML/JS/CSS
 *
 * Run:
 *   npx playwright test            # all tests
 *   npx playwright test --headed   # watch in a real browser
 *   npx playwright test --ui       # interactive UI mode
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: 'file://',
    trace: 'on-first-retry',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // In CI, use Playwright's bundled Chromium (installed via
        // `npx playwright install chromium`). Locally, fall back to
        // system Chrome if the bundled browser isn't available.
        channel: process.env.CI ? undefined : 'chrome',
      },
    },
  ],
  // Build the extension before running tests so dist/ exists.
  // We use a simple static server because Playwright's webServer health
  // check requires http:// (not file://).
  webServer: {
    command: 'npm run build:debug && npx sirv-cli dist --host 127.0.0.1 --port 4173 --silent',
    url: 'http://127.0.0.1:4173/src/dashboard/index.html',
    reuseExistingServer: true,
    timeout: 120_000,
    cwd: __dirname,
  },
});