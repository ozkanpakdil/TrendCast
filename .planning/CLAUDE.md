<!-- GSD:project-start source:PROJECT.md -->

## Project

**TrendCast**

A 100% client-side Manifest V3 browser extension (Chrome + Firefox) that collects social sentiment (X, Reddit, TikTok), news headlines (BBC, CNN, Yahoo Finance, Google News, Seeking Alpha, Investing.com), and prediction market odds (Polymarket, Kalshi), then correlates them to surface which markets are being driven by real-world discussion. It runs entirely in the user's browser — no backend, no API keys.

**Core Value:** Surface the strongest, most reliable signal of what prediction markets are moving and why — by correlating social hype, news, and market odds — fast enough that the user trusts it as a daily decision aid.

### Constraints

- **Tech stack**: TypeScript 5.5 strict, React 18, Vite 5 + @crxjs/vite-plugin, Tailwind 3, @huggingface/transformers 3.7, Vitest, Playwright — existing stack, do not change.
- **Package manager**: Bun only (never npm/npx) — mandatory.
- **Compatibility**: Manifest V3, Chrome + Firefox both (`TARGET=firefox` build).
- **Privacy**: 100% client-side, no API keys, no backend — hard requirement.
- **Performance**: Must not regress collection or correlation latency; storage must stay within the ~7 MB soft budget.
- **Git**: User handles all commits/pushes/staging — I only make file edits.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Languages

- TypeScript 5.5.4 - All source code in `src/`, tests in `tests/`, and build scripts in `scripts/`. Strict mode enabled. `tsconfig.json` targets ES2022 with `moduleResolution: "bundler"`.
- CSS - Styling via Tailwind CSS utility classes plus hand-written CSS files (`src/content/socials/overlay.css`, `src/popup/popup.css`, `src/dashboard/dashboard.css`).
- HTML - Entry points for the popup and dashboard (`src/popup/index.html`, `src/dashboard/index.html`).
- Markdown - Documentation site content in `docs/content/`.

## Runtime

- Browser extension (Manifest V3) — runs in Chrome and Firefox. No Node.js server runtime; all logic executes client-side in the browser.
- Bun is the package manager and script runner (all `package.json` scripts invoke `bun run`).
- Bun (version not pinned in repo)
- Lockfile: `bun.lockb` expected (Bun-managed); `package.json` declares `"type": "module"`.

## Frameworks

- React 18.3.1 — UI for the new-tab dashboard (`src/dashboard/App.tsx`) and popup (`src/popup/App.tsx`). Uses `react-jsx` transform (no `React` import needed).
- Vite 5.4.2 — Build tool. Configured in `vite.config.ts`.
- @crxjs/vite-plugin 2.0.0-beta.28 — Bundles the extension manifest and produces browser-specific builds (`dist/chrome/`, `dist/firefox/`).
- Tailwind CSS 3.4.10 — Utility-first styling for popup and dashboard (`tailwind.config.ts`, `postcss.config.js`).
- @huggingface/transformers 3.7.5 — Client-side ML inference (ONNX Runtime Web) for the correlation engine. Runs in a Web Worker (`src/workers/ml-worker.ts`).
- Vitest 2.0.5 — Unit tests (`tests/unit/`), configured inline in `vite.config.ts` (`test` block, jsdom environment).
- @playwright/test 1.62.1 — E2E tests (`tests/e2e/`) and screenshot generation (`tests/screenshots/` via `playwright.screenshots.config.ts`).
- jsdom 30.0.1 — DOM environment for Vitest unit tests.
- TypeScript 5.5.4 — Type checking (`tsc --noEmit`).
- ESLint 8.57.0 — Linting (`@typescript-eslint`, `react`, `react-hooks` plugins). Config in `.eslintrc.cjs`.
- Prettier 3.3.3 — Formatting. Config in `.prettierrc`.
- PostCSS 8.4.41 + Autoprefixer 10.4.19 — CSS processing pipeline.
- sirv-cli 3.0.1 — Static file server used by Playwright `webServer` to serve the built extension.
- Hugo — Documentation site generator (`docs/hugo.toml`), built via `docs:build` script.

## Key Dependencies

- `@huggingface/transformers` ^3.7.5 — Powers the ML correlation engines (embedding, sentiment, zero-shot, NER, LLM). Models downloaded from Hugging Face Hub on first use and cached via the browser Cache API. ONNX Runtime Web WASM files bundled locally in `public/wasm/`.
- `react` / `react-dom` ^18.3.1 — UI for dashboard and popup.
- `webextension-polyfill` ^0.12.0 — Cross-browser WebExtension API wrapper. Re-exported from `src/messaging/browser.ts`; all modules import `browser` from there.
- `@crxjs/vite-plugin` ^2.0.0-beta.28 — Manifest generation and HMR-aware extension bundling.
- `@types/chrome` ^0.0.270 and `@types/firefox-webext-browser` ^120.0.4 — Type definitions for both browser APIs.
- `@types/webextension-polyfill` ^0.12.1 — Types for the polyfill.

## Configuration

- No `.env` files present. No API keys required — the extension is 100% client-side and uses public endpoints plus the user's own browser sessions.
- Build-time env vars: `TARGET=firefox` switches the build to Firefox (background `scripts` instead of `service_worker`). `import.meta.env.IS_FIREFOX` and `import.meta.env.BUILD_VERSION` are injected via Vite `define` in `vite.config.ts`.
- `vite.config.ts` — Vite + CRX plugin config, per-browser `outDir`, path alias `@` → `src`, worker bundling.
- `tsconfig.json` — Strict TS config with path aliases `@/*` → `src/*` and `@types/*` → `src/types/*`.
- `src/manifest.config.ts` — Single source of truth for the MV3 manifest, consumed by @crxjs/vite-plugin.
- `src/config/index.ts` — Centralised runtime config (scrape URLs, storage keys, collection intervals, ML model lists).
- `tailwind.config.ts`, `postcss.config.js` — Styling pipeline.
- `playwright.config.ts`, `playwright.screenshots.config.ts` — E2E and screenshot test configs.
- `docs/hugo.toml` — Documentation site config.

## Platform Requirements

- Bun (package manager + script runner).
- Node.js (for `@types/node` and tooling).
- Chrome or Firefox for running the built extension.
- Playwright browsers (`bunx playwright install chromium`) for E2E/screenshot tests.
- Chrome (MV3) and Firefox (MV3, `strict_min_version: 121.0`) — packaged as `.zip` (Chrome) and `.xpi` (Firefox) via `zip`/`zip:chrome`/`zip:firefox` scripts.
- Documentation hosted on GitHub Pages at `https://ozkanpakdil.github.io/TrendCast/`.

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Naming Patterns

- kebab-case for utility/service/type files: `conditional-fetch.ts`, `rate-limiter.ts`, `x-trends.ts`, `ml-worker.ts`
- PascalCase for React component files: `CorrelationPanel.tsx`, `HistoryChart.tsx`, `MarketOdds.tsx`
- `index.ts` used as barrel/entry file within directories: `src/services/collectors/index.ts`, `src/content/news/index.ts`
- Test files use `.test.ts` suffix: `tests/unit/correlation.test.ts`
- E2E specs use `.spec.ts` suffix: `tests/e2e/dashboard.spec.ts`
- camelCase for all functions: `extractKeywords`, `keywordSimilarity`, `collectPolymarketMarkets`, `normaliseGammaMarket`
- Exported functions are the public API of a module; private helpers are module-scoped (not exported): `normaliseGammaMarket` in `src/services/collectors/polymarket.ts`, `csvEscape` in `src/utils/export.ts`
- React hooks prefixed with `use`: `useSettings`, `useSnapshot`, `useCorrelations`, `useCachedMarkets`
- camelCase for local variables and parameters: `const matches`, `const cache`
- Module-level constants in UPPER_SNAKE_CASE: `STOP_WORDS`, `MIN_CONFIDENCE`, `MAX_NODES`, `MAX_EDGES`, `REPULSION`, `BUDGET_KEYS`
- Boolean flags use `is`/`has`/`can` prefixes: `isFirefox`, `canRequest`, `hasText`
- PascalCase for interfaces and type aliases: `MarketContract`, `SocialSignal`, `CorrelationMatch`, `ExtensionSettings`
- Props interfaces named `<Component>Props`: `CorrelationPanelProps`, `SettingsProps`
- Discriminated unions for message types: `Message` in `src/types/index.ts` (line 368)
- Type-only imports use `import type`: `import type { MarketContract, SocialSignal } from '@/types'`
- `Record<...>` for keyed maps: `Record<NodeType, { x: number; y: number }>`, `Record<string, string>`

## Code Style

- Prettier 3.3.3 (`.prettierrc`)
- Key settings: `semi: true`, `singleQuote: true`, `trailingComma: 'all'`, `printWidth: 100`, `tabWidth: 2`, `arrowParens: 'always'`
- Format command: `bun run format` (writes `src/**/*.{ts,tsx,css,md}`)
- ESLint 8.57.0 (`.eslintrc.cjs`)
- Extends: `eslint:recommended`, `@typescript-eslint/recommended`, `react/recommended`, `react-hooks/recommended`
- Key rules:
- Lint command: `bun run lint` (enforces `--max-warnings 0` — zero warnings allowed)
- `ignorePatterns`: `dist`, `node_modules`, `*.config.ts`, `tests/screenshots`, `scripts`

## Import Organization

- `@/*` → `src/*` (configured in `tsconfig.json` `paths` and `vite.config.ts` `resolve.alias`)
- `@types/*` → `src/types/*`
- Always use `@/` aliases — never relative imports like `../../utils/keywords`

## Error Handling

- `try/catch` around async storage/messaging operations, with `console.error` in the catch block: `src/popup/hooks/useSnapshot.ts`, `src/messaging/index.ts`
- `finally` block for resetting loading state: `setCollecting(false)` in `src/popup/hooks/useSnapshot.ts`
- Error messages prefixed with `[TrendCast]`: `console.error('[TrendCast] Failed to fetch snapshot:', err)`
- `err instanceof Error ? err.message : String(err)` for safe error stringification: `src/messaging/index.ts`
- Type guards for null filtering: `.filter((m): m is MarketContract => m !== null)` in `src/services/collectors/polymarket.ts`
- Functions return `null` to signal "no change"/"not found" rather than throwing: `conditionalFetch` returns `null` on 304, `normaliseGammaMarket` returns `null` on parse failure

## Logging

- All log messages prefixed with `[TrendCast]`: `console.log('[TrendCast] Polymarket: 304, skipping')`
- `console.debug` for verbose/algorithmic detail: `src/services/engine/correlation.ts`
- `console.warn` for recoverable issues (retries, pruning): `src/messaging/index.ts`, `src/utils/storage.ts`
- `console.error` for failures with the error object as second arg
- Log at module boundaries (collector start/end counts, worker init) rather than inside hot loops

## Comments

- Every module file starts with a JSDoc block explaining purpose, architecture, and pitfalls
- `⚠️ Pitfall:` markers call out MV3 service-worker and cross-browser gotchas: `src/background/index.ts`, `src/messaging/browser.ts`, `src/content/news/index.ts`
- `Phase N:` markers track which development phase introduced a feature: `src/utils/storage.ts`, `src/utils/conditional-fetch.ts`
- Section dividers `// ── Section ──` group related code: `src/types/index.ts`, `src/dashboard/components/CorrelationPanel.tsx`
- ASCII diagrams for architecture/layout: `src/messaging/index.ts`, `src/dashboard/App.tsx`
- Every exported function has a `/** ... */` doc block with `@param`/`@returns` where non-obvious: `src/utils/conditional-fetch.ts`, `src/utils/storage.ts`
- Every exported interface documents each field with `/** ... */`: `src/types/index.ts`
- Module-level doc blocks describe the file's responsibility and algorithm

## Function Design

## Module Design

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## System Overview

```text

```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Background worker | Orchestrates collection, correlation, storage; registers all listeners synchronously | `src/background/index.ts` |
| Config | Centralised URLs, intervals, storage keys, budgets, model IDs | `src/config/index.ts` |
| Messaging | Type-safe discriminated-union message layer with retry + async-response handling | `src/messaging/index.ts`, `src/messaging/browser.ts` |
| Collectors | Fetch/normalise data from public endpoints (Polymarket Gamma, Kalshi v2, Reddit .json, RSS via rss2json) | `src/services/collectors/*.ts` |
| Correlation engine | Heuristic NER + keyword matching | `src/services/engine/correlation.ts` |
| ML engines | Embedding/sentiment/zeroshot/NER/LLM correlation via Transformers.js | `src/services/engine/ml/*.ts` |
| ML Web Worker | Runs ML inference off main thread to avoid Firefox "Stop the script" | `src/workers/ml-worker.ts` |
| Content scripts | Scrape DOM on supported sites, report via messages | `src/content/{news,prediction-markets,socials}/index.ts` |
| Dashboard | New-tab React app (primary UI) | `src/dashboard/` |
| Popup | Quick-launcher React app | `src/popup/` |
| Utils | Keywords, entities, sentiment, export, storage budget, rate limiter, conditional fetch | `src/utils/*.ts` |
| Types | Shared domain types + Message discriminated union | `src/types/index.ts` |

## Pattern Overview

- **Storage as the source of truth** — all durable state lives in `chrome.storage.local`; the UI reads snapshots directly from storage and subscribes to `onChanged` events rather than holding in-memory state.
- **Typed message passing** — a discriminated union `Message` type (`src/types/index.ts:368`) drives type-safe `sendMessage`/`onMessage` across contexts.
- **Ephemeral worker awareness** — the MV3 service worker can be killed at any time; code uses `chrome.alarms` (not `setInterval`) and never relies on module-level state persisting.
- **Client-side ML** — Transformers.js + ONNX Runtime Web run models locally in a Web Worker; no LLM API calls.
- **Cross-browser build** — `TARGET=firefox` env var switches the manifest background key and output dir.

## Layers

- Purpose: Render collected data and trigger actions
- Location: `src/dashboard/`, `src/popup/`
- Contains: React components, hooks, CSS
- Depends on: `src/messaging/`, `src/config/`, `src/types/`, `chrome.storage`
- Used by: Browser (new tab override, toolbar popup)
- Purpose: Type-safe cross-context communication
- Location: `src/messaging/`
- Contains: `sendMessage`, `sendTabMessage`, `onMessage`, `browser` polyfill re-export
- Depends on: `src/types/` (Message union), `webextension-polyfill`
- Used by: UI, content scripts, background
- Purpose: collection scheduling, message handling, correlation dispatch, ML worker management
- Location: `src/background/index.ts`
- Contains: alarm setup, message handlers, collection logic, correlation runners, ML worker pool
- Depends on: `src/services/`, `src/messaging/`, `src/config/`, `src/types/`, `src/utils/`
- Used by: UI (via messages), content scripts (via messages)
- Purpose: data collection and correlation logic
- Location: `src/services/collectors/`, `src/services/engine/`
- Contains: platform collectors, heuristic + ML correlation engines
- Depends on: `src/config/`, `src/types/`, `src/utils/`, `@huggingface/transformers`
- Used by: background worker, ML worker
- Purpose: DOM scraping on supported sites
- Location: `src/content/`
- Contains: news, prediction-markets, socials scrapers
- Depends on: `src/messaging/`, `src/config/`, `src/types/`, `src/utils/`
- Used by: injected into pages per manifest `content_scripts`
- Purpose: durable state
- Location: `chrome.storage.local` (keys in `src/config/index.ts`)
- Contains: snapshots, collected data, correlations, history, watchlist, settings
- Used by: all layers

## Data Flow

### Primary Collection Path

### Content Script → Background Path

### Correlation Request Path

- All durable state in `chrome.storage.local` (keys in `src/config/index.ts`)
- UI hooks subscribe to `chrome.storage.onChanged` to react to background updates
- No global in-memory store; the background worker holds only transient ML worker references

## Key Abstractions

- Purpose: type-safe contract for all cross-context communication
- Examples: `src/types/index.ts` (lines 368–410)
- Pattern: `{ type: '...'; payload: ... }` union; `MessageType = Message['type']`
- Purpose: normalise external data into domain types (`MarketContract`, `SocialSignal`, `NewsItem`)
- Examples: `src/services/collectors/polymarket.ts`, `kalshi.ts`, `reddit.ts`, `x-trends.ts`, `news.ts`
- Pattern: `collectX(): Promise<DomainType[]>` using `conditionalFetchJson`
- Purpose: match signals/news to markets with a confidence score
- Examples: `src/services/engine/correlation.ts` (heuristic), `src/services/engine/ml/*.ts` (ML)
- Pattern: `correlate*` functions returning `CorrelationResult`
- Purpose: encapsulate storage reads + message sends for the UI
- Examples: `src/dashboard/hooks/useSnapshot.ts`, `useCorrelations.ts`, `src/popup/hooks/useSettings.ts`, `useCachedMarkets.ts`
- Pattern: read from storage on mount, subscribe to `chrome.storage.onChanged`

## Entry Points

- Location: `src/background/index.ts`
- Triggers: extension install/update, `chrome.alarms`, runtime messages
- Responsibilities: register listeners synchronously, run collection, run correlation, manage ML worker
- Location: `src/dashboard/index.tsx` → `src/dashboard/App.tsx`
- Triggers: user opens a new tab (via `chrome_url_overrides.newtab` in `src/manifest.config.ts`)
- Responsibilities: render full-page React app
- Location: `src/popup/index.tsx` → `src/popup/App.tsx`
- Triggers: user clicks the toolbar icon (via `action.default_popup` in `src/manifest.config.ts`)
- Responsibilities: quick-launcher with settings, collect button, stats
- Location: `src/content/{news,prediction-markets,socials}/index.ts`
- Triggers: page load on matching domains (manifest `content_scripts`)
- Responsibilities: DOM scraping + reporting
- Location: `src/workers/ml-worker.ts`
- Triggers: spawned by background when an ML engine is selected
- Responsibilities: run ML inference off main thread, post progress/results

## Architectural Constraints

- **Threading:** Single-threaded event loop for the background worker. ML inference is offloaded to a dedicated Web Worker (`src/workers/ml-worker.ts`) to avoid blocking the main thread and the Firefox "Stop the script" dialog. The worker is created on demand and terminated after 5 min idle (`ML_WORKER_IDLE_TIMEOUT_MS` in `src/background/index.ts`).
- **Global state:** The background worker holds transient module-level ML state (`mlWorker`, `mlWorkerResolvers`, `mlWorkerTimeout` in `src/background/index.ts`). This is intentionally non-durable — the MV3 worker may be killed at any time. `src/utils/conditional-fetch.ts` keeps an in-memory `cacheMemory` mirror of the fetch cache. `src/services/engine/correlation.ts` uses an `EntityCache` class instance for NER caching.
- **Circular imports:** None detected. The dependency graph is acyclic: `types` → `config` → `utils` → `services` → `background`; `messaging` is a leaf used by all.
- **Ephemeral worker:** Never use `setInterval` for long-running polling; use `chrome.alarms`. Never rely on module-level state persisting; use `chrome.storage.local`.
- **Cross-browser:** Firefox does not support `background.service_worker`; the manifest switches to `background.scripts` based on `TARGET=firefox` (`src/manifest.config.ts`). Firefox also lacks `chrome.sidePanel`, so the extension uses popup + new tab override.
- **Content script isolation:** Content scripts run in an isolated world and can only read the DOM, not page JS variables.

## Anti-Patterns

### Fire-and-forget long-running message handlers

### In-memory rate limiter in an ephemeral worker

## Error Handling

- Collectors return empty arrays on failure rather than throwing (e.g., `collectNews` uses `Promise.allSettled` and filters rejected results).
- `conditionalFetchJson` returns `null` on 304 Not Modified so collectors skip unchanged data.
- Messaging layer retries once on Firefox "out of scope" / "message channel closed" errors (`src/messaging/index.ts`).
- ML correlation failures return a result with an `error` message and `engine` set to `'heuristic'` with empty arrays — the UI is responsible for surfacing the error.

## Cross-Cutting Concerns

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.github/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
