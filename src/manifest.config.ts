import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json';

/**
 * HypeMarket — Manifest V3 configuration.
 *
 * This is the single source of truth for the extension manifest.
 * @crxjs/vite-plugin consumes this at build time and emits a valid
 * `manifest.json` into `dist/`.
 *
 * ── Cross-browser notes ──────────────────────────────────────────
 * Chrome (MV3):
 *   • Background uses `service_worker` (non-persistent, ephemeral).
 *   • `chrome.action` for the toolbar icon.
 *
 * Firefox (MV3 — supported since Firefox 109+):
 *   • Background can use `service_worker` (Firefox 121+) OR `scripts`
 *     for older versions. We emit `scripts` as a fallback at build time
 *     (see vite.config.ts `TARGET=firefox`).
 *   • `browser_action` is the legacy key; MV3 uses `action` in both.
 *
 * ⚠️ Pitfall: Firefox does not support `chrome.sidePanel`. We avoid it
 *    and use a popup instead for cross-browser parity.
 *
 * ⚠️ Pitfall: `host_permissions` are separate from `permissions` in MV3.
 *    Keep them separate so users see clear consent prompts on install.
 * ─────────────────────────────────────────────────────────────────
 */
export default defineManifest({
  manifest_version: 3,
  name: pkg.displayName ?? 'HypeMarket',
  description: pkg.description,
  version: pkg.version,

  // Toolbar icon + popup
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'HypeMarket — Sentiment × Markets',
    default_icon: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    },
  },

  icons: {
    '16': 'icons/icon-16.png',
    '32': 'icons/icon-32.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png',
  },

  // ── Background ────────────────────────────────────────────────
  // Chrome MV3: service_worker (ephemeral, may be killed at any time).
  // Firefox MV3: we inject `scripts` fallback at build time.
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },

  // ── Content Scripts ────────────────────────────────────────────
  // Split by domain group so we only inject what's needed.
  content_scripts: [
    {
      // Prediction markets — read contract context from the page
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
      // Social platforms — inject odds overlays
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
  ],

  // ── Permissions ────────────────────────────────────────────────
  // Minimal permissions principle: only request what we actually use.
  permissions: [
    'storage', // persist settings, cached odds, correlation state
    'alarms', // scheduled polling (replaces setInterval in MV3)
    'tabs', // detect active tab URL for context-aware injection
    'scripting', // programmatic content script injection (if needed)
    'notifications', // alert user on high-sentiment spikes
  ],

  // Host permissions — declared separately per MV3 spec.
  // ⚠️ These trigger user consent prompts on install.
  host_permissions: [
    // Prediction market APIs
    'https://*.polymarket.com/*',
    'https://clob.polymarket.com/*',
    'https://*.kalshi.com/*',
    'https://api.kalshi.com/*',
    // Social APIs (where applicable — X requires bearer token)
    'https://api.twitter.com/*',
    'https://*.x.com/*',
    'https://www.reddit.com/*',
    'https://oauth.reddit.com/*',
    'https://www.tiktok.com/*',
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
      id: 'hypemarket@trendcast.dev',
      strict_min_version: '121.0',
    },
  },
});