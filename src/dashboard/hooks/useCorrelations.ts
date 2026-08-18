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
import type { CorrelationResult as CorrelationResultType, CorrelationEngine, CorrelationRunStats } from '@/types';
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

/** Maximum number of past run stats to keep in storage. */
const MAX_RUN_HISTORY = 50;

/** Compute stats from a correlation result for model comparison. */
function computeRunStats(
  result: CorrelationResultType,
  engine: CorrelationEngine | undefined,
  model: string | undefined,
  elapsed: number,
  signalCount: number,
  contractCount: number,
  newsCount: number,
): CorrelationRunStats {
  const allConfidences = [
    ...result.matches.map((m) => m.confidence),
    ...result.newsMatches.map((m) => m.confidence),
    ...result.newsSocialMatches.map((m) => m.confidence),
  ];

  const matchCount = result.matches.length;
  const newsMatchCount = result.newsMatches.length;
  const newsSocialMatchCount = result.newsSocialMatches.length;
  const total = allConfidences.length;

  const avgConfidence = total > 0 ? allConfidences.reduce((a, b) => a + b, 0) / total : 0;
  const maxConfidence = total > 0 ? Math.max(...allConfidences) : 0;
  const variance = total > 1
    ? allConfidences.reduce((sum, c) => sum + (c - avgConfidence) ** 2, 0) / total
    : 0;
  const confidenceSpread = Math.sqrt(variance);

  return {
    timestamp: Date.now(),
    engine: engine ?? result.engine ?? 'heuristic',
    model: model ?? '',
    matchCount,
    newsMatchCount,
    newsSocialMatchCount,
    avgConfidence,
    maxConfidence,
    confidenceSpread,
    elapsedMs: elapsed,
    signalCount,
    contractCount,
    newsCount,
  };
}

/** Persist a run stats entry to storage, keeping only the most recent N. */
async function persistRunStats(stats: CorrelationRunStats): Promise<void> {
  try {
    const key = CONFIG.storage.correlationRunHistory;
    const result = await browser.storage.local.get(key);
    const existing = (result[key] as CorrelationRunStats[] | undefined) ?? [];
    const updated = [...existing, stats].slice(-MAX_RUN_HISTORY);
    await browser.storage.local.set({ [key]: updated });
  } catch (err) {
    console.warn('[TrendCast] Failed to persist run stats:', err);
  }
}

export function useCorrelations() {
  const [correlations, setCorrelations] = useState<CorrelationResultType | null>(null);
  const [runStats, setRunStats] = useState<CorrelationRunStats | null>(null);
  const [runHistory, setRunHistory] = useState<CorrelationRunStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<CorrelationProgress | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const startTimeRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestIdRef = useRef<string | null>(null);

  // Load pre-computed correlations + run history from storage on mount.
  useEffect(() => {
    browser.storage.local
      .get([CONFIG.storage.correlations, CONFIG.storage.correlationRunHistory])
      .then((result) => {
        const cached = result[CONFIG.storage.correlations] as CorrelationResultType | undefined;
        if (cached && typeof cached === 'object' && 'matches' in cached) {
          setCorrelations(cached);
          setError(cached.error ?? null);
        }
        const history = result[CONFIG.storage.correlationRunHistory] as CorrelationRunStats[] | undefined;
        if (Array.isArray(history)) {
          setRunHistory(history);
        }
      })
      .catch((err) => console.error('[TrendCast] Failed to load cached correlations:', err));
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

  // Listen for progress + result messages from the background
  useEffect(() => {
    const listener = (msg: unknown) => {
      const data = msg as { type?: string; payload?: CorrelationProgress & { requestId: string } & CorrelationResultType };

      if (data.type === 'CORRELATION_PROGRESS' && data.payload) {
        setProgress(data.payload as CorrelationProgress);
      }

      // Fire-and-forget pattern: background sends CORRELATION_RESULT
      // when the async correlation completes
      if (data.type === 'CORRELATION_RESULT' && data.payload) {
        const corrResult = data.payload as CorrelationResultType;
        if (corrResult && typeof corrResult === 'object' && 'matches' in corrResult) {
          setCorrelations(corrResult);
          setError(corrResult.error ?? null);

          // Compute and persist run stats
          const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : 0;
          const stats = computeRunStats(
            corrResult,
            corrResult.engine,
            undefined,
            elapsed,
            corrResult.matches.length,
            0,
            corrResult.newsMatches.length + corrResult.newsSocialMatches.length,
          );
          setRunStats(stats);
          persistRunStats(stats);
          setRunHistory((prev) => [...prev, stats].slice(-MAX_RUN_HISTORY));

          setLoading(false);
          setProgress(null);
          stopTimer();
          requestIdRef.current = null;
        }
      }
    };

    browser.runtime.onMessage.addListener(listener);
    return () => {
      browser.runtime.onMessage.removeListener(listener);
    };
  }, [stopTimer]);

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

        // Fire-and-forget: background returns { started: true, requestId }
        // immediately. The actual result arrives via CORRELATION_RESULT
        // message (handled in the useEffect listener above).
        // For fast engines (heuristic), the result may already be in storage
        // by the time we get here, so we check storage as a fallback.
        const unwrapped =
          result && typeof result === 'object' && 'ok' in result
            ? (result as { ok: boolean; data: unknown }).data
            : result;

        if (unwrapped && typeof unwrapped === 'object' && 'started' in unwrapped) {
          // Fire-and-forget mode — wait for CORRELATION_RESULT message
          console.log('[TrendCast] [Dashboard] Correlation started, waiting for result…');
          return;
        }

        // Legacy mode: some engines may still return the result inline
        if (unwrapped && typeof unwrapped === 'object' && 'matches' in unwrapped) {
          const corrResult = unwrapped as CorrelationResultType;
          setCorrelations(corrResult);
          setError(corrResult.error ?? null);

          const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : 0;
          const stats = computeRunStats(
            corrResult,
            engine,
            model,
            elapsed,
            corrResult.matches.length,
            0,
            corrResult.newsMatches.length + corrResult.newsSocialMatches.length,
          );
          setRunStats(stats);
          persistRunStats(stats);
          setRunHistory((prev) => [...prev, stats].slice(-MAX_RUN_HISTORY));

          setLoading(false);
          setProgress(null);
          stopTimer();
          requestIdRef.current = null;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[TrendCast] Correlation failed:', err);
        console.error(`[TrendCast] [Dashboard] Correlation error details: engine=${engine ?? 'default'}, model=${model ?? 'default'}, error="${msg}"`);
        setError(`Correlation request failed: ${msg}`);
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

  return { correlations, loading, error, progress, elapsedMs, runCorrelation, cancelCorrelation, runStats, runHistory };
}