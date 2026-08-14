/**
 * HypeFeed — treemap/heatmap view of trending social signals.
 *
 * Tile size is proportional to virality score (higher virality = bigger tile).
 * Tile color reflects sentiment (green = bullish, red = bearish, slate = neutral).
 * Layout uses the squarified treemap algorithm for good aspect ratios.
 *
 * Same pattern as MarketOdds: heatmap (treemap) + grid (uniform boxes) toggle.
 */

import { useState, useEffect, useRef, useMemo, memo } from 'react';
import type { SocialSignal } from '@/types';
import { squarify, type TreemapRect } from '../utils/treemap';

interface HypeFeedProps {
  signals: SocialSignal[];
  highlightThreshold: number;
}

const platformIcons: Record<string, string> = {
  x: '𝕏',
  reddit: '👽',
  tiktok: '🎵',
};

/**
 * Map sentiment (-1..1) to a background color.
 * -1 = red (bearish), 0 = slate (neutral), +1 = green (bullish).
 */
function heatColor(sentiment: number): string {
  if (sentiment >= 0) {
    const t = Math.min(sentiment, 1); // 0..1
    const r = Math.round(30 + t * (22 - 30));   // 30→22
    const g = Math.round(41 + t * (163 - 41));   // 41→163
    const b = Math.round(59 + t * (74 - 59));     // 59→74
    return `rgb(${r},${g},${b})`;
  } else {
    const t = Math.min(-sentiment, 1); // 0..1
    const r = Math.round(30 + t * (220 - 30));  // 30→220
    const g = Math.round(41 + t * (38 - 41));    // 41→38
    const b = Math.round(59 + t * (38 - 59));    // 59→38
    return `rgb(${r},${g},${b})`;
  }
}

/** Pick text color (white/dark) based on sentiment intensity. */
function textColor(sentiment: number): string {
  const abs = Math.abs(sentiment);
  return abs > 0.3 ? '#ffffff' : '#cbd5e1';
}

/** Format engagement metrics into a compact string. */
function formatEngagement(signal: SocialSignal): string {
  const parts: string[] = [];
  if (signal.metrics.likes > 0) parts.push(`❤️ ${signal.metrics.likes}`);
  if (signal.metrics.comments > 0) parts.push(`💬 ${signal.metrics.comments}`);
  if (signal.metrics.views != null && signal.metrics.views > 0) parts.push(`👁️ ${signal.metrics.views}`);
  return parts.join('  ');
}

function HypeFeedImpl({ signals, highlightThreshold }: HypeFeedProps) {
  const [viewMode, setViewMode] = useState<'heatmap' | 'grid'>('heatmap');
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 800, height: 600 });

  // Track container size for treemap layout — debounced via rAF to avoid
  // rapid recomputation during layout transitions.
  useEffect(() => {
    if (!containerRef.current) return;
    let rafId = 0;
    const ro = new ResizeObserver((entries) => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) {
            setDims({ width: Math.round(width), height: Math.round(height) });
          }
        }
      });
    });
    ro.observe(containerRef.current);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);

  // Sort by virality descending, take top 50.
  // Ensure platform diversity: cap each platform at 20 items so no
  // single platform (e.g. Reddit with saturated virality=100) pushes
  // out all other platforms (e.g. X trends with virality 40–95).
  const sorted = useMemo(
    () => {
      const byVirality = [...signals].sort((a, b) => b.virality - a.virality);
      const perPlatform = new Map<string, number>();
      const result: SocialSignal[] = [];
      const maxPerPlatform = 20;
      for (const s of byVirality) {
        const count = perPlatform.get(s.platform) ?? 0;
        if (count < maxPerPlatform) {
          result.push(s);
          perPlatform.set(s.platform, count + 1);
        }
      }
      return result.slice(0, 50);
    },
    [signals],
  );

  // Build a lookup map from signal id → signal (O(n), reused by signalMap).
  const signalById = useMemo(() => {
    const map = new Map<string, SocialSignal>();
    for (const s of sorted) map.set(`${s.platform}:${s.id}`, s);
    return map;
  }, [sorted]);

  // Compute treemap rectangles — tile size proportional to virality.
  const rects = useMemo(() => {
    if (sorted.length === 0) return [];
    const inputs = sorted.map((s) => ({
      id: `${s.platform}:${s.id}`,
      value: Math.max(s.virality, 1), // avoid zero-area tiles
    }));
    return squarify(inputs, 0, 0, dims.width, dims.height);
  }, [sorted, dims.width, dims.height]);

  // Build a lookup from rect id → signal + rect — O(n) using signalById map.
  const signalMap = useMemo(() => {
    const map = new Map<string, { signal: SocialSignal; rect: TreemapRect }>();
    for (const rect of rects) {
      const signal = signalById.get(rect.id);
      if (signal) map.set(rect.id, { signal, rect });
    }
    return map;
  }, [rects, signalById]);

  if (sorted.length === 0) {
    return (
      <p className="text-slate-500 text-sm text-center py-8">
        No social signals collected yet. Visit X, Reddit, or TikTok to collect data,
        or wait for the next hourly collection.
      </p>
    );
  }

  return (
    <div>
      {/* View toggle */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => setViewMode('heatmap')}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            viewMode === 'heatmap'
              ? 'bg-brand-500 text-white'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
          }`}
        >
          🔥 Heatmap
        </button>
        <button
          onClick={() => setViewMode('grid')}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            viewMode === 'grid'
              ? 'bg-brand-500 text-white'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
          }`}
        >
          ▦ Grid
        </button>
      </div>

      {viewMode === 'heatmap' ? (
        <div
          ref={containerRef}
          className="relative w-full overflow-hidden rounded-lg border border-slate-800"
          style={{ height: '70vh', minHeight: '500px' }}
        >
          {Array.from(signalMap.values()).map(({ signal, rect }) => {
            const icon = platformIcons[signal.platform] ?? '?';
            const bg = heatColor(signal.sentiment);
            const fg = textColor(signal.sentiment);
            const isHot = signal.virality >= highlightThreshold;

            // Determine font size based on tile area.
            const area = rect.width * rect.height;
            const isLarge = area > 25000;
            const isMedium = area > 8000;
            const isSmall = area > 2500;

            const showText = isSmall;
            const showMetrics = isMedium;
            const showAuthor = isLarge;
            const showPlatform = isMedium;
            const showVirality = isMedium;

            const Wrapper = signal.url ? 'a' : 'div';
            const wrapperProps = signal.url
              ? { href: signal.url, target: '_blank', rel: 'noopener noreferrer' }
              : {};

            return (
              <Wrapper
                key={rect.id}
                {...wrapperProps}
                className={`absolute flex flex-col justify-between overflow-hidden cursor-pointer transition-opacity hover:opacity-80 hover:ring-2 hover:ring-white/30 ${
                  isHot ? 'ring-1 ring-brand-500/40' : ''
                }`}
                style={{
                  left: rect.x,
                  top: rect.y,
                  width: rect.width,
                  height: rect.height,
                  backgroundColor: bg,
                  color: fg,
                  padding: isLarge ? '10px' : isMedium ? '6px' : '3px',
                }}
              >
                {/* Top row: platform icon + virality */}
                {(showPlatform || showVirality) && (
                  <div className="flex items-start justify-between gap-1">
                    {showPlatform && (
                      <span
                        className="font-bold opacity-80"
                        style={{ fontSize: isLarge ? '12px' : '9px' }}
                      >
                        {icon} {signal.platform}
                      </span>
                    )}
                    {showVirality && (
                      <span
                        className="font-bold opacity-90"
                        style={{ fontSize: isLarge ? '14px' : '10px' }}
                      >
                        {Math.round(signal.virality)}
                      </span>
                    )}
                  </div>
                )}

                {/* Center: signal text */}
                {showText && (
                  <p
                    className="font-semibold leading-tight"
                    style={{
                      fontSize: isLarge ? '14px' : isMedium ? '11px' : '9px',
                      lineHeight: isLarge ? '1.3' : '1.2',
                      display: '-webkit-box',
                      WebkitLineClamp: isLarge ? 3 : isMedium ? 2 : 1,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {signal.text}
                  </p>
                )}

                {/* Bottom row: author + engagement */}
                {(showAuthor || showMetrics) && (
                  <div className="flex items-end justify-between gap-1">
                    {showAuthor && (
                      <span
                        className="opacity-70"
                        style={{ fontSize: isLarge ? '10px' : '8px' }}
                      >
                        @{signal.author}
                      </span>
                    )}
                    {showMetrics && (
                      <span
                        className="opacity-70"
                        style={{ fontSize: isLarge ? '10px' : '8px' }}
                      >
                        {formatEngagement(signal)}
                      </span>
                    )}
                  </div>
                )}

                {/* Tiny tiles: just show the platform icon */}
                {!showText && (
                  <span
                    className="m-auto font-bold"
                    style={{ fontSize: '10px' }}
                  >
                    {icon}
                  </span>
                )}
              </Wrapper>
            );
          })}
        </div>
      ) : (
        /* Uniform grid view — all tiles same size */
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
          {sorted.map((signal) => {
            const icon = platformIcons[signal.platform] ?? '?';
            const bg = heatColor(signal.sentiment);
            const fg = textColor(signal.sentiment);
            const isHot = signal.virality >= highlightThreshold;

            const Wrapper = signal.url ? 'a' : 'div';
            const wrapperProps = signal.url
              ? { href: signal.url, target: '_blank', rel: 'noopener noreferrer' }
              : {};

            return (
              <Wrapper
                key={`${signal.platform}:${signal.id}`}
                {...wrapperProps}
                className={`card-hover rounded-lg border hover:border-slate-600 cursor-pointer block p-2.5 ${
                  isHot
                    ? 'border-brand-500/40 shadow-lg shadow-brand-500/10'
                    : 'border-slate-800'
                }`}
                style={{ backgroundColor: bg, color: fg, minHeight: '100px' }}
              >
                <div className="flex items-start justify-between gap-1 mb-1">
                  <span className="text-[9px] font-bold uppercase opacity-80">
                    {icon} {signal.platform}
                  </span>
                  <span className="font-bold text-sm">{Math.round(signal.virality)}</span>
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
                  {signal.text}
                </p>
                <div className="flex items-end justify-between gap-1">
                  <span className="opacity-70 text-[9px]">@{signal.author}</span>
                  <span className="opacity-70 text-[9px]">
                    {formatEngagement(signal)}
                  </span>
                </div>
              </Wrapper>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const HypeFeed = memo(HypeFeedImpl);