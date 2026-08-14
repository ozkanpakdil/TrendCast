import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json';

/**
 * TrendCast — Manifest V3 configuration.
 *
 * This is the single source of truth for the extension manifest.
 * @crxjs/vite-plugin consumes this at build time and emits a valid
 * `manifest.json` into `dist/`.
 *
 * ── Cross-browser notes ──────────────────────────────────────────
 * Chrome (MV3):
 *   • Background uses `service_worker` (non-persistent, ephemeral).
 *   • `chrome.action` for the toolbar icon (quick-launcher popup).
 *   • `chrome_url_overrides` replaces the new tab page with our dashboard.
 *
 * Firefox (MV3 — supported since Firefox 109+):
 *   • Background uses `scripts` (event page). Firefox does NOT support
 *     `background.service_worker` — it must be `background.scripts`.
 *     We switch at build time based on `TARGET=firefox` env var.
 *   • `browser_action` is the legacy key; MV3 uses `action` in both.
 *   • `chrome_url_overrides` is supported in Firefox.
 *
 * ⚠️ Pitfall: Firefox does not support `chrome.sidePanel`. We avoid it
 *    and use a popup + new tab override for cross-browser parity.
 *
 * ⚠️ Pitfall: `host_permissions` are separate from `permissions` in MV3.
 *    Keep them separate so users see clear consent prompts on install.
 *
 * ── Client-side architecture ─────────────────────────────────────
 * No API keys. The extension uses the user's own browser sessions
 * to scrape data. Host permissions allow content scripts to run on
 * supported sites and allow the background worker to open background
 * tabs for hourly collection.
 * ─────────────────────────────────────────────────────────────────
 */

// Access process.env without requiring @types/node.
// The manifest config is imported by vite.config.ts and runs in Node/Bun,
// so process.env is available at build time. The cast avoids a tsc error
// since @types/node is not in our tsconfig types array.
declare const process: { env: Record<string, string | undefined> } | undefined;

const isFirefox =
  (typeof process !== 'undefined' && process.env?.TARGET === 'firefox') ?? false;

export default defineManifest({
  manifest_version: 3,
  name: pkg.displayName ?? 'TrendCast',
  description: pkg.description,
  version: pkg.version,

  // Toolbar icon + popup (quick-launcher)
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'TrendCast — Sentiment × Markets',
    default_icon: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    },
  },

  // ── New Tab Override ──────────────────────────────────────────
  // Replaces the browser's new tab page with the TrendCast dashboard.
  // This is the primary UI — users see all hypes, news, and correlated
  // market odds every time they open a new tab.
  //
  // ⚠️ Pitfall: `chrome_url_overrides.newtab` must point to an HTML file
  //    in the extension package. It runs in the extension's context
  //    (not a content script), so it has full access to extension APIs.
  chrome_url_overrides: {
    newtab: 'src/dashboard/index.html',
  },

  icons: {
    '16': 'icons/icon-16.png',
    '32': 'icons/icon-32.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png',
  },

  // ── Background ────────────────────────────────────────────────
  // Chrome MV3: service_worker (ephemeral, may be killed at any time).
  // Firefox MV3: scripts (event page). Firefox does NOT support
  //   background.service_worker — using it causes installation to fail
  //   with "background.service_worker is currently disabled. Add
  //   background.scripts." We switch based on TARGET env var.
  background: isFirefox
    ? {
        scripts: ['src/background/index.ts'],
      }
    : {
        service_worker: 'src/background/index.ts',
        type: 'module',
      },

  // ── Content Scripts ────────────────────────────────────────────
  // Split by domain group so we only inject what's needed.
  //
  // ⚠️ Pitfall: Content scripts run in an isolated world. They can read
  //    the DOM but cannot access page JavaScript variables. All scraping
  //    is DOM-based. The user's login session cookies are sent by the
  //    browser automatically — we don't handle credentials at all.
  content_scripts: [
    {
      // Prediction markets — scrape market data from the page DOM
      matches: [
        '*://polymarket.com/*',
        '*://*.polymarket.com/*',
        '*://kalshi.com/*',
        '*://*.kalshi.com/*',
      ],
      js: ['src/content/prediction-markets/index.ts'],
      run_at: 'document_idle',
    },
    {
      // Social platforms — scrape trending posts + inject odds overlays
      matches: [
        '*://x.com/*',
        '*://twitter.com/*',
        '*://reddit.com/*',
        '*://tiktok.com/*',
      ],
      js: ['src/content/socials/index.ts'],
      css: ['src/content/socials/overlay.css'],
      run_at: 'document_idle',
    },
    {
      // News sites — scrape headlines (no login required)
      matches: [
        '*://www.bbc.com/*',
        '*://bbc.com/*',
        '*://www.cnn.com/*',
        '*://cnn.com/*',
      ],
      js: ['src/content/news/index.ts'],
      run_at: 'document_idle',
    },
  ],

  // ── Permissions ────────────────────────────────────────────────
  // Minimal permissions principle: only request what we actually use.
  permissions: [
    'storage', // persist settings, collected data, correlation state
    'alarms', // scheduled hourly collection (replaces setInterval in MV3)
    'tabs', // open background tabs for collection, detect active tab URL
    'scripting', // programmatic content script injection for bg tab collection
  ],

  // Host permissions — declared separately per MV3 spec.
  // ⚠️ These trigger user consent prompts on install.
  // These allow content scripts to run on these sites AND allow the
  // background worker to open background tabs to these URLs for scraping.
  // The user's existing login sessions are used automatically — no API keys.
  host_permissions: [
    // Prediction markets (user's own session if logged in)
    'https://*.polymarket.com/*',
    'https://*.kalshi.com/*',
    'https://*.kalshi.co/*',
    // Social platforms (user's own session if logged in)
    'https://*.x.com/*',
    'https://*.twitter.com/*',
    'https://*.reddit.com/*',
    'https://*.tiktok.com/*',
    // News RSS feeds — fetched via rss2json.com CORS proxy
    'https://api.rss2json.com/*',
    'https://*.bbc.com/*',
    'https://*.cnn.com/*',
  ],

  // ── Web Accessible Resources ───────────────────────────────────
  // Needed if content scripts need to load assets (e.g., overlay icons).
  web_accessible_resources: [
    {
      resources: ['icons/*.png', 'assets/*.css'],
      matches: [
        '*://x.com/*',
        '*://twitter.com/*',
        '*://reddit.com/*',
        '*://tiktok.com/*',
        '*://polymarket.com/*',
        '*://kalshi.com/*',
        '*://bbc.com/*',
        '*://cnn.com/*',
      ],
    },
  ],

  // ── CSP ────────────────────────────────────────────────────────
  // MV3 default CSP is strict. We keep the default and do NOT relax it.
  // ⚠️ Pitfall: No `eval` or remote scripts allowed. All code must be
  //    bundled locally. This is fine for our React popup.
  content_security_policy: {
    extension_pages:
      "script-src 'self'; object-src 'self'; style-src 'self' 'unsafe-inline'",
  },

  // ── Cross-browser metadata ─────────────────────────────────────
  // Firefox-specific: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings
  browser_specific_settings: {
    gecko: {
      id: 'trendcast@trendcast.dev',
      strict_min_version: '121.0',
    },
  },
});