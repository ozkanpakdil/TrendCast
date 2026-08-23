/**
 * SocialSourceFilter — compact, clickable per-platform filter badges.
 *
 * Renders one small badge per social platform (X, Reddit, TikTok) showing
 * its favicon + a health dot. Clicking a badge toggles it as a social
 * filter (multi-select) for the correlations graph/list. The badge shows
 * the semantic health state via the dot color and a tooltip with the
 * fetched count.
 *
 * Mirrors SourceHealthIndicator's slim sidebar design but keyed by
 * `SocialPlatform` and driven by `SocialSourceHealth`.
 */

import { memo } from 'react';
import type { SocialPlatform, SocialSignal, SocialSourceHealth } from '@/types';
import { computeHealth, type SourceHealthState } from '@/utils/source-health';
import { CONFIG } from '@/config';

interface SocialSourceFilterProps {
  health: SocialSourceHealth;
  /** Accumulated social signals — used to show the real per-platform count. */
  signals: SocialSignal[];
  /** Currently selected (filtered) platforms. */
  selected: SocialPlatform[];
  /** Called when a platform badge is toggled. */
  onToggle: (platform: SocialPlatform) => void;
  isDark: boolean;
  loading: boolean;
}

/** Display labels for each social platform. */
const platformLabels: Record<SocialPlatform, string> = {
  x: 'X',
  reddit: 'Reddit',
  tiktok: 'TikTok',
};

/** Domain used to fetch each platform's favicon via Google's s2 service. */
const platformDomains: Record<SocialPlatform, string> = {
  x: 'x.com',
  reddit: 'reddit.com',
  tiktok: 'tiktok.com',
};

/** Ordered list of platforms to render (stable order). */
const PLATFORM_ORDER: SocialPlatform[] = ['x', 'reddit', 'tiktok'];

/** Status word + color classes per health state (never brand-500). */
const STATE_META: Record<SourceHealthState, { label: string; dot: string }> = {
  healthy: { label: 'Healthy', dot: 'bg-bull' },
  stale: { label: 'Stale', dot: 'bg-amber-500' },
  degraded: { label: 'Degraded', dot: 'bg-bear' },
  'no-data': { label: 'No data', dot: 'bg-neutral' },
};

/** Google favicon service URL for a platform domain. */
function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}

function SocialSourceFilterImpl({
  health,
  signals,
  selected,
  onToggle,
  isDark,
  loading,
}: SocialSourceFilterProps) {
  const now = Date.now();
  const stalenessThresholdMs = CONFIG.collection.stalenessThresholdMs;

  // Count accumulated signals per platform.
  const fetchedCounts = signals.reduce<Partial<Record<SocialPlatform, number>>>(
    (acc, signal) => {
      acc[signal.platform] = (acc[signal.platform] ?? 0) + 1;
      return acc;
    },
    {},
  );

  // loading: render placeholder skeleton badges.
  if (loading) {
    return (
      <div className="flex flex-col gap-1" aria-busy="true" aria-label="Loading platform health">
        {PLATFORM_ORDER.map((platform) => (
          <div
            key={platform}
            className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] animate-pulse ${
              isDark ? 'bg-slate-800' : 'bg-light-border'
            }`}
          >
            <span className="inline-block w-3.5 h-3.5 rounded-full bg-neutral/40" />
            <span className="font-semibold opacity-60">{platformLabels[platform]}</span>
          </div>
        ))}
      </div>
    );
  }

  // Populated: render the filter badges.
  return (
    <div className="flex flex-col gap-1">
      {PLATFORM_ORDER.map((platform) => {
        const entry = health[platform];
        const fetched = fetchedCounts[platform] ?? 0;
        const state = computeHealth(entry, stalenessThresholdMs, now, fetched);
        const meta = STATE_META[state];
        const active = selected.includes(platform);

        return (
          <button
            key={platform}
            type="button"
            onClick={() => onToggle(platform)}
            aria-pressed={active}
            title={`${platformLabels[platform]}: ${meta.label} — fetched ${fetched}${active ? ' (click to remove filter)' : ' (click to filter)'}`}
            className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] leading-tight transition-colors cursor-pointer ${
              active
                ? isDark
                  ? 'bg-slate-700 text-slate-100 ring-1 ring-slate-500'
                  : 'bg-slate-200 text-slate-900 ring-1 ring-slate-400'
                : isDark
                  ? 'hover:bg-slate-800 text-slate-300'
                  : 'hover:bg-light-border text-light-text'
            }`}
          >
            <span className="relative shrink-0">
              <img
                src={faviconUrl(platformDomains[platform])}
                alt=""
                width={14}
                height={14}
                className="w-3.5 h-3.5 rounded-sm"
                loading="lazy"
              />
              <span
                className={`absolute -bottom-0.5 -right-0.5 inline-block w-1.5 h-1.5 rounded-full ring-1 ${meta.dot} ${
                  isDark ? 'ring-slate-900' : 'ring-white'
                }`}
              />
            </span>
            <span className="font-semibold truncate">{platformLabels[platform]}</span>
            <span className="ml-auto tabular-nums opacity-70">{fetched}</span>
          </button>
        );
      })}
    </div>
  );
}

export const SocialSourceFilter = memo(SocialSourceFilterImpl);
