# Codebase Structure

**Analysis Date:** 2026-08-22

## Directory Layout

```
TrendCast/
├── src/                    # Extension source (TypeScript + React)
│   ├── background/         # MV3 service worker (orchestrator)
│   ├── config/             # Centralised configuration constants
│   ├── content/            # Content scripts (DOM scrapers)
│   │   ├── news/           #   BBC/CNN/SeekingAlpha/Investing scrapers
│   │   ├── prediction-markets/  #   Polymarket/Kalshi scrapers
│   │   └── socials/        #   X/Reddit/TikTok scrapers + overlay
│   ├── dashboard/          # New-tab React app (primary UI)
│   │   ├── components/     #   UI components
│   │   ├── hooks/          #   Storage/message hooks
│   │   └── utils/          #   UI helpers (treemap)
│   ├── messaging/          # Typed message layer + browser polyfill
│   ├── popup/              # Toolbar popup React app
│   │   ├── components/     #   Settings component
│   │   └── hooks/          #   Storage/message hooks
│   ├── services/           # Business logic
│   │   ├── collectors/     #   Data collectors (fetch APIs)
│   │   └── engine/         #   Correlation engines
│   │       └── ml/         #     ML engines (embedding, sentiment, etc.)
│   ├── types/              # Shared domain types + Message union
│   ├── utils/              # Shared utilities
│   ├── workers/            # Web Workers (ML inference)
│   ├── manifest.config.ts  # MV3 manifest (single source of truth)
│   └── vite-env.d.ts       # Vite env type declarations
├── tests/                  # Test suites
│   ├── e2e/                # Playwright end-to-end tests
│   ├── screenshots/        # Playwright screenshot tests
│   └── unit/               # Vitest unit tests
├── docs/                   # Hugo documentation site
│   ├── content/            #   Markdown docs
│   ├── layouts/            #   Hugo templates
│   ├── static/             #   Static assets
│   └── public/             #   Built site output
├── public/                 # Static extension assets
│   ├── icons/              #   Extension icons
│   └── wasm/               #   ONNX Runtime WASM files
├── scripts/                # Build/dev scripts
├── playwright-report/      # Playwright test reports (generated)
├── test-results/           # Test artifacts (generated)
├── dist/                   # Build output (generated, per-browser)
├── package.json            # Dependencies + scripts
├── vite.config.ts          # Vite + @crxjs config
├── tsconfig.json           # TypeScript config
├── tailwind.config.ts      # Tailwind config
├── postcss.config.js       # PostCSS config
├── playwright.config.ts    # Playwright config
├── playwright.screenshots.config.ts  # Screenshot test config
└── manifest.json           # Built manifest (generated)
```

## Directory Purposes

**`src/background/`:**
- Purpose: The MV3 background service worker — the orchestrator
- Contains: `index.ts` (alarm setup, message handlers, collection logic, correlation runners, ML worker manager)
- Key files: `src/background/index.ts`

**`src/config/`:**
- Purpose: Centralised configuration constants
- Contains: `index.ts` (scrape URLs, collection intervals, storage keys, storage budget, fetch cache, ML model IDs)
- Key files: `src/config/index.ts`

**`src/content/`:**
- Purpose: Content scripts that scrape the DOM on supported sites
- Contains: `news/index.ts`, `prediction-markets/index.ts`, `socials/index.ts` + `socials/overlay.css`
- Key files: `src/content/news/index.ts`, `src/content/prediction-markets/index.ts`

**`src/dashboard/`:**
- Purpose: The new-tab React app — primary UI
- Contains: `App.tsx`, `index.tsx`, `dashboard.css`, `components/`, `hooks/`, `utils/`
- Key files: `src/dashboard/App.tsx`, `src/dashboard/index.tsx`

**`src/popup/`:**
- Purpose: The toolbar popup React app — quick-launcher
- Contains: `App.tsx`, `index.tsx`, `popup.css`, `components/Settings.tsx`, `hooks/`
- Key files: `src/popup/App.tsx`

**`src/messaging/`:**
- Purpose: Type-safe cross-context messaging + browser polyfill
- Contains: `index.ts` (sendMessage, sendTabMessage, onMessage), `browser.ts`
- Key files: `src/messaging/index.ts`, `src/messaging/browser.ts`

**`src/services/`:**
- Purpose: Business logic — collection and correlation
- Contains: `collectors/` (polymarket, kalshi, reddit, x-trends, news), `engine/` (correlation.ts, ml.ts, ml/)
- Key files: `src/services/collectors/index.ts`, `src/services/engine/correlation.ts`, `src/services/engine/ml.ts`

**`src/types/`:**
- Purpose: Shared domain types + Message discriminated union
- Contains: `index.ts`
- Key files: `src/types/index.ts`

**`src/utils/`:**
- Purpose: Shared utilities
- Contains: `conditional-fetch.ts`, `entities.ts`, `export.ts`, `keywords.ts`, `rate-limiter.ts`, `sentiment.ts`, `storage.ts`
- Key files: `src/utils/storage.ts`, `src/utils/conditional-fetch.ts`

**`src/workers/`:**
- Purpose: Web Workers for off-main-thread ML inference
- Contains: `ml-worker.ts`
- Key files: `src/workers/ml-worker.ts`

**`tests/`:**
- Purpose: Test suites
- Contains: `e2e/` (Playwright), `screenshots/` (Playwright), `unit/` (Vitest)
- Key files: `tests/e2e/dashboard.spec.ts`, `tests/e2e/popup.spec.ts`, `tests/e2e/fixtures.ts`, `tests/unit/correlation.test.ts`

**`docs/`:**
- Purpose: Hugo documentation site
- Contains: `content/`, `layouts/`, `static/`, `public/`, `hugo.toml`
- Key files: `docs/content/features.md`, `docs/content/installation.md`

**`public/`:**
- Purpose: Static extension assets
- Contains: `icons/`, `wasm/` (ONNX Runtime WASM)
- Key files: `public/wasm/ort-wasm-simd-threaded.jsep.mjs`

**`scripts/`:**
- Purpose: Build/dev scripts
- Contains: `generate-screenshot-manifest.ts`
- Key files: `scripts/generate-screenshot-manifest.ts`

## Key File Locations

**Entry Points:**
- `src/background/index.ts`: Background service worker (orchestrator)
- `src/dashboard/index.tsx`: Dashboard React entry (new tab)
- `src/popup/index.tsx`: Popup React entry (toolbar)
- `src/content/news/index.ts`, `src/content/prediction-markets/index.ts`, `src/content/socials/index.ts`: Content script entries
- `src/workers/ml-worker.ts`: ML Web Worker entry

**Configuration:**
- `src/manifest.config.ts`: MV3 manifest (single source of truth, consumed by `@crxjs/vite-plugin`)
- `src/config/index.ts`: Runtime configuration constants
- `vite.config.ts`: Vite + @crxjs build config
- `tsconfig.json`: TypeScript config
- `tailwind.config.ts`, `postcss.config.js`: Styling config
- `playwright.config.ts`, `playwright.screenshots.config.ts`: Test config

**Core Logic:**
- `src/services/collectors/*.ts`: Data collection
- `src/services/engine/correlation.ts`: Heuristic correlation
- `src/services/engine/ml/*.ts`: ML correlation engines
- `src/utils/*.ts`: Shared utilities

**Testing:**
- `tests/e2e/`: Playwright end-to-end tests
- `tests/unit/`: Vitest unit tests
- `tests/screenshots/`: Playwright screenshot tests

## Naming Conventions

**Files:**
- React components: `PascalCase.tsx` (e.g., `CorrelationPanel.tsx`, `HypeFeed.tsx`)
- Hooks: `useCamelCase.ts` (e.g., `useSnapshot.ts`, `useCorrelations.ts`)
- Collectors: `kebab-case.ts` (e.g., `x-trends.ts`, `conditional-fetch.ts`)
- Barrel exports: `index.ts`
- Config: `*.config.ts` (e.g., `manifest.config.ts`, `vite.config.ts`)
- Tests: `*.spec.ts` (e2e), `*.test.ts` (unit)

**Directories:**
- Feature directories: lowercase singular (e.g., `background/`, `popup/`, `dashboard/`)
- Sub-directories by concern: `components/`, `hooks/`, `utils/`, `ml/`

## Where to Add New Code

**New Feature:**
- Primary code: `src/dashboard/components/` (UI) or `src/services/` (logic)
- Tests: `tests/e2e/` (Playwright) or `tests/unit/` (Vitest)

**New Component/Module:**
- Implementation: `src/dashboard/components/` (UI) or `src/services/engine/ml/` (ML engine)
- Barrel export: add to `src/services/engine/ml.ts` or `src/services/collectors/index.ts`

**New Data Source:**
- Collector: `src/services/collectors/<source>.ts`, export from `src/services/collectors/index.ts`
- Config: add URL/interval to `src/config/index.ts`
- Content script (if DOM scraping): `src/content/<source>/index.ts`, register in `src/manifest.config.ts`

**Utilities:**
- Shared helpers: `src/utils/`

**New Message Type:**
- Add to the `Message` union in `src/types/index.ts`

## Special Directories

**`dist/`:**
- Purpose: Build output (per-browser: `dist/chrome/`, `dist/firefox/`)
- Generated: Yes
- Committed: No

**`public/wasm/`:**
- Purpose: ONNX Runtime Web WASM files for client-side ML
- Generated: No (vendored)
- Committed: Yes

**`playwright-report/`, `test-results/`:**
- Purpose: Test reports and artifacts
- Generated: Yes
- Committed: No

**`docs/public/`:**
- Purpose: Built Hugo documentation site
- Generated: Yes
- Committed: Yes (static site output)

---

*Structure analysis: 2026-08-22*
