/**
 * HistoryChart — SVG-based historical data visualization.
 *
 * Shows collection history (markets, signals, news counts, avg sentiment)
 * as line charts. No external charting library — pure SVG.
 *
 * Features:
 *   - Metric selector (Markets / Signals / News / Correlations / Avg Sentiment)
 *   - Interactive hover with vertical crosshair + tooltip showing exact values
 *   - Detail panel below the chart showing top markets, signals, and news
 *     with clickable links for the hovered (or selected) snapshot
 *
 * Phase 3 roadmap item: historical correlation charts in the dashboard.
 */

import { useState, useEffect, useCallback, memo, useRef } from 'react';
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

const PLATFORM_LABELS: Record<string, string> = {
  polymarket: 'Polymarket',
  kalshi: 'Kalshi',
  x: 'X',
  reddit: 'Reddit',
  tiktok: 'TikTok',
  bbc: 'BBC',
  cnn: 'CNN',
  yahoo: 'Yahoo Finance',
  googleFinance: 'Google Finance',
};

interface HistoryChartProps {
  /** Optional className for styling. */
  className?: string;
}

export function HistoryChartImpl({ className }: HistoryChartProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<ChartMetric>('signalCount');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const result = await sendMessage('GET_HISTORY', { limit: 168 });
      // The messaging layer wraps responses as { ok: true, data: ... }
      const unwrapped =
        result && typeof result === 'object' && 'ok' in result
          ? (result as { ok: boolean; data: unknown }).data
          : result;
      if (unwrapped && typeof unwrapped === 'object' && 'history' in unwrapped) {
        setHistory((unwrapped as { history: HistoryEntry[] }).history);
      }
    } catch (err) {
      console.error('[TrendCast] Failed to fetch history:', err);
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

  // ── Hover handling ──────────────────────────────────────────────

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current || history.length < 2) return;
      const rect = svgRef.current.getBoundingClientRect();
      // Convert mouse x to SVG coordinate space
      const svgX = ((e.clientX - rect.left) / rect.width) * 800;
      const padding = { left: 50, right: 20 };
      const chartW = 800 - padding.left - padding.right;
      // Find nearest point index
      const ratio = (svgX - padding.left) / chartW;
      const idx = Math.round(ratio * (history.length - 1));
      const clamped = Math.max(0, Math.min(history.length - 1, idx));
      setHoverIndex(clamped);
    },
    [history.length],
  );

  const handleMouseLeave = useCallback(() => {
    setHoverIndex(null);
  }, []);

  // ── Loading / empty states ─────────────────────────────────────

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

  // ── Chart calculations ──────────────────────────────────────────

  const width = 800;
  const height = 240;
  const padding = { top: 20, right: 20, bottom: 30, left: 50 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const values = history.map((h) => h[metric]);
  const maxVal = metric === 'avgSentiment' ? 1 : Math.max(...values, 1);
  const minVal = metric === 'avgSentiment' ? -1 : 0;
  const range = maxVal - minVal || 1;

  const points = history.map((h, i) => {
    const x = padding.left + (i / (history.length - 1)) * chartW;
    const val = h[metric];
    const y = padding.top + chartH - ((val - minVal) / range) * chartH;
    return { x, y, val, timestamp: h.timestamp };
  });

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');

  const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${padding.top + chartH} L ${points[0].x.toFixed(1)} ${padding.top + chartH} Z`;

  const yLabels = metric === 'avgSentiment'
    ? [-1, -0.5, 0, 0.5, 1]
    : [0, maxVal * 0.25, maxVal * 0.5, maxVal * 0.75, maxVal];

  const xLabelIndices = [0, Math.floor(history.length / 2), history.length - 1];

  const color = METRIC_COLORS[metric];

  // The snapshot to show in the detail panel (hovered or last)
  const detailIndex = hoverIndex ?? history.length - 1;
  const detailEntry = history[detailIndex];
  const hoveredPoint = points[detailIndex];

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
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        style={{ maxHeight: '280px' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
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

        {/* Hover crosshair + tooltip */}
        {hoveredPoint && (
          <g>
            {/* Vertical crosshair line */}
            <line
              x1={hoveredPoint.x}
              y1={padding.top}
              x2={hoveredPoint.x}
              y2={padding.top + chartH}
              stroke="#475569"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            {/* Highlighted data point */}
            <circle
              cx={hoveredPoint.x}
              cy={hoveredPoint.y}
              r="5"
              fill={color}
              stroke="#0f172a"
              strokeWidth="2"
            />
            {/* Tooltip box */}
            <g
              transform={`translate(${Math.min(hoveredPoint.x + 8, width - padding.right - 140)}, ${Math.max(hoveredPoint.y - 30, padding.top)})`}
            >
              <rect
                width="132"
                height="44"
                rx="4"
                fill="#0f172a"
                stroke="#334155"
                strokeWidth="1"
                opacity="0.95"
              />
              <text x="6" y="14" fill="#94a3b8" fontSize="9">
                {new Date(detailEntry.timestamp).toLocaleString([], {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </text>
              <text x="6" y="30" fill={color} fontSize="11" fontWeight="bold">
                {METRIC_LABELS[metric]}: {hoveredPoint.val.toFixed(2)}
              </text>
            </g>
          </g>
        )}

        {/* Data points (rendered after crosshair so hover circle is on top) */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={i === detailIndex ? 5 : 3}
            fill={color}
            className="cursor-pointer"
            opacity={hoverIndex === null || i === detailIndex ? 1 : 0.4}
          />
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
          {hoverIndex !== null
            ? `Hovered: ${hoveredPoint?.val.toFixed(2)}`
            : `Current: ${values[values.length - 1].toFixed(2)}`}
        </span>
      </div>

      {/* ── Detail panel: snapshot breakdown ─────────────────────── */}
      {detailEntry && (
        <SnapshotDetail
          entry={detailEntry}
          isHovered={hoverIndex !== null}
        />
      )}
    </div>
  );
}

// ── Snapshot detail panel ─────────────────────────────────────────

interface SnapshotDetailProps {
  entry: HistoryEntry;
  isHovered: boolean;
}

function SnapshotDetail({ entry, isHovered }: SnapshotDetailProps) {
  const timeLabel = new Date(entry.timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="mt-4 pt-4 border-t border-slate-800">
      <div className="flex items-center gap-2 mb-3">
        <span className={`text-xs font-bold ${isHovered ? 'text-brand-300' : 'text-slate-400'}`}>
          {isHovered ? '◉ Hovered snapshot' : '○ Latest snapshot'}
        </span>
        <span className="text-xs text-slate-500">· {timeLabel}</span>
        <span className="text-xs text-slate-600">
          · {entry.marketCount} markets, {entry.signalCount} signals, {entry.newsCount} news
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Markets */}
        <DetailColumn
          title="Markets"
          color={METRIC_COLORS.marketCount}
          count={entry.marketCount}
          items={entry.topMarkets?.map((m) => ({
            id: m.id,
            label: m.question,
            sub: `${PLATFORM_LABELS[m.platform] ?? m.platform}${m.yesPrice !== undefined ? ` · Yes: ${(m.yesPrice * 100).toFixed(0)}%` : ''}${m.volume24h !== undefined ? ` · $${formatVolume(m.volume24h)}` : ''}`,
            url: m.url,
          }))}
          emptyText="No market data in this snapshot"
        />

        {/* Signals */}
        <DetailColumn
          title="Signals"
          color={METRIC_COLORS.signalCount}
          count={entry.signalCount}
          items={entry.topSignals?.map((s) => ({
            id: s.id,
            label: s.text,
            sub: `${PLATFORM_LABELS[s.platform] ?? s.platform} · @${s.author} · 🔥${s.virality.toFixed(0)} · ${s.sentiment >= 0 ? '📈' : '📉'}${s.sentiment.toFixed(2)}`,
            url: s.url,
          }))}
          emptyText="No signal data in this snapshot"
        />

        {/* News */}
        <DetailColumn
          title="News"
          color={METRIC_COLORS.newsCount}
          count={entry.newsCount}
          items={entry.topNews?.map((n) => ({
            id: n.id,
            label: n.headline,
            sub: `${PLATFORM_LABELS[n.source] ?? n.source} · ${new Date(n.publishedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}`,
            url: n.url,
          }))}
          emptyText="No news data in this snapshot"
        />
      </div>
    </div>
  );
}

// ── Detail column (reusable) ─────────────────────────────────────

interface DetailItem {
  id: string;
  label: string;
  sub: string;
  url?: string;
}

interface DetailColumnProps {
  title: string;
  color: string;
  count: number;
  items?: DetailItem[];
  emptyText: string;
}

function DetailColumn({ title, color, count, items, emptyText }: DetailColumnProps) {
  return (
    <div className="rounded-md bg-slate-950/50 border border-slate-800 p-2 flex flex-col">
      <div className="flex items-center justify-between mb-2 shrink-0">
        <span className="text-xs font-bold" style={{ color }}>
          {title}
        </span>
        <span className="text-xs text-slate-600">
          {items?.length ?? 0} / {count}
        </span>
      </div>
      {items && items.length > 0 ? (
        <ul className="space-y-1.5 overflow-y-auto max-h-96 pr-1">
          {items.map((item) => (
            <li key={item.id} className="text-xs">
              {item.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded px-1.5 py-1 hover:bg-slate-800 transition-colors group"
                >
                  <span className="text-slate-300 group-hover:text-slate-100 leading-tight block">
                    {item.label}
                  </span>
                  <span className="text-slate-600 group-hover:text-slate-500 block mt-0.5">
                    {item.sub}
                  </span>
                </a>
              ) : (
                <div className="block rounded px-1.5 py-1">
                  <span className="text-slate-300 leading-tight block">
                    {item.label}
                  </span>
                  <span className="text-slate-600 block mt-0.5">
                    {item.sub}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-600 px-1.5 py-1">{emptyText}</p>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(0)}K`;
  return vol.toFixed(0);
}

export const HistoryChart = memo(HistoryChartImpl);