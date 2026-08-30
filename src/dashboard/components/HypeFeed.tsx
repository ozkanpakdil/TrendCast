/**
 * HypeFeed — grid view of trending social signals.
 *
 * Tile color reflects sentiment (green = bullish, red = bearish, slate = neutral).
 */

import { useMemo, memo } from 'react';
import type { SocialSignal } from '@/types';
import { VirtualizedGrid } from './VirtualizedGrid';

interface HypeFeedProps {
  signals: SocialSignal[];
  highlightThreshold: number;
  compact?: boolean;
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

/**
 * Virality badge color: heat scale from slate (cold) through amber to red
 * (hot). Score ≥ highlightThreshold gets the hottest color.
 */
function viralityColor(score: number, threshold: number): string {
  if (score >= threshold) return '#ef4444'; // hot — red
  const t = Math.min(score / Math.max(threshold, 1), 1); // 0..1
  // interpolate slate → amber → red
  if (t < 0.5) {
    const u = t / 0.5;
    const r = Math.round(100 + u * (245 - 100));
    const g = Math.round(116 + u * (158 - 116));
    const b = Math.round(139 + u * (11 - 139));
    return `rgb(${r},${g},${b})`;
  }
  const u = (t - 0.5) / 0.5;
  const r = Math.round(245 + u * (239 - 245));
  const g = Math.round(158 + u * (68 - 158));
  const b = Math.round(11 + u * (68 - 11));
  return `rgb(${r},${g},${b})`;
}

function HypeFeedImpl({ signals, highlightThreshold, compact = false }: HypeFeedProps) {
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
    <VirtualizedGrid
      items={sorted.map((signal) => {
        const icon = platformIcons[signal.platform] ?? '?';
        const bg = heatColor(signal.sentiment);
        const fg = textColor(signal.sentiment);
        const isHot = signal.virality >= highlightThreshold;
        const scoreColor = viralityColor(signal.virality, highlightThreshold);
        const engagement = formatEngagement(signal);

        const Wrapper = signal.url ? 'a' : 'div';
        const wrapperProps = signal.url
          ? { href: signal.url, target: '_blank', rel: 'noopener noreferrer' }
          : {};

        return (
          <Wrapper
            key={`${signal.platform}:${signal.id}`}
            {...wrapperProps}
            className={`card-hover rounded-lg border cursor-pointer block ${
              isHot
                ? 'border-brand-500/40 shadow-lg shadow-brand-500/10'
                : 'border-slate-800 hover:border-slate-600'
            }`}
            style={{ backgroundColor: bg, color: fg, padding: compact ? '8px 10px' : '10px 12px', minHeight: compact ? '76px' : '100px' }}
          >
            <div className="flex items-start justify-between gap-1 mb-1">
              <span className="text-[9px] font-bold uppercase opacity-80">
                {icon} {signal.platform}
              </span>
              <span
                className="font-bold text-sm px-1.5 rounded"
                style={{
                  color: scoreColor,
                  backgroundColor: 'rgba(0,0,0,0.25)',
                }}
                title={`Virality ${Math.round(signal.virality)} (hot ≥ ${highlightThreshold})`}
              >
                {Math.round(signal.virality)}
              </span>
            </div>
            <p
              className="font-semibold leading-tight mb-1"
              style={{
                fontSize: compact ? '10.5px' : '11px',
                lineHeight: '1.25',
                display: '-webkit-box',
                WebkitLineClamp: compact ? 2 : 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {signal.text}
            </p>
            {/* Virality score bar — makes the score readable at a glance */}
            <div className="h-0.5 rounded-full bg-black/25 mb-1" aria-hidden>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, (signal.virality / Math.max(highlightThreshold * 1.5, 1)) * 100)}%`,
                  backgroundColor: scoreColor,
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              {signal.keywords.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {signal.keywords.slice(0, compact ? 2 : 4).map((kw) => (
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
                <span className="opacity-70 text-[9px] truncate">@{signal.author}</span>
                {engagement && (
                  <span className="opacity-70 text-[9px] whitespace-nowrap">
                    {engagement}
                  </span>
                )}
              </div>
            </div>
          </Wrapper>
        );
      })}
    />
  );
}

export const HypeFeed = memo(HypeFeedImpl);