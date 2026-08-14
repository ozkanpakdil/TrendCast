/**
 * Popup hook to fetch the latest snapshot and trigger collection.
 * Reads from chrome.storage.local and sends TRIGGER_COLLECTION to background.
 */

import { useState, useEffect, useCallback } from 'react';
import { browser } from '@/messaging/browser';
import { CONFIG } from '@/config';
import type { CollectionSnapshot } from '@/types';
import { sendMessage } from '@/messaging';

export function useSnapshot() {
  const [snapshot, setSnapshot] = useState<CollectionSnapshot | null>(null);
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
      console.error('[HypeMarket] Failed to fetch snapshot:', err);
    }
  }, []);

  const triggerCollection = useCallback(async () => {
    setCollecting(true);
    try {
      await sendMessage('TRIGGER_COLLECTION', {});
      await fetchSnapshot();
    } catch (err) {
      console.error('[HypeMarket] Collection trigger failed:', err);
    } finally {
      setCollecting(false);
    }
  }, [fetchSnapshot]);

  useEffect(() => {
    fetchSnapshot();
  }, [fetchSnapshot]);

  return { snapshot, collecting, lastCollectionAt, triggerCollection };
}