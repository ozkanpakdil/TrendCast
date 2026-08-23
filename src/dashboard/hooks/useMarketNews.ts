/**
 * useMarketNews — loads the derived "market-driven news" snapshot on mount
 * and listens for storage changes (Phase 5, D-11/D-13).
 *
 * The background worker rebuilds the `marketNewsView` snapshot after each
 * correlation completes (05-02) and writes it to chrome.storage.local. This
 * hook mirrors `useAlerts`/`useSnapshot`: it reads the cached snapshot on
 * mount and subscribes to `chrome.storage.onChanged` so the dashboard stays
 * in sync with the latest derived view without a broadcast round-trip
 * (RESEARCH.md Pattern 5 — storage listener survives missed broadcasts).
 */

import { useState, useEffect } from 'react';
import { browser } from '@/messaging/browser';
import { CONFIG } from '@/config';
import type { MarketNewsView } from '@/background/correlationNews';

export function useMarketNews() {
  const [view, setView] = useState<MarketNewsView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load the cached snapshot on mount.
    browser.storage.local
      .get(CONFIG.storage.marketNewsView)
      .then((result) => {
        const cached = result[CONFIG.storage.marketNewsView] as MarketNewsView | undefined;
        if (cached) setView(cached);
      })
      .catch((err) => {
        console.error('[TrendCast] Failed to load market news snapshot:', err);
      })
      .finally(() => setLoading(false));

    // Listen for storage changes (background writes the snapshot after correlation).
    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      const next = changes[CONFIG.storage.marketNewsView]?.newValue as MarketNewsView | undefined;
      if (next) setView(next);
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);

  return { view, loading };
}
