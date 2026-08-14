import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'node:path';
import manifest from './src/manifest.config';

/**
 * Vite configuration for HypeMarket.
 *
 * Uses @crxjs/vite-plugin for HMR-aware extension bundling.
 * The `TARGET` env var switches between Chrome (MV3) and Firefox (MV3 via polyfill).
 *
 * ⚠️ Pitfall: Firefox does not yet fully support MV3 service workers.
 *    We use `background.scripts` fallback for Firefox and `service_worker` for Chrome.
 *    The webextension-polyfill normalises the API surface in both.
 */
export default defineConfig(({ mode }) => {
  const isFirefox = process.env.TARGET === 'firefox';

  return {
    plugins: [crx({ manifest })],
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
    },
    server: {
      port: 5173,
      strictPort: true,
      hmr: {
        port: 5174,
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
    },
  };
});