/**
 * Hook to fetch and manage correlation results.
 * Loads cached correlations from storage on mount (pre-computed by background),
 * and provides runCorrelation() to trigger fresh computation on demand.
 */

import { useState, useCallback, useEffect } from 'react';
import type { CorrelationResult as CorrelationResultType } from '@/types';
import { sendMessage } from '@/messaging';
import { browser } from '@/messaging/browser';
import { CONFIG } from '@/config';

export function useCorrelations() {
  const [correlations, setCorrelations] = useState<CorrelationResultType | null>(null);
  const [loading, setLoading] = useState(false);

  // Load pre-computed correlations from storage on mount.
  // The background worker pre-computes these after collection, so they're
  // available instantly without waiting for a CORRELATE_ALL round-trip.
  useEffect(() => {
    browser.storage.local
      .get(CONFIG.storage.correlations)
      .then((result) => {
        const cached = result[CONFIG.storage.correlations] as CorrelationResultType | undefined;
        if (cached && typeof cached === 'object' && 'matches' in cached) {
          setCorrelations(cached);
        }
      })
      .catch((err) => console.error('[TrendCast] Failed to load cached correlations:', err));
  }, []);

  const runCorrelation = useCallback(async () => {
    setLoading(true);
    try {
      const result = await sendMessage('CORRELATE_ALL', {});
      // The messaging layer wraps responses as { ok: true, data: ... }
      const unwrapped =
        result && typeof result === 'object' && 'ok' in result
          ? (result as { ok: boolean; data: unknown }).data
          : result;
      if (unwrapped && typeof unwrapped === 'object' && 'matches' in unwrapped) {
        setCorrelations(unwrapped as CorrelationResultType);
      }
    } catch (err) {
      console.error('[TrendCast] Correlation failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  return { correlations, loading, runCorrelation };
}