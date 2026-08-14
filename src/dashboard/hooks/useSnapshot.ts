/**
 * Hook to fetch and subscribe to the latest collection snapshot.
 * Reads from chrome.storage.local and listens for changes.
 */

import { useState, useEffect, useCallback } from 'react';
import { browser } from '@/messaging/browser';
import { CONFIG } from '@/config';
import type { CollectionSnapshot } from '@/types';
import { sendMessage } from '@/messaging';

export function useSnapshot() {
  const [snapshot, setSnapshot] = useState<CollectionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [lastCollectionAt, setLastCollectionAt] = useState<number | null>(null);

  const fetchSnapshot = useCallback(async () => {
    try {
      const result = await browser.storage.local.get([
        CONFIG.storage.latestSnapshot,
        CONFIG.storage.lastCollectionAt,
      ]);
      const snap = result[CONFIG.storage.latestSnapshot] as CollectionSnapshot | undefined;
      const lastAt = result[CONFIG.storage.lastCollectionAt] as number | undefined;
      if (snap) setSnapshot(snap);
      if (lastAt) setLastCollectionAt(lastAt);
    } catch (err) {
      console.error('[TrendCast] Failed to fetch snapshot:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const triggerCollection = useCallback(async () => {
    setCollecting(true);
    console.log('[TrendCast] [Dashboard] Triggering collection…');
    try {
      const result = await sendMessage('TRIGGER_COLLECTION', {});
      console.log('[TrendCast] [Dashboard] Collection returned:', result);
      await fetchSnapshot();
    } catch (err) {
      console.error('[TrendCast] [Dashboard] Collection trigger failed:', err);
    } finally {
      setCollecting(false);
    }
  }, [fetchSnapshot]);

  useEffect(() => {
    fetchSnapshot();

    // Listen for storage changes (background updates snapshot after collection).
    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      if (changes[CONFIG.storage.latestSnapshot]?.newValue) {
        setSnapshot(changes[CONFIG.storage.latestSnapshot].newValue as CollectionSnapshot);
      }
      if (changes[CONFIG.storage.lastCollectionAt]?.newValue) {
        setLastCollectionAt(changes[CONFIG.storage.lastCollectionAt].newValue as number);
      }
    };

    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, [fetchSnapshot]);

  return { snapshot, loading, collecting, lastCollectionAt, triggerCollection, refresh: fetchSnapshot };
}