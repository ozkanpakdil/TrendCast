/**
 * Debug page relay — lets the background worker inspect/drive this page.
 *
 * ⚠️ DEBUG-ONLY. Imported dynamically by the dashboard/popup entry points
 * behind `import.meta.env.DEBUG_LOG_FORWARD`, so production bundles never
 * include it (the dynamic import is dead-code-eliminated when the define
 * is `false`).
 *
 * Why this exists: Firefox refuses `scripting.executeScript` into
 * moz-extension:// pages ("Missing host permissions for the tab") — host
 * permissions never match extension origins. But the worker CAN message
 * its own pages via `tabs.sendMessage`, and a page can inspect its own
 * DOM in its privileged context. This relay closes that gap:
 *
 *   worker (debug RPC) ──tabs.sendMessage──► page relay ──DOM──► result
 *
 * Commands are structured (no eval — Firefox MV3 CSP forbids 'unsafe-eval'
 * in extension_pages, so arbitrary JS is impossible in ANY build):
 *
 *   text  — full page text (innerText) for content assertions
 *   dom   — querySelectorAll info: tag, text, visible, count
 *   click — synthetic click (works for React handlers)
 *
 * Results are JSON-serializable by construction.
 */

import { browser } from '@/messaging/browser';

/** Marker so the relay ignores messages not meant for it. */
const RELAY_MARKER = '__trendcastDebugRelay';

/** Commands the worker can send to a page's relay. */
type RelayCommand =
  | { kind: 'text' }
  | { kind: 'dom'; selector: string; text: string | null }
  | { kind: 'click'; selector: string; text: string | null };

/** Install the relay listener. Called once from a page entry point. */
export function setupDebugRelay(): void {
  const listener = (
    message: unknown,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _sender: unknown,
    sendResponse: (response: unknown) => void,
  ): boolean | undefined => {
    if (
      typeof message !== 'object' ||
      message === null ||
      (message as Record<string, unknown>)[RELAY_MARKER] !== true
    ) {
      return undefined; // not ours — let other listeners handle it
    }
    const cmd = (message as { payload: RelayCommand }).payload;
    void (async () => {
      try {
        switch (cmd.kind) {
          case 'text': {
            sendResponse({ ok: true, value: document.body.innerText });
            return;
          }
          case 'dom': {
            const els = [...document.querySelectorAll(cmd.selector)] as HTMLElement[];
            const textFilter = cmd.text;
            const filtered = textFilter ? els.filter((e) => (e.textContent ?? '').includes(textFilter)) : els;
            sendResponse({
              ok: true,
              value: {
                count: filtered.length,
                items: filtered.slice(0, 20).map((e) => ({
                  tag: e.tagName.toLowerCase(),
                  text: (e.textContent ?? '').trim().slice(0, 120),
                  visible: e.offsetParent !== null,
                })),
              },
            });
            return;
          }
          case 'click': {
            const els = [...document.querySelectorAll(cmd.selector)] as HTMLElement[];
            const textFilter = cmd.text;
            const el = textFilter ? els.find((e) => (e.textContent ?? '').includes(textFilter)) : els[0];
            if (!el) {
              sendResponse({ ok: true, value: { clicked: false, available: els.length } });
            } else {
              el.click();
              sendResponse({
                ok: true,
                value: { clicked: true, text: (el.textContent ?? '').trim().slice(0, 120) },
              });
            }
            return;
          }
        }
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return true; // keep the channel open for the async response
  };

  // Cast: same polyfill listener-typing workaround as src/messaging/index.ts.
  browser.runtime.onMessage.addListener(
    listener as Parameters<typeof browser.runtime.onMessage.addListener>[0],
  );
}