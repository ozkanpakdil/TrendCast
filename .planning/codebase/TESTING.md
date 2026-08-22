# Testing Patterns

**Analysis Date:** 2026-08-22

## Test Framework

**Runner:**
- Vitest 2.0.5 for unit tests (config inline in `vite.config.ts` `test` block)
- Playwright 1.62.1 for E2E tests (`playwright.config.ts`) and screenshots (`playwright.screenshots.config.ts`)

**Assertion Library:**
- Vitest's built-in `expect` (unit tests)
- Playwright's built-in `expect` with auto-retrying assertions (E2E)

**Run Commands:**
```bash
bun run test              # Run all unit tests (vitest run)
bun run test:watch        # Watch mode (vitest)
bun run test:e2e          # Run all Playwright E2E tests
bun run test:e2e:headed   # E2E in headed browser
bun run test:e2e:ui       # Playwright interactive UI mode
bun run test:e2e:report   # Show Playwright HTML report
bun run test:all          # lint + typecheck + unit + e2e
bun run screenshots       # Generate docs screenshots (separate config)
```

## Test File Organization

**Location:**
- Unit tests: `tests/unit/` (separate from `src/`, not co-located)
- E2E tests: `tests/e2e/`
- Screenshots: `tests/screenshots/`

**Naming:**
- Unit: `*.test.ts` — e.g. `tests/unit/correlation.test.ts`
- E2E: `*.spec.ts` — e.g. `tests/e2e/dashboard.spec.ts`, `tests/e2e/popup.spec.ts`
- Shared fixtures: `tests/e2e/fixtures.ts`

**Structure:**
```
tests/
├── unit/
│   └── correlation.test.ts      # Vitest unit tests
├── e2e/
│   ├── fixtures.ts              # Shared browser-API mock + test data
│   ├── dashboard.spec.ts        # Dashboard E2E
│   └── popup.spec.ts            # Popup E2E
└── screenshots/
    └── screenshots.spec.ts      # Docs screenshot generator (not a test)
```

## Test Structure

**Suite Organization:**
```typescript
// tests/unit/correlation.test.ts
import { describe, it, expect } from 'vitest';
import { extractKeywords, keywordSimilarity } from '@/utils/keywords';
import { correlate } from '@/services/engine/correlation';
import type { MarketContract, SocialSignal } from '@/types';

describe('extractKeywords', () => {
  it('extracts hashtags', () => {
    const result = extractKeywords('Check out #Bitcoin and #Ethereum today');
    expect(result).toContain('bitcoin');
    expect(result).toContain('ethereum');
  });
});
```

**Patterns:**
- `describe` blocks group tests by function/feature
- `it` blocks use behavior-descriptive strings ("extracts hashtags", "returns 0 for disjoint sets")
- `globals: true` in Vitest config, but tests still import `describe, it, expect` explicitly from `vitest`
- E2E uses `test.describe` / `test` from `@playwright/test` with `test.describe('Dashboard — Header', () => { ... })` naming

## Mocking

**Framework:** No mocking library (no `vi.mock`/`jest.mock`). Unit tests use plain inline fixture objects. E2E uses a hand-written browser API mock injected via `page.addInitScript`.

**Patterns (E2E browser mock):**
```ts
// tests/e2e/fixtures.ts
export function mockBrowserApiScript(overrides: Record<string, unknown> = {}): string {
  const data = {
    'trendcast:settings': MOCK_SETTINGS,
    'trendcast:latest-snapshot': MOCK_SNAPSHOT,
    ...overrides,
  };
  return `(function() { /* in-memory storage.local + runtime mock */ })()`;
}
```
- The mock is injected before app code runs via `page.addInitScript` (see `injectBrowserMock` in `tests/e2e/fixtures.ts`)
- It provides `browser.storage.local.get/set/remove`, `storage.onChanged`, `runtime.sendMessage`, `runtime.onMessage`, `tabs.create`, `alarms.create/clear`
- Test data is pre-seeded into the in-memory store so the UI renders with content
- `overrides` param lets individual tests replace specific storage keys

**What to Mock:**
- The entire WebExtension `browser`/`chrome` API (storage, runtime, tabs, alarms) — the app depends on it but it's not available in a plain browser page
- External network calls — collectors are not exercised in E2E; the UI reads pre-seeded storage

**What NOT to Mock:**
- The React UI itself — E2E tests render the real built app from `dist/`
- Pure utility functions — unit tests call them directly with real inputs

## Fixtures and Factories

**Test Data:**
```ts
// tests/e2e/fixtures.ts
export const MOCK_SETTINGS = { collectionIntervalMinutes: 60, ... };
export const MOCK_SNAPSHOT = { collectedAt: Date.now(), markets: [...], signals: [...], news: [...] };
export const MOCK_HISTORY = Array.from({ length: 24 }, (_, i) => ({ ... }));
export const MOCK_WATCHLIST = [...];
export const MOCK_CORRELATIONS = { matches: [...], newsMatches: [...], engine: 'heuristic' };
```

**Location:**
- All shared mock data lives in `tests/e2e/fixtures.ts`
- Unit tests define inline fixture objects inside the test file (e.g. `mockContract`, `mockSignal` in `tests/unit/correlation.test.ts`)

## Coverage

**Requirements:** None enforced — no coverage threshold configured in `vite.config.ts` or `package.json`.

**View Coverage:**
```bash
bunx vitest run --coverage   # Requires @vitest/coverage-v8 (not currently installed)
```

## Test Types

**Unit Tests:**
- Scope: Pure logic — keyword extraction, similarity scoring, correlation engine
- Approach: Direct function calls with inline fixture objects; assert on return values
- Files: `tests/unit/correlation.test.ts`

**Integration Tests:**
- Not used as a separate category. The E2E suite (Playwright) covers the full UI + storage + messaging integration.

**E2E Tests:**
- Framework: Playwright (`@playwright/test`)
- Scope: Dashboard and popup UI rendered from the built `dist/` output, loaded via `file://`/`http://` with the browser mock injected
- Config: `playwright.config.ts` — `testDir: './tests/e2e'`, `fullyParallel: true`, `retries: CI ? 2 : 0`, `workers: CI ? 1 : undefined`, `timeout: 30_000`, `expect.timeout: 5_000`
- A `webServer` builds the extension (`bun run build:debug`) and serves `dist/chrome` via `sirv-cli` on port 4173 before tests run
- Uses `channel: 'chrome'` locally (system Chrome) and Playwright's bundled Chromium in CI
- Files: `tests/e2e/dashboard.spec.ts`, `tests/e2e/popup.spec.ts`

**Screenshot Generation:**
- Framework: Playwright with a dedicated config `playwright.screenshots.config.ts`
- Not a test — produces PNG screenshots + WebM screen-cast committed to `docs/static/assets/screenshots/`
- `fullyParallel: false`, `workers: 1`, fixed viewport `1280×800`, `outputDir: './docs/static/assets/screenshots'`
- Uses intentional fixed waits (`page.waitForTimeout`) for visual settling; disabled from linting via `/* eslint-disable */`
- Files: `tests/screenshots/screenshots.spec.ts`

## Common Patterns

**Async Testing:**
```ts
// E2E — Playwright auto-waits for assertions
test('shows market, signal, and news counts', async ({ page }) => {
  await openDashboard(page);
  await expect(page.locator('header')).toContainText('2 markets');
});

// Helper to open a page with the mock injected
async function openDashboard(page: Page, overrides: Record<string, unknown> = {}) {
  await injectBrowserMock(page, overrides);
  await page.goto(DASHBOARD_URL);
  await page.waitForSelector('header', { timeout: 10_000 });
}
```

**Error Testing:**
- Not explicitly covered. No tests assert on thrown errors or rejected promises. Error paths in `src/messaging/index.ts` (retry logic) and `src/popup/hooks/useSnapshot.ts` (catch blocks) are untested.

**Numeric Assertions:**
```ts
// tests/unit/correlation.test.ts
expect(sim).toBeCloseTo(0.5, 5);   // floating-point comparison
expect(matches[0].confidence).toBeGreaterThan(0);
expect(matches[0].confidence).toBeGreaterThanOrEqual(matches[1].confidence);
```

**Collection Assertions:**
```ts
expect(result).toContain('bitcoin');
expect(result).not.toContain('the');
expect(extractKeywords('')).toEqual([]);
expect(matches.length).toBe(0);
```

---

*Testing analysis: 2026-08-22*
