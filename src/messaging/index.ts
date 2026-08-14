/**
 * Type-safe messaging layer for background ↔ content ↔ popup communication.
 *
 * Architecture:
 *   ┌─────────┐    runtime.sendMessage    ┌────────────┐    tabs.sendMessage    ┌─────────────────┐
 *   │  Popup  │ ──────────────────────────► │ Background │ ────────────────────► │  Content Script  │
 *   │  (UI)   │ ◄────────────────────────── │  (Worker)  │ ◄──────────────────── │  (DOM scraper)   │
 *   └─────────┘    runtime.onMessage       └────────────┘    tabs.onMessage      └─────────────────┘
 *
 * ⚠️ Pitfall: `chrome.runtime.sendMessage` from a content script goes to
 *    the background worker. To send FROM background TO a specific tab,
 *    use `chrome.tabs.sendMessage(tabId, msg)`.
 *
 * ⚠️ Pitfall: In MV3, the service worker can be killed between messages.
 *    Never rely on in-memory state persisting — always use chrome.storage.
 */

import { browser } from './browser';
import type { Message, MessageType } from '@/types';

/** Re-export Browser type for consumers that need it. */
export type { Browser } from './browser';

/** Send a message to the background worker (from popup or content script). */
export async function sendMessage<T extends MessageType>(
  type: T,
  payload: Extract<Message, { type: T }>['payload'],
): Promise<unknown> {
  // The polyfill's sendMessage has its own generic inference that conflicts
  // with our discriminated union. We cast the call to bypass the polyfill's
  // type inference — type safety is enforced at the call site via T.
  return (browser.runtime.sendMessage as (msg: unknown) => Promise<unknown>)({
    type,
    payload,
  });
}

/** Send a message to a specific tab's content script (from background). */
export async function sendTabMessage<T extends MessageType>(
  tabId: number,
  type: T,
  payload: Extract<Message, { type: T }>['payload'],
): Promise<unknown> {
  return (browser.tabs.sendMessage as (tabId: number, msg: unknown) => Promise<unknown>)(
    tabId,
    { type, payload },
  );
}

/**
 * Register a typed message handler.
 * Returns an unsubscribe function to remove the listener (important for
 * React useEffect cleanup in the popup).
 *
 * ⚠️ Pitfall: Always return `true` from `onMessage` if you intend to respond
 *    asynchronously. In MV3, the callback must return `true` to keep the
 *    message channel open for async `sendResponse`.
 */
export function onMessage<T extends MessageType>(
  type: T,
  handler: (
    payload: Extract<Message, { type: T }>['payload'],
    sender: Parameters<Parameters<typeof browser.runtime.onMessage.addListener>[0]>[1],
  ) => Promise<unknown> | unknown,
): () => void {
  const listener = (
    message: unknown,
    sender: Parameters<Parameters<typeof browser.runtime.onMessage.addListener>[0]>[1],
    sendResponse: (response: unknown) => void,
  ) => {
    if (typeof message !== 'object' || message === null || (message as Message).type !== type) return;

    // Cast payload: TypeScript can't narrow generic T on discriminated unions
    // at compile time — Extract<Message, { type: T }>['payload'] becomes an
    // intersection of all payloads instead of the correct single variant.
    // We've verified message.type === type at runtime, so the cast is safe.
    // Type safety is enforced at call sites via sendMessage's generic.
    const typedMessage = message as { type: T; payload: unknown };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Promise.resolve(handler(typedMessage.payload as any, sender))
      .then((result) => sendResponse({ ok: true, data: result }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));

    // Return true to signal async response (MV3 requirement).
    return true;
  };

  // Cast: the polyfill's OnMessageListener type expects `true` as the only
  // return type, but we also return undefined for non-matching messages.
  browser.runtime.onMessage.addListener(
    listener as Parameters<typeof browser.runtime.onMessage.addListener>[0],
  );

  return () =>
    browser.runtime.onMessage.removeListener(
      listener as Parameters<typeof browser.runtime.onMessage.removeListener>[0],
    );
}