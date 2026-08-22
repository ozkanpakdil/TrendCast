# Technology Stack

**Analysis Date:** 2026-08-22

## Languages

**Primary:**
- TypeScript 5.5.4 - All source code in `src/`, tests in `tests/`, and build scripts in `scripts/`. Strict mode enabled. `tsconfig.json` targets ES2022 with `moduleResolution: "bundler"`.

**Secondary:**
- CSS - Styling via Tailwind CSS utility classes plus hand-written CSS files (`src/content/socials/overlay.css`, `src/popup/popup.css`, `src/dashboard/dashboard.css`).
- HTML - Entry points for the popup and dashboard (`src/popup/index.html`, `src/dashboard/index.html`).
- Markdown - Documentation site content in `docs/content/`.

## Runtime

**Environment:**
- Browser extension (Manifest V3) — runs in Chrome and Firefox. No Node.js server runtime; all logic executes client-side in the browser.
- Bun is the package manager and script runner (all `package.json` scripts invoke `bun run`).

**Package Manager:**
- Bun (version not pinned in repo)
- Lockfile: `bun.lockb` expected (Bun-managed); `package.json` declares `"type": "module"`.

## Frameworks

**Core:**
- React 18.3.1 — UI for the new-tab dashboard (`src/dashboard/App.tsx`) and popup (`src/popup/App.tsx`). Uses `react-jsx` transform (no `React` import needed).
- Vite 5.4.2 — Build tool. Configured in `vite.config.ts`.
- @crxjs/vite-plugin 2.0.0-beta.28 — Bundles the extension manifest and produces browser-specific builds (`dist/chrome/`, `dist/firefox/`).
- Tailwind CSS 3.4.10 — Utility-first styling for popup and dashboard (`tailwind.config.ts`, `postcss.config.js`).
- @huggingface/transformers 3.7.5 — Client-side ML inference (ONNX Runtime Web) for the correlation engine. Runs in a Web Worker (`src/workers/ml-worker.ts`).

**Testing:**
- Vitest 2.0.5 — Unit tests (`tests/unit/`), configured inline in `vite.config.ts` (`test` block, jsdom environment).
- @playwright/test 1.62.1 — E2E tests (`tests/e2e/`) and screenshot generation (`tests/screenshots/` via `playwright.screenshots.config.ts`).
- jsdom 30.0.1 — DOM environment for Vitest unit tests.

**Build/Dev:**
- TypeScript 5.5.4 — Type checking (`tsc --noEmit`).
- ESLint 8.57.0 — Linting (`@typescript-eslint`, `react`, `react-hooks` plugins). Config in `.eslintrc.cjs`.
- Prettier 3.3.3 — Formatting. Config in `.prettierrc`.
- PostCSS 8.4.41 + Autoprefixer 10.4.19 — CSS processing pipeline.
- sirv-cli 3.0.1 — Static file server used by Playwright `webServer` to serve the built extension.
- Hugo — Documentation site generator (`docs/hugo.toml`), built via `docs:build` script.

## Key Dependencies

**Critical:**
- `@huggingface/transformers` ^3.7.5 — Powers the ML correlation engines (embedding, sentiment, zero-shot, NER, LLM). Models downloaded from Hugging Face Hub on first use and cached via the browser Cache API. ONNX Runtime Web WASM files bundled locally in `public/wasm/`.
- `react` / `react-dom` ^18.3.1 — UI for dashboard and popup.
- `webextension-polyfill` ^0.12.0 — Cross-browser WebExtension API wrapper. Re-exported from `src/messaging/browser.ts`; all modules import `browser` from there.

**Infrastructure:**
- `@crxjs/vite-plugin` ^2.0.0-beta.28 — Manifest generation and HMR-aware extension bundling.
- `@types/chrome` ^0.0.270 and `@types/firefox-webext-browser` ^120.0.4 — Type definitions for both browser APIs.
- `@types/webextension-polyfill` ^0.12.1 — Types for the polyfill.

## Configuration

**Environment:**
- No `.env` files present. No API keys required — the extension is 100% client-side and uses public endpoints plus the user's own browser sessions.
- Build-time env vars: `TARGET=firefox` switches the build to Firefox (background `scripts` instead of `service_worker`). `import.meta.env.IS_FIREFOX` and `import.meta.env.BUILD_VERSION` are injected via Vite `define` in `vite.config.ts`.

**Build:**
- `vite.config.ts` — Vite + CRX plugin config, per-browser `outDir`, path alias `@` → `src`, worker bundling.
- `tsconfig.json` — Strict TS config with path aliases `@/*` → `src/*` and `@types/*` → `src/types/*`.
- `src/manifest.config.ts` — Single source of truth for the MV3 manifest, consumed by @crxjs/vite-plugin.
- `src/config/index.ts` — Centralised runtime config (scrape URLs, storage keys, collection intervals, ML model lists).
- `tailwind.config.ts`, `postcss.config.js` — Styling pipeline.
- `playwright.config.ts`, `playwright.screenshots.config.ts` — E2E and screenshot test configs.
- `docs/hugo.toml` — Documentation site config.

## Platform Requirements

**Development:**
- Bun (package manager + script runner).
- Node.js (for `@types/node` and tooling).
- Chrome or Firefox for running the built extension.
- Playwright browsers (`bunx playwright install chromium`) for E2E/screenshot tests.

**Production:**
- Chrome (MV3) and Firefox (MV3, `strict_min_version: 121.0`) — packaged as `.zip` (Chrome) and `.xpi` (Firefox) via `zip`/`zip:chrome`/`zip:firefox` scripts.
- Documentation hosted on GitHub Pages at `https://ozkanpakdil.github.io/TrendCast/`.

---

*Stack analysis: 2026-08-22*
