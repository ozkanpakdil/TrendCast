/**
 * HypeFeed — grid view of trending social signals.
 *
 * Tile color reflects sentiment (green = bullish, red = bearish, slate = neutral).
 */

import { useMemo, memo } from 'react';
import type { SocialSignal } from '@/types';

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
  // Sort by virality descending. Keep all posts — no per-platform cap.
  const sorted = useMemo(
    () => [...signals].sort((a, b) => b.virality - a.virality),
    [signals],
  );

  if (sorted.length === 0) {
    return (
      <p className="text-slate-500 text-sm text-center py-8">
        No social signals collected yet. Visit X, Reddit, or TikTok to collect data,
        or wait for the next hourly collection.
      </p>
    );
  }

  return (
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
            <div className="flex flex-col gap-1">
              {signal.keywords.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {signal.keywords.slice(0, 4).map((kw) => (
                    <span
                      key={kw}
                      className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-black/20 opacity-80"
                    >
                      #{kw}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-end justify-between gap-1">
                <span className="opacity-70 text-[9px]">@{signal.author}</span>
                <span className="opacity-70 text-[9px]">
                  {formatEngagement(signal)}
                </span>
              </div>
            </div>
          </Wrapper>
        );
      })}
    </div>
  );
}

export const HypeFeed = memo(HypeFeedImpl);