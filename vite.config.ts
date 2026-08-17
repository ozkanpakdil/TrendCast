import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'node:path';
import manifest from './src/manifest.config';

/**
 * Vite configuration for TrendCast.
 *
 * Uses @crxjs/vite-plugin for HMR-aware extension bundling.
 * The `TARGET` env var switches between Chrome (MV3) and Firefox (MV3 via polyfill).
 *
 * ⚠️ Pitfall: Firefox does not support `background.service_worker` in MV3.
 *    We use `background.scripts` (event page) for Firefox and `service_worker`
 *    for Chrome. The manifest.config.ts handles this switch based on TARGET.
 *
 * ⚠️ Pitfall: @crxjs/vite-plugin injects `use_dynamic_url` into
 *    `web_accessible_resources` by default. Firefox doesn't support this
 *    property and warns on load. Passing `browser: 'firefox'` to the crx()
 *    plugin makes it strip the property automatically.
 */
export default defineConfig(({ mode }) => {
  const isFirefox = process.env.TARGET === 'firefox';

  return {
    plugins: [crx({ manifest, browser: isFirefox ? 'firefox' : 'chrome' })],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: mode === 'development',
      target: 'es2022',
      rollupOptions: {
        // Ensure the polyfill is bundled (not externalised)
        external: [],
      },
    },
    define: {
      // Allows code to branch on browser at build time
      'import.meta.env.IS_FIREFOX': JSON.stringify(isFirefox),
      // Build-time version stamp so users can verify they're running the latest build.
      // Format: "0.1.0+2026-08-14T13:21:00Z" — version + build timestamp.
      'import.meta.env.BUILD_VERSION': JSON.stringify(
        `${process.env.npm_package_version ?? process.env.BUN_PACKAGE_VERSION ?? '0.0.0'}+${new Date().toISOString()}`,
      ),
    },
    server: {
      port: 5173,
      strictPort: true,
      hmr: {
        port: 5174,
      },
    },
    worker: {
      format: 'es',
    },
    test: {
      globals: true,
      environment: 'jsdom',
      // Exclude Playwright E2E tests from Vitest
      exclude: ['node_modules', 'dist', 'tests/e2e/**'],
    },
  };
});