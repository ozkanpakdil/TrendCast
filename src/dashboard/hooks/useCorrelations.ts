/**
 * Hook to fetch and manage correlation results.
 * Sends CORRELATE_ALL to the background and stores the result.
 */

import { useState, useCallback } from 'react';
import type { CorrelationMatch, NewsCorrelationMatch } from '@/types';
import { sendMessage } from '@/messaging';

interface CorrelationResult {
  matches: CorrelationMatch[];
  newsMatches: NewsCorrelationMatch[];
}

export function useCorrelations() {
  const [correlations, setCorrelations] = useState<CorrelationResult | null>(null);
  const [loading, setLoading] = useState(false);

  const runCorrelation = useCallback(async () => {
    setLoading(true);
    try {
      const result = await sendMessage('CORRELATE_ALL', {});
      if (result && typeof result === 'object' && 'matches' in result) {
        setCorrelations(result as CorrelationResult);
      }
    } catch (err) {
      console.error('[TrendCast] Correlation failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  return { correlations, loading, runCorrelation };
}