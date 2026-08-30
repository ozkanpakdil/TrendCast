/**
 * Debug screen control RPC handlers — let the debug reader drive the
 * extension's UI (dashboard/popup) in the user's RUNNING browser.
 *
 * ⚠️ DEBUG-ONLY. Gated behind `import.meta.env.DEBUG_LOG_FORWARD` (set by
 * vite define for `--mode development` builds). Production builds strip
 * this module entirely.
 *
 * Architecture (Firefox-safe):
 *
 *   debug reader ──ws──► worker RPC handler ──tabs.sendMessage──► page relay
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

import { rpc } from '../registry';
import type { RpcContext } from '../types';

/** Which extension page a debug command targets. */
type DebugPage = 'dashboard' | 'popup';

const PAGE_PATHS: Record<DebugPage, string> = {
  dashboard: 'src/dashboard/index.html',
  popup: 'src/popup/index.html',
};

/** Find open tabs for an extension page (most recently active first). */
async function findPageTabs(
  ctx: RpcContext,
  page: DebugPage,
): Promise<Array<{ id?: number; url?: string; active?: boolean; title?: string; windowId?: number }>> {
  const path = PAGE_PATHS[page];
  const tabs = await ctx.browser.tabs.query({ url: `*://*/${path}` });
  // Firefox matches moz-extension:// URLs with the *://*/path pattern;
  // fall back to a manual filter if the pattern match comes back empty.
  if (tabs.length > 0) return tabs;
  const all = await ctx.browser.tabs.query({});
  return all.filter((t) => typeof t.url === 'string' && t.url.includes(path));
}

/** Resolve the target tab for a page, opening it if none is open. */
async function resolveTab(
  ctx: RpcContext,
  page: DebugPage,
): Promise<{ id?: number; url?: string; active?: boolean; windowId?: number }> {
  const tabs = await findPageTabs(ctx, page);
  if (tabs.length > 0) {
    // Prefer the active tab, else the most recently opened.
    return tabs.find((t) => t.active) ?? tabs[tabs.length - 1];
  }
  // No tab open — create one (the extension opening its own page is allowed).
  const created = await ctx.browser.tabs.create({ url: ctx.browser.runtime.getURL(PAGE_PATHS[page]) });
  // Give React a moment to mount before the caller messages the page.
  await new Promise((r) => setTimeout(r, 800));
  return created;
}

/** Send a relay command to a page and await its response. */
async function relayToPage<T = unknown>(ctx: RpcContext, tabId: number, payload: unknown): Promise<T> {
  const response = (await ctx.browser.tabs.sendMessage(tabId, {
    __trendcastDebugRelay: true,
    payload,
  })) as { ok: boolean; value?: T; error?: string } | undefined;
  if (!response) throw new Error('debug relay: no response (is the page open with the debug relay installed?)');
  if (!response.ok) throw new Error(`debug relay: ${response.error ?? 'unknown error'}`);
  return response.value as T;
}

export class ScreenRpc {
  @rpc('debugTabs', {
    group: 'screen',
    description: 'list open extension pages (dashboard/popup)',
  })
  async debugTabs(_params: Record<string, unknown>, ctx: RpcContext) {
    const out: Array<{ page: DebugPage; tabId: number | null; url: string; title: string; active: boolean }> = [];
    for (const page of Object.keys(PAGE_PATHS) as DebugPage[]) {
      const tabs = await findPageTabs(ctx, page);
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
  }

  @rpc('debugText', {
    group: 'screen',
    description: 'full page text (innerText) of an extension page',
    params: [
      { name: 'page', type: 'string', description: 'target page', optional: true, default: 'dashboard', choices: ['dashboard', 'popup'] },
    ],
  })
  async debugText(params: Record<string, unknown>, ctx: RpcContext) {
    const page = (params.page as DebugPage) ?? 'dashboard';
    const tab = await resolveTab(ctx, page);
    if (typeof tab.id !== 'number') throw new Error(`debugText: no tab id for ${page}`);
    const text = await relayToPage<string>(ctx, tab.id, { kind: 'text' });
    return { tabId: tab.id, url: tab.url, text };
  }

  @rpc('debugDom', {
    group: 'screen',
    description: 'query DOM elements (tag/text/visible) in a page',
    params: [
      { name: 'selector', type: 'string', description: 'CSS selector' },
      { name: 'text', type: 'string', description: 'optional text filter', optional: true },
      { name: 'page', type: 'string', description: 'target page', optional: true, default: 'dashboard', choices: ['dashboard', 'popup'] },
    ],
  })
  async debugDom(params: Record<string, unknown>, ctx: RpcContext) {
    const page = (params.page as DebugPage) ?? 'dashboard';
    const selector = params.selector;
    if (typeof selector !== 'string') throw new Error('debugDom: params.selector (string) required');
    const text = typeof params.text === 'string' ? params.text : null;
    const tab = await resolveTab(ctx, page);
    if (typeof tab.id !== 'number') throw new Error(`debugDom: no tab id for ${page}`);
    const value = await relayToPage<{ count: number; items: unknown[] }>(ctx, tab.id, { kind: 'dom', selector, text });
    return { tabId: tab.id, url: tab.url, count: value.count, items: value.items };
  }

  @rpc('debugClick', {
    group: 'screen',
    description: 'click an element in an extension page',
    params: [
      { name: 'selector', type: 'string', description: 'CSS selector' },
      { name: 'text', type: 'string', description: 'optional text filter', optional: true },
      { name: 'page', type: 'string', description: 'target page', optional: true, default: 'dashboard', choices: ['dashboard', 'popup'] },
    ],
  })
  async debugClick(params: Record<string, unknown>, ctx: RpcContext) {
    const page = (params.page as DebugPage) ?? 'dashboard';
    const selector = params.selector;
    if (typeof selector !== 'string') throw new Error('debugClick: params.selector (string) required');
    const text = typeof params.text === 'string' ? params.text : null;
    const tab = await resolveTab(ctx, page);
    if (typeof tab.id !== 'number') throw new Error(`debugClick: no tab id for ${page}`);
    const value = await relayToPage(ctx, tab.id, { kind: 'click', selector, text });
    return { tabId: tab.id, result: value };
  }

  @rpc('debugCapture', {
    group: 'screen',
    description: 'screenshot the dashboard/popup → PNG file',
    params: [
      { name: 'page', type: 'string', description: 'target page', optional: true, default: 'dashboard', choices: ['dashboard', 'popup'] },
    ],
  })
  async debugCapture(params: Record<string, unknown>, ctx: RpcContext) {
    const page = (params.page as DebugPage) ?? 'dashboard';
    const tab = await resolveTab(ctx, page);
    if (typeof tab.id !== 'number') throw new Error(`debugCapture: no tab id for ${page}`);
    if (!tab.active) {
      await ctx.browser.tabs.update(tab.id, { active: true });
      await new Promise((r) => setTimeout(r, 300));
    }
    const dataUrl = await ctx.browser.tabs.captureVisibleTab(tab.windowId);
    return { tabId: tab.id, dataUrl };
  }

  @rpc('debugOpen', {
    group: 'screen',
    description: 'open or focus an extension page',
    params: [
      { name: 'page', type: 'string', description: 'target page', optional: true, default: 'dashboard', choices: ['dashboard', 'popup'] },
    ],
  })
  async debugOpen(params: Record<string, unknown>, ctx: RpcContext) {
    const page = (params.page as DebugPage) ?? 'dashboard';
    const tabs = await findPageTabs(ctx, page);
    if (tabs.length > 0) {
      const target = tabs.find((t) => t.active) ?? tabs[tabs.length - 1];
      if (typeof target.id === 'number') {
        await ctx.browser.tabs.update(target.id, { active: true });
        return { opened: false, focused: true, tabId: target.id };
      }
    }
    const created = await ctx.browser.tabs.create({ url: ctx.browser.runtime.getURL(PAGE_PATHS[page]) });
    return { opened: true, focused: false, tabId: created.id ?? null };
  }
}
