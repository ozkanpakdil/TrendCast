/**
 * CorrelationRunHistory — table of past correlation runs for model comparison.
 *
 * Shows each run's engine, model, match counts, avg/max confidence, spread,
 * and elapsed time. Sorted newest-first. Includes a "Clear" button.
 */

import { memo, useState, useCallback } from 'react';
import { browser } from '@/messaging/browser';
import { CONFIG } from '@/config';
import type { CorrelationRunStats } from '@/types';

interface CorrelationRunHistoryProps {
  history: CorrelationRunStats[];
  isDark: boolean;
  onClear: () => void;
}

function engineLabel(engine: string): string {
  const labels: Record<string, string> = {
    heuristic: '🧮 Heuristic',
    embedding: '🧠 Embedding',
    sentiment: '📊 Sentiment',
    ner: '🏷️ NER',
    llm: '🤖 LLM',
  };
  return labels[engine] ?? engine;
}

function modelShort(model: string): string {
  if (!model) return '—';
  return model.split('/').pop() ?? model;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function CorrelationRunHistoryImpl({ history, isDark, onClear }: CorrelationRunHistoryProps) {
  const [confirmClear, setConfirmClear] = useState(false);

  const handleClear = useCallback(async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    try {
      await browser.storage.local.remove(CONFIG.storage.correlationRunHistory);
      onClear();
    } catch (err) {
      console.error('[TrendCast] Failed to clear run history:', err);
    }
    setConfirmClear(false);
  }, [confirmClear, onClear]);

  if (history.length === 0) {
    return (
      <div className={`text-center py-8 text-sm ${isDark ? 'text-slate-500' : 'text-light-muted'}`}>
        <p>No correlation runs recorded yet.</p>
        <p className="text-xs mt-1">Run a correlation analysis to start comparing models.</p>
      </div>
    );
  }

  const sorted = [...history].reverse(); // newest first

  const thClass = `text-left text-[10px] font-semibold uppercase tracking-wider px-2 py-1.5 ${
    isDark ? 'text-slate-400' : 'text-light-muted'
  }`;
  const tdClass = `px-2 py-1.5 text-xs ${
    isDark ? 'text-slate-300' : 'text-light-text'
  }`;
  const rowClass = isDark
    ? 'border-b border-slate-800 hover:bg-slate-800/50'
    : 'border-b border-light-border hover:bg-slate-50';

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className={`text-sm font-bold ${isDark ? 'text-slate-200' : 'text-light-text'}`}>
          🧪 Model Comparison History
        </h3>
        <button
          onClick={handleClear}
          className={`text-[10px] px-2 py-1 rounded transition-colors ${
            confirmClear
              ? 'bg-red-600 text-white hover:bg-red-700'
              : isDark
                ? 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                : 'bg-slate-100 text-light-muted hover:bg-slate-200'
          }`}
        >
          {confirmClear ? 'Click again to confirm' : '🗑 Clear History'}
        </button>
      </div>

      <div className={`overflow-x-auto rounded-lg border ${isDark ? 'border-slate-700' : 'border-light-border'}`}>
        <table className="w-full">
          <thead className={isDark ? 'bg-slate-900/60' : 'bg-slate-50'}>
            <tr>
              <th className={thClass}>Time</th>
              <th className={thClass}>Engine</th>
              <th className={thClass}>Model</th>
              <th className={thClass}>Matches</th>
              <th className={thClass}>Avg Conf</th>
              <th className={thClass}>Max Conf</th>
              <th className={thClass}>Spread</th>
              <th className={thClass}>Time</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((run, i) => {
              const total = run.matchCount + run.newsMatchCount + run.newsSocialMatchCount;
              return (
                <tr key={i} className={rowClass}>
                  <td className={`${tdClass} whitespace-nowrap ${isDark ? 'text-slate-400' : 'text-light-muted'}`}>
                    {formatTime(run.timestamp)}
                  </td>
                  <td className={tdClass}>{engineLabel(run.engine)}</td>
                  <td className={`${tdClass} max-w-[120px] truncate`} title={run.model}>
                    {modelShort(run.model)}
                  </td>
                  <td className={`${tdClass} tabular-nums`}>{total}</td>
                  <td className={`${tdClass} tabular-nums`}>
                    {(run.avgConfidence * 100).toFixed(0)}%
                  </td>
                  <td className={`${tdClass} tabular-nums`}>
                    {(run.maxConfidence * 100).toFixed(0)}%
                  </td>
                  <td className={`${tdClass} tabular-nums`}>
                    ±{(run.confidenceSpread * 100).toFixed(0)}%
                  </td>
                  <td className={`${tdClass} tabular-nums`}>
                    {(run.elapsedMs / 1000).toFixed(1)}s
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className={`text-[10px] mt-2 ${isDark ? 'text-slate-500' : 'text-light-muted'}`}>
        {history.length} run{history.length !== 1 ? 's' : ''} recorded. Higher avg confidence = more decisive model. Lower spread = more consistent scoring.
      </p>
    </div>
  );
}

export const CorrelationRunHistory = memo(CorrelationRunHistoryImpl);