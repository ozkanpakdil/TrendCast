/**
 * Hook to read and refresh cached prediction market contracts.
 *
 * On mount, sends a FETCH_MARKETS message to the background worker for
 * both platforms. The worker fetches from the APIs and caches in storage.
 * We then read from storage for instant display.
 */

import { useState, useEffect, useCallback } from 'react';
import { browser } from '@/messaging/browser';
import type { Browser } from '@/messaging/browser';
import { sendMessage } from '@/messaging';
import { CONFIG } from '@/config';
import type { MarketContract } from '@/types';

export function useCachedMarkets() {
  const [markets, setMarkets] = useState<MarketContract[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFromStorage = useCallback(async () => {
    const result = await browser.storage.local.get(CONFIG.storage.cachedMarkets);
    const cached = (result[CONFIG.storage.cachedMarkets] as MarketContract[]) ?? [];
    setMarkets(cached);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    // Fetch both platforms in parallel.
    await Promise.all([
      sendMessage('FETCH_MARKETS', { platform: 'polymarket' }),
      sendMessage('FETCH_MARKETS', { platform: 'kalshi' }),
    ]).catch((err) => console.error('[HypeMarket] Refresh failed:', err));
    await loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    // Load cached data immediately, then refresh from APIs.
    loadFromStorage().then(() => refresh());
  }, [loadFromStorage, refresh]);

  // Listen for storage changes (background worker updates cache).
  useEffect(() => {
    const listener = (changes: Record<string, Browser.Storage.StorageChange>) => {
      if (changes[CONFIG.storage.cachedMarkets]) {
        setMarkets((changes[CONFIG.storage.cachedMarkets].newValue as MarketContract[]) ?? []);
      }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);

  return { markets, loading, refresh };
}