/**
 * useAlerts — loads cached alert history on mount and listens for
 * ALERTS_UPDATED messages from the background worker.
 *
 * The background engine persists a capped `alertHistory` to
 * chrome.storage.local and broadcasts `ALERTS_UPDATED` whenever new alerts
 * are created or cleared. This hook keeps the dashboard Alerts tab in sync
 * with both the cached history and live updates.
 */

import { useState, useCallback, useEffect } from 'react';
import type { AlertRecord } from '@/types';
import { sendMessage } from '@/messaging';
import { browser } from '@/messaging/browser';
import { CONFIG } from '@/config';

export function useAlerts() {
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load cached alert history on mount.
  useEffect(() => {
    browser.storage.local
      .get(CONFIG.storage.alertHistory)
      .then((result) => {
        const cached = result[CONFIG.storage.alertHistory] as AlertRecord[] | undefined;
        if (Array.isArray(cached)) {
          setAlerts(cached);
        }
      })
      .catch((err) => {
        console.error('[TrendCast] Failed to load cached alerts:', err);
        setError('Couldn\'t load alerts.');
      })
      .finally(() => setLoading(false));
  }, []);

  // Listen for ALERTS_UPDATED broadcasts from the background.
  useEffect(() => {
    const listener = (msg: unknown) => {
      const data = msg as { type?: string; payload?: { alerts?: AlertRecord[] } };
      if (data.type === 'ALERTS_UPDATED' && Array.isArray(data.payload?.alerts)) {
        setAlerts(data.payload.alerts);
      }
    };
    browser.runtime.onMessage.addListener(listener);
    return () => {
      browser.runtime.onMessage.removeListener(listener);
    };
  }, []);

  // Clear all alerts via the background, then update local state.
  const clearAlerts = useCallback(async () => {
    try {
      await sendMessage('CLEAR_ALERTS', {});
      setAlerts([]);
    } catch (err) {
      console.error('[TrendCast] Failed to clear alerts:', err);
      setError('Couldn\'t clear alerts.');
    }
  }, []);

  return { alerts, loading, error, clearAlerts };
}
