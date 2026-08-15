/**
 * ML Web Worker — runs ML inference (embedding/sentiment) off the main thread.
 *
 * The background script spawns this worker when an ML correlation engine is
 * selected. The worker receives correlation requests, runs the ML pipelines,
 * and posts progress + results back to the background thread.
 *
 * This prevents the "Stop the script" dialog in Firefox and keeps the
 * extension UI responsive during long-running ML inference.
 *
 * ── WASM path in worker context ──────────────────────────────────
 * `browser.runtime.getURL` is NOT available in Web Workers. Instead, we
 * derive the extension base URL from `self.location.href` (the worker
 * script URL, e.g. `moz-extension://<id>/workers/ml-worker.js`) and
 * replace the last path segment with `wasm/`.
 */

/// <reference lib="webworker" />

import type {
  CorrelationMatch,
  CorrelationResult,
  MarketContract,
  NewsCorrelationMatch,
  NewsItem,
  NewsSocialCorrelationMatch,
  SocialSignal,
} from '@/types';
import {
  setWasmPath,
  correlateEmbedding,
  correlateNewsEmbedding,
  correlateNewsSocialEmbedding,
  correlateSentiment,
  correlateNewsSentiment,
  correlateNewsSocialSentiment,
  type ProgressCallback,
  type CancelFlag,
} from '@/services/engine/ml';

// ── Worker message protocol ────────────────────────────────────────

interface WorkerRequest {
  type: 'correlate';
  requestId: string;
  engine: 'embedding' | 'sentiment';
  model: string;
  markets: MarketContract[];
  signals: SocialSignal[];
  news: NewsItem[];
}

interface WorkerProgressMessage {
  type: 'progress';
  requestId: string;
  phase: string;
  current: number;
  total: number;
  engine: string;
  model: string;
}

interface WorkerResultMessage {
  type: 'result';
  requestId: string;
  result: CorrelationResult;
}

interface WorkerErrorMessage {
  type: 'error';
  requestId: string;
  error: string;
}

type WorkerOutgoingMessage =
  | WorkerProgressMessage
  | WorkerResultMessage
  | WorkerErrorMessage;

function postMessageToHost(msg: WorkerOutgoingMessage): void {
  (self as unknown as Worker).postMessage(msg);
}

// ── WASM path setup ──────────────────────────────────────────────

/**
 * Derive the extension's WASM path from the worker's own URL.
 * The worker script is at `moz-extension://<id>/workers/ml-worker.js`
 * (or `chrome-extension://...`). We replace the filename with `../wasm/`
 * to get `moz-extension://<id>/wasm/`.
 */
function deriveWasmPath(): string {
  const url = self.location.href;
  // Remove the filename portion and navigate up to the extension root,
  // then append `wasm/`.
  // e.g. `.../workers/ml-worker.js` → `.../` → `.../wasm/`
  const base = url.substring(0, url.lastIndexOf('/'));
  const parent = base.substring(0, base.lastIndexOf('/'));
  return parent + '/wasm/';
}

// Set the WASM path once at module load — before any pipeline is created.
try {
  const wasmPath = deriveWasmPath();
  setWasmPath(wasmPath);
  console.log('[TrendCast ML Worker] WASM path:', wasmPath);
} catch (e) {
  console.error('[TrendCast ML Worker] Failed to set WASM path:', e);
}

// ── Cancel flag ───────────────────────────────────────────────────

const cancelFlag: CancelFlag = { cancelled: false };

// ── Message handler ───────────────────────────────────────────────

(self as unknown as Worker).addEventListener('message', (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  if (msg.type === 'correlate') {
    handleCorrelate(msg).catch((err) => {
      console.error('[TrendCast ML Worker] Unhandled error:', err);
      postMessageToHost({
        type: 'error',
        requestId: msg.requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
});

async function handleCorrelate(msg: WorkerRequest): Promise<void> {
  const { requestId, engine, model, markets, signals, news } = msg;

  // Reset cancel flag for this run
  cancelFlag.cancelled = false;

  const onProgress: ProgressCallback = (info) => {
    // Check cancel on every progress update
    if (cancelFlag.cancelled) {
      throw new Error('Correlation cancelled by user.');
    }
    postMessageToHost({
      type: 'progress',
      requestId,
      phase: info.phase,
      current: info.current,
      total: info.total,
      engine: info.engine,
      model: info.model,
    });
  };

  try {
    let matches: CorrelationMatch[] = [];
    let newsMatches: NewsCorrelationMatch[] = [];
    let newsSocialMatches: NewsSocialCorrelationMatch[] = [];

    if (engine === 'embedding') {
      console.log(`[TrendCast ML Worker] Starting embedding correlation: model="${model}"`);
      matches = await correlateEmbedding(signals, markets, model as never, onProgress, cancelFlag);
      newsMatches = await correlateNewsEmbedding(news, markets, model as never, onProgress, cancelFlag);
      newsSocialMatches = await correlateNewsSocialEmbedding(news, signals, model as never, onProgress, cancelFlag);
    } else if (engine === 'sentiment') {
      console.log(`[TrendCast ML Worker] Starting sentiment correlation: model="${model}"`);
      matches = await correlateSentiment(signals, markets, model as never, onProgress, cancelFlag);
      newsMatches = await correlateNewsSentiment(news, markets, model as never, onProgress, cancelFlag);
      newsSocialMatches = await correlateNewsSocialSentiment(news, signals, model as never, onProgress, cancelFlag);
    }

    const result: CorrelationResult = {
      matches,
      newsMatches,
      newsSocialMatches,
      engine,
    };

    console.log(
      `[TrendCast ML Worker] Done: ${matches.length} signal→market, ${newsMatches.length} news→market, ${newsSocialMatches.length} news→social`,
    );

    postMessageToHost({
      type: 'result',
      requestId,
      result,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[TrendCast ML Worker] Correlation failed:`, errorMsg);

    postMessageToHost({
      type: 'error',
      requestId,
      error: errorMsg,
    });
  }
}

// Export for testing (not used in worker context)
export { handleCorrelate, deriveWasmPath };