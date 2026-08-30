/**
 * NewsFeed — grid view of news headlines.
 *
 * Cards use a neutral surface with a per-source accent (left border + label
 * color) so the grid reads as information, not a wall of saturated tiles.
 * Sentiment (when available) shows as a colored dot next to the source.
 */

import { useMemo, memo } from 'react';
import type { NewsItem } from '@/types';
import { sentimentScore } from '@/utils/sentiment';
import { VirtualizedGrid } from './VirtualizedGrid';

interface NewsFeedProps {
  news: NewsItem[];
  compact?: boolean;
}

const sourceLabels: Record<string, string> = {
  bbc: 'BBC',
  cnn: 'CNN',
  yahoo: 'Yahoo',
  googleFinance: 'Google',
  seekingalpha: 'Seeking Alpha',
  investing: 'Investing.com',
  usaStocksIndicator: 'Stock Indicator',
  stockScreener: 'Breakout',
  stockScreener2: 'VCP',
};

/**
 * Map a source to an accent color (used for the left border + source label).
 * Each source gets a distinct hue so cards are visually scannable without
 * saturating the whole tile.
 */
function sourceAccent(source: string): string {
  const palette: Record<string, string> = {
    bbc: '#ef4444',            // red
    cnn: '#ec4899',            // pink
    yahoo: '#8b5cf6',          // violet
    googleFinance: '#10b981',  // emerald
    seekingalpha: '#f59e0b',   // amber
    investing: '#0ea5e9',      // sky
    usaStocksIndicator: '#14b8a6', // teal
    stockScreener: '#f97316',  // orange
    stockScreener2: '#d946ef', // fuchsia
  };
  return palette[source] ?? '#64748b'; // slate fallback
}

/** Sentiment dot color: green (bullish), red (bearish), slate (neutral). */
function sentimentDot(sentiment: number): string {
  if (Math.abs(sentiment) < 0.15) return '#64748b';
  return sentiment > 0 ? '#22c55e' : '#ef4444';
}

/** Format publish time into a compact string. */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function NewsFeedImpl({ news, compact = false }: NewsFeedProps) {
  const sorted = useMemo(
    () =>
      [...news].sort(
        (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
      ),
    [news],
  );

  if (sorted.length === 0) {
    return (
      <p className="text-slate-500 text-sm text-center py-8">
        No news collected yet. Wait for the next hourly collection.
      </p>
    );
  }

  return (
    <VirtualizedGrid
      items={sorted.map((item) => {
        const accent = sourceAccent(item.source);
        const sentiment = sentimentScore(item.headline);
        const dot = sentimentDot(sentiment);
        const shownKeywords = item.keywords.slice(0, 3);
        const extraKeywords = item.keywords.length - shownKeywords.length;

        return (
          <a
            key={item.id}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="card-hover rounded-lg border border-slate-800 hover:border-slate-600 cursor-pointer block bg-slate-900 text-slate-100"
            style={{
              borderLeft: `3px solid ${accent}`,
              padding: compact ? '8px 10px' : '10px 12px',
              minHeight: compact ? '76px' : '100px',
            }}
          >
            <div className="flex items-center justify-between gap-1 mb-1">
              <span
                className="text-[9px] font-bold uppercase tracking-wide"
                style={{ color: accent }}
              >
                {sourceLabels[item.source] ?? item.source}
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: dot }}
                  title={`Sentiment ${sentiment.toFixed(2)}`}
                />
                <span className="text-slate-500 text-[9px] tabular-nums">
                  {formatTime(item.publishedAt)}
                </span>
              </span>
            </div>
            <p
              className="font-semibold text-slate-100 leading-tight mb-1"
              style={{
                fontSize: compact ? '10.5px' : '11px',
                lineHeight: '1.25',
                display: '-webkit-box',
                WebkitLineClamp: compact ? 2 : 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {item.headline}
            </p>
            {shownKeywords.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {shownKeywords.map((kw) => (
                  <span
                    key={kw}
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-800 text-slate-400"
                  >
                    #{kw}
                  </span>
                ))}
                {extraKeywords > 0 && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-800/60 text-slate-500">
                    +{extraKeywords}
                  </span>
                )}
              </div>
            )}
          </a>
        );
      })}
    />
  );
}

export const NewsFeed = memo(NewsFeedImpl);