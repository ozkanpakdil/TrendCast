/**
 * Conditional fetch with ETag/Last-Modified caching.
 *
 * Phase 4: Collection efficiency — avoids re-downloading unchanged
 * responses by sending If-None-Match / If-Modified-Since headers and
 * caching ETag/Last-Modified per source URL.
 *
 * The cache is persisted in chrome.storage.local so it survives service
 * worker restarts. When a server returns 304 Not Modified, we return
 * null to signal "no change" so the collector can skip processing.
 *
 * ⚠️ Note: Some public APIs (rss2json, Reddit .json) may not support
 *    conditional requests. In that case the fetch proceeds normally and
 *    we update the cache with whatever headers the server returns.
 */

import { browser } from '@/messaging/browser';
import { CONFIG } from '@/config';

interface FetchCacheEntry {
  etag?: string;
  lastModified?: string;
}

type FetchCache = Record<string, FetchCacheEntry>;

/** In-memory cache mirror to avoid repeated storage reads within a cycle. */
let cacheMemory: FetchCache | null = null;

/** Load the fetch cache from storage (once per worker lifecycle). */
async function loadCache(): Promise<FetchCache> {
  if (cacheMemory) return cacheMemory;
  const result = await browser.storage.local.get(CONFIG.fetch.cacheKey);
  cacheMemory = (result[CONFIG.fetch.cacheKey] as FetchCache) ?? {};
  return cacheMemory;
}

/** Persist the fetch cache to storage. */
async function saveCache(cache: FetchCache): Promise<void> {
  cacheMemory = cache;
  await browser.storage.local.set({ [CONFIG.fetch.cacheKey]: cache });
}

/**
 * Fetch a URL with conditional request headers.
 *
 * @param url       The URL to fetch.
 * @param init       Extra fetch options (headers merged with conditional headers).
 * @param force      When true, skip sending conditional headers so the server
 *                   always returns fresh content (200) instead of a 304. Used by
 *                   sources whose content changes in place (e.g. daily stock
 *                   screener tables) where a 304 would skip re-parsing.
 * @returns The Response if the resource changed (status 200), or null if
 *          the server returned 304 Not Modified.
 */
export async function conditionalFetch(
  url: string,
  init: RequestInit = {},
  force = false,
): Promise<Response | null> {
  const cache = await loadCache();
  const entry = cache[url] ?? {};

  const headers = new Headers(init.headers);
  if (!force) {
    if (entry.etag) headers.set('If-None-Match', entry.etag);
    if (entry.lastModified) headers.set('If-Modified-Since', entry.lastModified);
  }
  headers.set('Accept', 'application/json');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.fetch.timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  // 304 Not Modified — resource unchanged, skip processing.
  if (response.status === 304) {
    return null;
  }

  // Update cache with new validators (if the server provided any).
  const etag = response.headers.get('ETag');
  const lastModified = response.headers.get('Last-Modified');
  if (etag || lastModified) {
    cache[url] = { etag: etag ?? undefined, lastModified: lastModified ?? undefined };
    await saveCache(cache);
  }

  return response;
}

/**
 * Fetch JSON with conditional request support.
 *
 * @param url   The URL to fetch.
 * @param force When true, bypass the 304 cache and always fetch fresh content.
 * @returns Parsed JSON if the resource changed, or null if unchanged (304).
 * @throws Error on non-ok, non-304 responses.
 */
export async function conditionalFetchJson<T>(url: string, force = false): Promise<T | null> {
  const response = await conditionalFetch(url, {}, force);
  if (response === null) return null; // 304 Not Modified

  if (!response.ok) {
    throw new Error(`Fetch error: ${response.status} ${response.statusText} for ${url}`);
  }

  return (await response.json()) as T;
}