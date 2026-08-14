/**
 * HistoryChart — SVG-based historical data visualization.
 *
 * Shows collection history (markets, signals, news counts, avg sentiment)
 * as line charts. No external charting library — pure SVG.
 *
 * Phase 3 roadmap item: historical correlation charts in the dashboard.
 */

import { useState, useEffect, useCallback } from 'react';
import { browser } from '@/messaging/browser';
import { CONFIG } from '@/config';
import { sendMessage } from '@/messaging';
import type { HistoryEntry } from '@/types';

type ChartMetric = 'marketCount' | 'signalCount' | 'newsCount' | 'correlationCount' | 'avgSentiment';

const METRIC_LABELS: Record<ChartMetric, string> = {
  marketCount: 'Markets',
  signalCount: 'Signals',
  newsCount: 'News',
  correlationCount: 'Correlations',
  avgSentiment: 'Avg Sentiment',
};

const METRIC_COLORS: Record<ChartMetric, string> = {
  marketCount: '#599dff',
  signalCount: '#16a34a',
  newsCount: '#dc2626',
  correlationCount: '#a855f7',
  avgSentiment: '#f59e0b',
};

interface HistoryChartProps {
  /** Optional className for styling. */
  className?: string;
}

export function HistoryChart({ className }: HistoryChartProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<ChartMetric>('signalCount');

  const fetchHistory = useCallback(async () => {
    try {
      const result = await sendMessage('GET_HISTORY', { limit: 168 });
      if (result && typeof result === 'object' && 'history' in result) {
        setHistory((result as { history: HistoryEntry[] }).history);
      }
    } catch (err) {
      console.error('[HypeMarket] Failed to fetch history:', err);
      // Fallback: read directly from storage
      try {
        const storageResult = await browser.storage.local.get(CONFIG.storage.history);
        const stored = (storageResult[CONFIG.storage.history] as HistoryEntry[]) ?? [];
        setHistory(stored);
      } catch {
        // ignore
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();

    // Listen for storage changes (new collection adds history entry)
    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      if (changes[CONFIG.storage.history]?.newValue) {
        setHistory(changes[CONFIG.storage.history].newValue as HistoryEntry[]);
      }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, [fetchHistory]);

  if (loading) {
    return (
      <div className={`rounded-lg p-4 bg-slate-900 border border-slate-800 ${className ?? ''}`}>
        <p className="text-slate-500 text-sm text-center py-8">Loading history…</p>
      </div>
    );
  }

  if (history.length < 2) {
    return (
      <div className={`rounded-lg p-4 bg-slate-900 border border-slate-800 ${className ?? ''}`}>
        <p className="text-slate-500 text-sm text-center py-8">
          Not enough historical data yet. Collect data over time to see trends.
          <br />
          <span className="text-xs">({history.length} snapshot{history.length === 1 ? '' : 's'} recorded)</span>
        </p>
      </div>
    );
  }

  // Chart dimensions
  const width = 800;
  const height = 240;
  const padding = { top: 20, right: 20, bottom: 30, left: 50 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  // Extract data points for the selected metric
  const values = history.map((h) => h[metric]);
  const maxVal = metric === 'avgSentiment' ? 1 : Math.max(...values, 1);
  const minVal = metric === 'avgSentiment' ? -1 : 0;
  const range = maxVal - minVal || 1;

  // Scale data to chart coordinates
  const points = history.map((h, i) => {
    const x = padding.left + (i / (history.length - 1)) * chartW;
    const val = h[metric];
    const y = padding.top + chartH - ((val - minVal) / range) * chartH;
    return { x, y, val, timestamp: h.timestamp };
  });

  // Build SVG path
  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');

  // Build area path (for fill)
  const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${padding.top + chartH} L ${points[0].x.toFixed(1)} ${padding.top + chartH} Z`;

  // Y-axis labels
  const yLabels = metric === 'avgSentiment'
    ? [-1, -0.5, 0, 0.5, 1]
    : [0, maxVal * 0.25, maxVal * 0.5, maxVal * 0.75, maxVal];

  // X-axis labels (first, middle, last)
  const xLabelIndices = [0, Math.floor(history.length / 2), history.length - 1];

  const color = METRIC_COLORS[metric];

  return (
    <div className={`rounded-lg p-4 bg-slate-900 border border-slate-800 ${className ?? ''}`}>
      {/* Metric selector */}
      <div className="flex flex-wrap gap-2 mb-3">
        {(Object.keys(METRIC_LABELS) as ChartMetric[]).map((m) => (
          <button
            key={m}
            onClick={() => setMetric(m)}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              metric === m
                ? 'bg-brand-500/30 text-brand-300 font-bold'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {METRIC_LABELS[m]}
          </button>
        ))}
      </div>

      {/* SVG Chart */}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        style={{ maxHeight: '280px' }}
      >
        {/* Grid lines */}
        {yLabels.map((label, i) => {
          const y = padding.top + chartH - ((label - minVal) / range) * chartH;
          return (
            <g key={i}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="#1e293b"
                strokeWidth="1"
                strokeDasharray="2 4"
              />
              <text
                x={padding.left - 8}
                y={y + 4}
                fill="#64748b"
                fontSize="10"
                textAnchor="end"
              >
                {metric === 'avgSentiment' ? label.toFixed(1) : Math.round(label)}
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <path d={areaD} fill={color} opacity="0.1" />

        {/* Line */}
        <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />

        {/* Data points */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="3"
            fill={color}
            className="cursor-pointer"
          >
            <title>
              {new Date(p.timestamp).toLocaleString()}: {p.val.toFixed(2)}
            </title>
          </circle>
        ))}

        {/* X-axis labels */}
        {xLabelIndices.map((idx) => {
          const p = points[idx];
          if (!p) return null;
          return (
            <text
              key={idx}
              x={p.x}
              y={height - 8}
              fill="#64748b"
              fontSize="10"
              textAnchor="middle"
            >
              {new Date(p.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}
            </text>
          );
        })}
      </svg>

      {/* Summary stats */}
      <div className="flex items-center justify-between mt-3 text-xs text-slate-500">
        <span>
          {history.length} snapshots · Latest: {new Date(history[history.length - 1].timestamp).toLocaleString()}
        </span>
        <span style={{ color }}>
          Current: {values[values.length - 1].toFixed(2)}
        </span>
      </div>
    </div>
  );
}