/**
 * MarketDrivenNews — the "📰 Market News" dashboard tab (Phase 5, D-09..D-12).
 *
 * Renders the derived `MarketNewsView` snapshot grouped by category
 * (finance / politics / technology). Each category lists its notable markets
 * with a direction badge (▲/▼/◆), the volume, and the top correlated news
 * headlines. Per-category lists reuse `VirtualizedGrid` so large result sets
 * don't regress responsiveness (D-12).
 *
 * All taxonomy (order + labels) is imported from `@/config/taxonomy` — nothing
 * is hardcoded here (Pitfall 3 anti-pattern).
 */

import { useMemo, memo } from 'react';
import type { MarketNewsView, MarketDrivenNewsItem } from '@/background/correlationNews';
import { CATEGORY_ORDER, CATEGORY_RULES } from '@/config/taxonomy';
import { VirtualizedGrid } from './VirtualizedGrid';

interface MarketDrivenNewsProps {
  view: MarketNewsView | null;
  loading: boolean;
  isDark: boolean;
}

/** Direction badge styling per the UI-SPEC color contract (mirrors AlertsTab). */
const directionBadges: Record<MarketDrivenNewsItem['direction'], { label: string; arrow: string; cls: string }> = {
  up: { label: 'Up', arrow: '▲', cls: 'bg-green-900/50 text-green-300' },
  down: { label: 'Down', arrow: '▼', cls: 'bg-red-900/50 text-red-300' },
  mixed: { label: 'Mixed', arrow: '◆', cls: 'bg-slate-700 text-slate-300' },
};

/** Format a volume number compactly (e.g. 12.4K, 1.2M). */
function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return `${v}`;
}

function MarketDrivenNewsImpl({ view, loading, isDark }: MarketDrivenNewsProps) {
  const muted = isDark ? 'text-slate-500' : 'text-light-muted';
  const card = isDark ? 'bg-slate-900 border-slate-800' : 'bg-light-surface border-light-border';

  if (loading) {
    return <p className="text-slate-500 text-sm text-center py-8">Loading market news…</p>;
  }

  // Empty state: no snapshot yet, or every category is empty.
  const hasContent = useMemo(() => {
    if (!view) return false;
    return CATEGORY_ORDER.some((cat) => (view.categories[cat]?.length ?? 0) > 0);
  }, [view]);

  if (!hasContent) {
    return (
      <div className="text-center py-8">
        <p className="text-slate-500 text-sm mb-2">No market-driven news yet</p>
        <p className="text-slate-600 text-xs">Run a correlation first — notable markets with correlated news appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {CATEGORY_ORDER.map((cat) => {
        const items = view?.categories[cat] ?? [];
        if (items.length === 0) return null;
        const rule = CATEGORY_RULES[cat];

        return (
          <section key={cat}>
            <h3 className={`text-xs font-bold uppercase tracking-wider mb-2 ${muted}`}>
              {rule.label} ({items.length})
            </h3>
            <VirtualizedGrid
              items={items.map((item) => {
                const badge = directionBadges[item.direction] ?? directionBadges.mixed;
                const topNews = item.news.slice(0, 3);
                return (
                  <div
                    key={item.contract.id}
                    className={`rounded-lg p-3 border ${card} flex flex-col gap-2`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${badge.cls}`}>
                        {badge.arrow} {badge.label}
                      </span>
                      <span className={`text-[10px] tabular-nums ${muted}`}>
                        Vol {formatVolume(item.volume24h)}
                      </span>
                    </div>
                    <p className={`text-sm line-clamp-2 ${isDark ? 'text-slate-200' : 'text-light-text'}`}>
                      {item.contract.question}
                    </p>
                    {topNews.length > 0 && (
                      <div className="mt-auto space-y-1">
                        {topNews.map((m) => (
                          <p key={m.news.id} className={`text-xs line-clamp-2 ${muted}`}>
                            {m.news.headline}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            />
          </section>
        );
      })}
    </div>
  );
}

export const MarketDrivenNews = memo(MarketDrivenNewsImpl);
