/**
 * Hook to fetch and manage correlation results.
 * Loads cached correlations from storage on mount (pre-computed by background),
 * and provides runCorrelation() to trigger fresh computation on demand.
 *
 * The caller passes the selected engine and model so the background worker
 * knows which correlation strategy to use (heuristic, embedding, or sentiment).
 *
 * For ML engines (embedding/sentiment), the hook also:
 * - Tracks progress updates (phase, current/total, elapsed time)
 * - Provides a cancelCorrelation() function to abort a running ML job
 * - Listens for CORRELATION_PROGRESS messages from the background
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { CorrelationResult as CorrelationResultType, CorrelationEngine } from '@/types';
import { sendMessage } from '@/messaging';
import { browser } from '@/messaging/browser';
import { CONFIG } from '@/config';

export interface CorrelationProgress {
  phase: string;
  current: number;
  total: number;
  engine: string;
  model: string;
}

export function useCorrelations() {
  const [correlations, setCorrelations] = useState<CorrelationResultType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<CorrelationProgress | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const startTimeRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestIdRef = useRef<string | null>(null);

  // Load pre-computed correlations from storage on mount.
  useEffect(() => {
    browser.storage.local
      .get(CONFIG.storage.correlations)
      .then((result) => {
        const cached = result[CONFIG.storage.correlations] as CorrelationResultType | undefined;
        if (cached && typeof cached === 'object' && 'matches' in cached) {
          setCorrelations(cached);
          setError(cached.error ?? null);
        }
      })
      .catch((err) => console.error('[TrendCast] Failed to load cached correlations:', err));
  }, []);

  // Listen for progress messages from the background
  useEffect(() => {
    const listener = (msg: unknown) => {
      const data = msg as { type?: string; payload?: CorrelationProgress & { requestId: string } };
      if (data.type === 'CORRELATION_PROGRESS' && data.payload) {
        setProgress(data.payload);
      }
    };

    browser.runtime.onMessage.addListener(listener);
    return () => {
      browser.runtime.onMessage.removeListener(listener);
    };
  }, []);

  // Elapsed time ticker
  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    setElapsedMs(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      if (startTimeRef.current) {
        setElapsedMs(Date.now() - startTimeRef.current);
      }
    }, 500);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    startTimeRef.current = null;
  }, []);

  const runCorrelation = useCallback(
    async (engine?: CorrelationEngine, model?: string) => {
      console.log('[TrendCast] [Dashboard] runCorrelation called:', { engine, model });
      setLoading(true);
      setError(null);
      setProgress(null);
      const requestId = `corr-${Date.now()}`;
      requestIdRef.current = requestId;
      startTimer();

      try {
        const result = await sendMessage('CORRELATE_ALL', { engine, model, requestId });
        console.log('[TrendCast] [Dashboard] CORRELATE_ALL response:', result);

        // The messaging layer wraps responses as { ok: true, data: ... }
        const unwrapped =
          result && typeof result === 'object' && 'ok' in result
            ? (result as { ok: boolean; data: unknown }).data
            : result;

        if (unwrapped && typeof unwrapped === 'object' && 'matches' in unwrapped) {
          const corrResult = unwrapped as CorrelationResultType;
          setCorrelations(corrResult);
          setError(corrResult.error ?? null);
          console.log('[TrendCast] [Dashboard] Correlations set:', {
            matches: corrResult.matches.length,
            newsMatches: corrResult.newsMatches.length,
            newsSocialMatches: corrResult.newsSocialMatches.length,
            engine: corrResult.engine,
            error: corrResult.error,
          });
        } else {
          console.warn('[TrendCast] [Dashboard] Unexpected CORRELATE_ALL response shape:', unwrapped);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[TrendCast] Correlation failed:', err);
        console.error(`[TrendCast] [Dashboard] Correlation error details: engine=${engine ?? 'default'}, model=${model ?? 'default'}, error="${msg}"`);
        setError(`Correlation request failed: ${msg}`);
      } finally {
        setLoading(false);
        setProgress(null);
        stopTimer();
        requestIdRef.current = null;
      }
    },
    [startTimer, stopTimer],
  );

  const cancelCorrelation = useCallback(async () => {
    console.log('[TrendCast] [Dashboard] Cancelling correlation…');
    try {
      await sendMessage('CANCEL_CORRELATION', { requestId: requestIdRef.current ?? '' });
    } catch (err) {
      console.error('[TrendCast] [Dashboard] Cancel failed:', err);
    }
    setLoading(false);
    setProgress(null);
    stopTimer();
    requestIdRef.current = null;
  }, [stopTimer]);

  return { correlations, loading, error, progress, elapsedMs, runCorrelation, cancelCorrelation };
}