/**
 * Cross-browser WebExtension API polyfill setup.
 *
 * `webextension-polyfill` wraps `chrome.*` and `browser.*` into a single
 * promise-based `browser` object. We re-export it so every module imports
 * from one place.
 *
 * ⚠️ Pitfall: In MV3 service workers, `chrome` is available globally but
 *    `browser` (the polyfill) must be imported. Always import from here,
 *    never use the raw `chrome` global directly.
 *
 * Usage:
 *   import { browser } from '@/messaging/browser';
 *   await browser.storage.local.set({ foo: 'bar' });
 */

import webextensionPolyfill from 'webextension-polyfill';

// In Chrome, the polyfill wraps `chrome`. In Firefox, `browser` is native
// and the polyfill is a no-op passthrough.
export const browser = webextensionPolyfill;

export type Browser = typeof webextensionPolyfill;