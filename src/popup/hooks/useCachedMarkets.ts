/**
 * Hook to read collected prediction market contracts from chrome.storage.
 *
 * In the new architecture, the background worker collects markets hourly
 * and stores them in chrome.storage.local. This hook reads from storage
 * for instant display. No more FETCH_MARKETS message — data is already there.
 */

import { useState, useEffect } from 'react';
import { browser } from '@/messaging/browser';
import { CONFIG } from '@/config';
import type { MarketContract } from '@/types';

export function useCachedMarkets() {
  const [markets, setMarkets] = useState<MarketContract[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFromStorage = async () => {
    const result = await browser.storage.local.get(CONFIG.storage.collectedMarkets);
    const cached = (result[CONFIG.storage.collectedMarkets] as MarketContract[]) ?? [];
    setMarkets(cached);
    setLoading(false);
  };

  useEffect(() => {
    loadFromStorage();
  }, []);

  // Listen for storage changes (background worker updates after collection).
  useEffect(() => {
    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      if (changes[CONFIG.storage.collectedMarkets]) {
        setMarkets(
          (changes[CONFIG.storage.collectedMarkets].newValue as MarketContract[]) ?? [],
        );
      }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);

  return { markets, loading };
}