import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Playwright config dedicated to screenshot generation.
 *
 * This is separate from the main playwright.config.ts so that:
 *   - Screenshot runs don't interfere with E2E test runs
 *   - We can set a fixed viewport and output directory
 *   - The webServer reuses the same build+serve command
 *
 * Run:
 *   bunx playwright test --config=playwright.screenshots.config.ts
 *
 * Output:
 *   docs/static/assets/screenshots/*.png
 *   docs/static/assets/screenshots/*.webm  (screen-cast)
 */
export default defineConfig({
  testDir: './tests/screenshots',
  fullyParallel: false, // sequential — deterministic screenshots
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'file://',
    trace: 'off',
    headless: true,
    viewport: { width: 1280, height: 800 },
    screenshot: {
      type: 'png',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env.CI ? undefined : 'chrome',
      },
    },
  ],
  outputDir: './docs/static/assets/screenshots',
  webServer: {
    command:
      'bun run build:debug && bunx sirv-cli dist/chrome --host 127.0.0.1 --port 4173 --silent',
    url: 'http://127.0.0.1:4173/src/dashboard/index.html',
    reuseExistingServer: true,
    timeout: 120_000,
    cwd: __dirname,
  },
});