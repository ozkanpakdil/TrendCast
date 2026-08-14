/**
 * Hook to fetch and manage correlation results.
 * Sends CORRELATE_ALL to the background and stores the result.
 */

import { useState, useCallback } from 'react';
import type { CorrelationResult as CorrelationResultType } from '@/types';
import { sendMessage } from '@/messaging';

export function useCorrelations() {
  const [correlations, setCorrelations] = useState<CorrelationResultType | null>(null);
  const [loading, setLoading] = useState(false);

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