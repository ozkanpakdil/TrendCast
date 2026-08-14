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
import type { Browser } from './browser';
import type { Message, MessageType } from '@/types';

/** Send a message to the background worker (from popup or content script). */
export async function sendMessage<T extends MessageType>(
  type: T,
  payload: Extract<Message, { type: T }>['payload'],
): Promise<unknown> {
  return browser.runtime.sendMessage({ type, payload } as Message);
}

/** Send a message to a specific tab's content script (from background). */
export async function sendTabMessage<T extends MessageType>(
  tabId: number,
  type: T,
  payload: Extract<Message, { type: T }>['payload'],
): Promise<unknown> {
  return browser.tabs.sendMessage(tabId, { type, payload } as Message);
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
    sender: Browser.Runtime.MessageSender,
  ) => Promise<unknown> | unknown,
): () => void {
  const listener = (
    message: Message,
    sender: Browser.Runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => {
    if (message?.type !== type) return false;

    Promise.resolve(handler(message.payload, sender))
      .then((result) => sendResponse({ ok: true, data: result }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));

    // Return true to signal async response (MV3 requirement).
    return true;
  };

  browser.runtime.onMessage.addListener(listener);

  return () => browser.runtime.onMessage.removeListener(listener);
}