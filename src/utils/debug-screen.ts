/**
 * Debug screen control — lets the log-server drive the extension's UI.
 *
 * ⚠️ DEBUG-ONLY. Gated behind `import.meta.env.DEBUG_LOG_FORWARD` (set by
 * vite define for `--mode development` builds). Production builds strip
 * this module entirely.
 *
 * Architecture (Firefox-safe):
 *
 *   log-server CLI ──ws──► worker RPC handler ──tabs.sendMessage──► page relay
 *                                                                    (debug-relay.ts)
 *
 * Why the relay: Firefox refuses `scripting.executeScript` into
 * moz-extension:// pages ("Missing host permission for the tab") — host
 * permissions never match extension origins. Instead, the worker messages
 * the page and the page's own relay (debug-relay.ts) inspects its DOM.
 * Screenshots use `tabs.captureVisibleTab`, which Firefox only exposes
 * with the `<all_urls>` host permission (added to debug builds only —
 * see vite.config.ts).
 *
 * RPC surface:
 *   debugTabs    — list open extension pages
 *   debugText    — full page text (innerText)
 *   debugDom     — querySelectorAll info (tag/text/visible)
 *   debugClick   — synthetic click on an element
 *   debugCapture — screenshot a page (returns data URL)
 *   debugOpen    — open/focus an extension page
 */

import { browser } from '@/messaging/browser';
import { registerRpcHandler } from '@/utils/log-forwarder';

/** Which extension page a debug command targets. */
type DebugPage = 'dashboard' | 'popup';

const PAGE_PATHS: Record<DebugPage, string> = {
  dashboard: 'src/dashboard/index.html',
  popup: 'src/popup/index.html',
};

/** Find open tabs for an extension page (most recently active first). */
async function findPageTabs(page: DebugPage): Promise<Array<{ id?: number; url?: string; active?: boolean; title?: string; windowId?: number }>> {
  const path = PAGE_PATHS[page];
  const tabs = await browser.tabs.query({ url: `*://*/${path}` });
  // Firefox matches moz-extension:// URLs with the *://*/path pattern;
  // fall back to a manual filter if the pattern match comes back empty.
  if (tabs.length > 0) return tabs;
  const all = await browser.tabs.query({});
  return all.filter((t) => typeof t.url === 'string' && t.url.includes(path));
}

/** Resolve the target tab for a page, opening it if none is open. */
async function resolveTab(page: DebugPage): Promise<{ id?: number; url?: string; active?: boolean; windowId?: number }> {
  const tabs = await findPageTabs(page);
  if (tabs.length > 0) {
    // Prefer the active tab, else the most recently opened.
    return tabs.find((t) => t.active) ?? tabs[tabs.length - 1];
  }
  // No tab open — create one (the extension opening its own page is allowed).
  const created = await browser.tabs.create({ url: browser.runtime.getURL(PAGE_PATHS[page]) });
  // Give React a moment to mount before the caller messages the page.
  await new Promise((r) => setTimeout(r, 800));
  return created;
}

/** Send a relay command to a page and await its response. */
async function relayToPage<T = unknown>(tabId: number, payload: unknown): Promise<T> {
  const response = (await browser.tabs.sendMessage(tabId, {
    __trendcastDebugRelay: true,
    payload,
  })) as { ok: boolean; value?: T; error?: string } | undefined;
  if (!response) throw new Error('debug relay: no response (is the page open with the debug relay installed?)');
  if (!response.ok) throw new Error(`debug relay: ${response.error ?? 'unknown error'}`);
  return response.value as T;
}

/** All debug RPC handlers, registered at import time (debug builds only). */
export function setupDebugScreenControl(): void {
  // List open extension pages.
  registerRpcHandler('debugTabs', async () => {
    const out: Array<{ page: DebugPage; tabId: number | null; url: string; title: string; active: boolean }> = [];
    for (const page of Object.keys(PAGE_PATHS) as DebugPage[]) {
      const tabs = await findPageTabs(page);
      for (const t of tabs) {
        out.push({
          page,
          tabId: typeof t.id === 'number' ? t.id : null,
          url: t.url ?? '',
          title: t.title ?? '',
          active: Boolean(t.active),
        });
      }
    }
    return { tabs: out };
  });

  // Full page text (innerText) — for content assertions.
  registerRpcHandler('debugText', async (params) => {
    const page = (params.page as DebugPage) ?? 'dashboard';
    const tab = await resolveTab(page);
    if (typeof tab.id !== 'number') throw new Error(`debugText: no tab id for ${page}`);
    const text = await relayToPage<string>(tab.id, { kind: 'text' });
    return { tabId: tab.id, url: tab.url, text };
  });

  // DOM query — selector info (tag/text/visible), optionally text-filtered.
  registerRpcHandler('debugDom', async (params) => {
    const page = (params.page as DebugPage) ?? 'dashboard';
    const selector = params.selector;
    if (typeof selector !== 'string') throw new Error('debugDom: params.selector (string) required');
    const text = typeof params.text === 'string' ? params.text : null;
    const tab = await resolveTab(page);
    if (typeof tab.id !== 'number') throw new Error(`debugDom: no tab id for ${page}`);
    const value = await relayToPage<{ count: number; items: unknown[] }>(tab.id, { kind: 'dom', selector, text });
    return { tabId: tab.id, url: tab.url, count: value.count, items: value.items };
  });

  // Synthetic click on an element (works for React handlers).
  registerRpcHandler('debugClick', async (params) => {
    const page = (params.page as DebugPage) ?? 'dashboard';
    const selector = params.selector;
    if (typeof selector !== 'string') throw new Error('debugClick: params.selector (string) required');
    const text = typeof params.text === 'string' ? params.text : null;
    const tab = await resolveTab(page);
    if (typeof tab.id !== 'number') throw new Error(`debugClick: no tab id for ${page}`);
    const value = await relayToPage(tab.id, { kind: 'click', selector, text });
    return { tabId: tab.id, result: value };
  });

  // Screenshot an extension page. captureVisibleTab only works on the
  // ACTIVE tab of a window, so focus the target first when needed.
  registerRpcHandler('debugCapture', async (params) => {
    const page = (params.page as DebugPage) ?? 'dashboard';
    const tab = await resolveTab(page);
    if (typeof tab.id !== 'number') throw new Error(`debugCapture: no tab id for ${page}`);
    if (!tab.active) {
      await browser.tabs.update(tab.id, { active: true });
      await new Promise((r) => setTimeout(r, 300));
    }
    const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId);
    return { tabId: tab.id, dataUrl };
  });

  // Open or focus an extension page.
  registerRpcHandler('debugOpen', async (params) => {
    const page = (params.page as DebugPage) ?? 'dashboard';
    const tabs = await findPageTabs(page);
    if (tabs.length > 0) {
      const target = tabs.find((t) => t.active) ?? tabs[tabs.length - 1];
      if (typeof target.id === 'number') {
        await browser.tabs.update(target.id, { active: true });
        return { opened: false, focused: true, tabId: target.id };
      }
    }
    const created = await browser.tabs.create({ url: browser.runtime.getURL(PAGE_PATHS[page]) });
    return { opened: true, focused: false, tabId: created.id ?? null };
  });
}