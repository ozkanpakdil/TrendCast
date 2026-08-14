/**
 * NewsFeed — displays news headlines from BBC and CNN.
 * Shows source, headline, publish time, and thumbnail if available.
 */

import { useMemo, memo } from 'react';
import type { NewsItem } from '@/types';

interface NewsFeedProps {
  news: NewsItem[];
}

const sourceColors: Record<string, string> = {
  bbc: 'bg-red-900/50 text-red-300',
  cnn: 'bg-red-800/50 text-red-200',
};

function NewsFeedImpl({ news }: NewsFeedProps) {
  const sorted = useMemo(
    () =>
      [...news].sort(
        (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
      ),
    [news],
  );

  return (
    <div className="space-y-2">
      {sorted.length === 0 && (
        <p className="text-slate-500 text-sm text-center py-8">
          No news collected yet. Wait for the next hourly collection.
        </p>
      )}
      {sorted.map((item) => (
        <a
          key={item.id}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="card-hover block rounded-lg p-3 bg-slate-900 border border-slate-800 hover:border-slate-700"
        >
          <div className="flex items-start gap-3">
            {item.imageUrl && (
              <img
                src={item.imageUrl}
                alt=""
                className="flex-shrink-0 w-16 h-16 rounded object-cover"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${sourceColors[item.source] ?? 'bg-slate-700 text-slate-300'}`}
                >
                  {item.source}
                </span>
                <span className="text-xs text-slate-500">
                  {new Date(item.publishedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <p className="text-sm text-slate-200 line-clamp-2">{item.headline}</p>
              {item.summary && (
                <p className="text-xs text-slate-500 mt-1 line-clamp-1">{item.summary}</p>
              )}
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}

export const NewsFeed = memo(NewsFeedImpl);