# Coding Conventions

**Analysis Date:** 2026-08-22

## Naming Patterns

**Files:**
- kebab-case for utility/service/type files: `conditional-fetch.ts`, `rate-limiter.ts`, `x-trends.ts`, `ml-worker.ts`
- PascalCase for React component files: `CorrelationPanel.tsx`, `HistoryChart.tsx`, `MarketOdds.tsx`
- `index.ts` used as barrel/entry file within directories: `src/services/collectors/index.ts`, `src/content/news/index.ts`
- Test files use `.test.ts` suffix: `tests/unit/correlation.test.ts`
- E2E specs use `.spec.ts` suffix: `tests/e2e/dashboard.spec.ts`

**Functions:**
- camelCase for all functions: `extractKeywords`, `keywordSimilarity`, `collectPolymarketMarkets`, `normaliseGammaMarket`
- Exported functions are the public API of a module; private helpers are module-scoped (not exported): `normaliseGammaMarket` in `src/services/collectors/polymarket.ts`, `csvEscape` in `src/utils/export.ts`
- React hooks prefixed with `use`: `useSettings`, `useSnapshot`, `useCorrelations`, `useCachedMarkets`

**Variables:**
- camelCase for local variables and parameters: `const matches`, `const cache`
- Module-level constants in UPPER_SNAKE_CASE: `STOP_WORDS`, `MIN_CONFIDENCE`, `MAX_NODES`, `MAX_EDGES`, `REPULSION`, `BUDGET_KEYS`
- Boolean flags use `is`/`has`/`can` prefixes: `isFirefox`, `canRequest`, `hasText`

**Types:**
- PascalCase for interfaces and type aliases: `MarketContract`, `SocialSignal`, `CorrelationMatch`, `ExtensionSettings`
- Props interfaces named `<Component>Props`: `CorrelationPanelProps`, `SettingsProps`
- Discriminated unions for message types: `Message` in `src/types/index.ts` (line 368)
- Type-only imports use `import type`: `import type { MarketContract, SocialSignal } from '@/types'`
- `Record<...>` for keyed maps: `Record<NodeType, { x: number; y: number }>`, `Record<string, string>`

## Code Style

**Formatting:**
- Prettier 3.3.3 (`.prettierrc`)
- Key settings: `semi: true`, `singleQuote: true`, `trailingComma: 'all'`, `printWidth: 100`, `tabWidth: 2`, `arrowParens: 'always'`
- Format command: `bun run format` (writes `src/**/*.{ts,tsx,css,md}`)

**Linting:**
- ESLint 8.57.0 (`.eslintrc.cjs`)
- Extends: `eslint:recommended`, `@typescript-eslint/recommended`, `react/recommended`, `react-hooks/recommended`
- Key rules:
  - `react/react-in-jsx-scope: 'off'` (React 18 JSX transform)
  - `react/prop-types: 'off'` (TypeScript handles props)
  - `@typescript-eslint/no-unused-vars: ['warn', { argsIgnorePattern: '^_' }]`
  - `@typescript-eslint/no-explicit-any: 'warn'`
- Lint command: `bun run lint` (enforces `--max-warnings 0` — zero warnings allowed)
- `ignorePatterns`: `dist`, `node_modules`, `*.config.ts`, `tests/screenshots`, `scripts`

## Import Organization

**Order:**
1. React / framework imports first: `import { useState, useRef, useEffect } from 'react'`
2. Playwright/test imports (in specs): `import { test, expect, type Page } from '@playwright/test'`
3. Internal `@/` imports grouped together: `import { CONFIG } from '@/config'`, `import { browser } from '@/messaging/browser'`
4. Type-only imports (`import type`) grouped separately from value imports

**Path Aliases:**
- `@/*` → `src/*` (configured in `tsconfig.json` `paths` and `vite.config.ts` `resolve.alias`)
- `@types/*` → `src/types/*`
- Always use `@/` aliases — never relative imports like `../../utils/keywords`

## Error Handling

**Patterns:**
- `try/catch` around async storage/messaging operations, with `console.error` in the catch block: `src/popup/hooks/useSnapshot.ts`, `src/messaging/index.ts`
- `finally` block for resetting loading state: `setCollecting(false)` in `src/popup/hooks/useSnapshot.ts`
- Error messages prefixed with `[TrendCast]`: `console.error('[TrendCast] Failed to fetch snapshot:', err)`
- `err instanceof Error ? err.message : String(err)` for safe error stringification: `src/messaging/index.ts`
- Type guards for null filtering: `.filter((m): m is MarketContract => m !== null)` in `src/services/collectors/polymarket.ts`
- Functions return `null` to signal "no change"/"not found" rather than throwing: `conditionalFetch` returns `null` on 304, `normaliseGammaMarket` returns `null` on parse failure

## Logging

**Framework:** `console` (no logging library)

**Patterns:**
- All log messages prefixed with `[TrendCast]`: `console.log('[TrendCast] Polymarket: 304, skipping')`
- `console.debug` for verbose/algorithmic detail: `src/services/engine/correlation.ts`
- `console.warn` for recoverable issues (retries, pruning): `src/messaging/index.ts`, `src/utils/storage.ts`
- `console.error` for failures with the error object as second arg
- Log at module boundaries (collector start/end counts, worker init) rather than inside hot loops

## Comments

**When to Comment:**
- Every module file starts with a JSDoc block explaining purpose, architecture, and pitfalls
- `⚠️ Pitfall:` markers call out MV3 service-worker and cross-browser gotchas: `src/background/index.ts`, `src/messaging/browser.ts`, `src/content/news/index.ts`
- `Phase N:` markers track which development phase introduced a feature: `src/utils/storage.ts`, `src/utils/conditional-fetch.ts`
- Section dividers `// ── Section ──` group related code: `src/types/index.ts`, `src/dashboard/components/CorrelationPanel.tsx`
- ASCII diagrams for architecture/layout: `src/messaging/index.ts`, `src/dashboard/App.tsx`

**JSDoc/TSDoc:**
- Every exported function has a `/** ... */` doc block with `@param`/`@returns` where non-obvious: `src/utils/conditional-fetch.ts`, `src/utils/storage.ts`
- Every exported interface documents each field with `/** ... */`: `src/types/index.ts`
- Module-level doc blocks describe the file's responsibility and algorithm

## Function Design

**Size:** Functions are kept focused on a single responsibility. Complex logic is split into named helpers (e.g., `normaliseGammaMarket`, `cachedEntitySimilarity`, `computeRunStats`).

**Parameters:** Named parameters via destructured objects for 3+ args: `correlate(signals, contracts)`, `computeRunStats(result, engine, model, elapsed, signalCount, contractCount, newsCount)`. Optional params have defaults: `collectPolymarketMarkets(limit = 100)`.

**Return Values:** Explicit return types on all exported functions. Functions return `null`/`[]` for empty results rather than throwing. Async functions return `Promise<T>`.

## Module Design

**Exports:** Named exports only (no default exports). Barrel files re-export from submodules: `src/services/collectors/index.ts` re-exports all collectors.

**Barrel Files:** Used for grouping related modules: `src/services/collectors/index.ts`, `src/messaging/index.ts`. The `@/` alias points at the directory index.

**Type-only imports:** Use `import type` for all type imports to enable `isolatedModules` and tree-shaking.

**Constants:** Module-level `const` objects for configuration (`CONFIG` in `src/config/index.ts`), `Set` for lookup tables (`STOP_WORDS`, `POSITIVE_WORDS`), and `Record` for label/color maps (`ZONE_CENTERS`, `NODE_COLORS` in `src/dashboard/components/CorrelationPanel.tsx`).

**React components:** Function components with `interface XxxProps`. Hooks use `useCallback` for stable references and `useEffect` for side effects. State updates use functional form: `setSettings((prev) => ({ ...prev, ...partial }))`.

**Discriminated unions:** Messaging uses a discriminated union `Message` type with `MessageType = Message['type']` for type-safe `sendMessage`: `src/types/index.ts`, `src/messaging/index.ts`.

---

*Convention analysis: 2026-08-22*
