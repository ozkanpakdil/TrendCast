/**
 * NewsFeed — grid view of news headlines, styled like the HypeFeed.
 *
 * Tile color reflects the source (each outlet gets a distinct accent).
 */

import { useMemo, memo } from 'react';
import type { NewsItem } from '@/types';

interface NewsFeedProps {
  news: NewsItem[];
}

const sourceLabels: Record<string, string> = {
  bbc: 'BBC',
  cnn: 'CNN',
  yahoo: 'Yahoo',
  googleFinance: 'Google',
  seekingalpha: 'Seeking Alpha',
  investing: 'Investing.com',
};

/**
 * Map a source to a background color (dark, saturated tile).
 * Each source gets a distinct accent so tiles are visually scannable.
 */
function sourceColor(source: string): string {
  const palette: Record<string, [number, number, number]> = {
    bbc: [220, 38, 38],          // red
    cnn: [190, 24, 93],          // pink/rose
    yahoo: [124, 58, 237],       // violet
    googleFinance: [16, 185, 129], // emerald
    seekingalpha: [245, 158, 11],  // amber
    investing: [14, 165, 233],     // sky
  };
  const [r, g, b] = palette[source] ?? [51, 65, 85]; // slate fallback
  return `rgb(${r},${g},${b})`;
}

/** Pick readable text color for a tile. */
function textColor(source: string): string {
  return source === 'seekingalpha' || source === 'investing' ? '#0f172a' : '#ffffff';
}

/** Format publish time into a compact string. */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function NewsFeedImpl({ news }: NewsFeedProps) {
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
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
      {sorted.map((item) => {
        const bg = sourceColor(item.source);
        const fg = textColor(item.source);

        return (
          <a
            key={item.id}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="card-hover rounded-lg border hover:border-slate-600 cursor-pointer block p-2.5 border-slate-800"
            style={{ backgroundColor: bg, color: fg, minHeight: '100px' }}
          >
            <div className="flex items-start justify-between gap-1 mb-1">
              <span className="text-[9px] font-bold uppercase opacity-80">
                {sourceLabels[item.source] ?? item.source}
              </span>
              <span className="opacity-70 text-[9px]">{formatTime(item.publishedAt)}</span>
            </div>
            <p
              className="font-semibold leading-tight mb-1"
              style={{
                fontSize: '11px',
                lineHeight: '1.2',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {item.headline}
            </p>
            <div className="flex flex-col gap-1">
              {item.keywords.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {item.keywords.slice(0, 4).map((kw) => (
                    <span
                      key={kw}
                      className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-black/20 opacity-80"
                    >
                      #{kw}
                    </span>
                  ))}
                </div>
              )}
              {item.summary && (
                <span className="opacity-70 text-[9px] line-clamp-1">{item.summary}</span>
              )}
            </div>
          </a>
        );
      })}
    </div>
  );
}

export const NewsFeed = memo(NewsFeedImpl);