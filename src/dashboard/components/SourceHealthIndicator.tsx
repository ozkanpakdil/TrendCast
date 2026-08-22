/**
 * SourceHealthIndicator — read-only per-source health badges.
 *
 * Renders one badge per news source showing its semantic health state
 * plus "fetched N · correlated M" so the user can see at a glance whether
 * a source failed to fetch (degraded), went stale, or simply had no
 * correlated items (fetched vs correlated decoupled — REL-01/REL-02).
 *
 * Modeled on CorrelationStatsBar (memo, isDark prop, badge row).
 */

import { memo } from 'react';
import type { NewsSource, SourceHealth } from '@/types';
import { computeHealth, type SourceHealthState } from '@/utils/source-health';
import { CONFIG } from '@/config';

interface SourceHealthIndicatorProps {
  health: SourceHealth;
  correlatedCounts: Partial<Record<NewsSource, number>>;
  isDark: boolean;
  loading: boolean;
  error?: boolean;
}

/** Display labels for each news source. */
const sourceLabels: Record<NewsSource, string> = {
  bbc: 'BBC',
  cnn: 'CNN',
  yahoo: 'Yahoo',
  googleFinance: 'Google',
  seekingalpha: 'Seeking Alpha',
  investing: 'Investing.com',
};

/** Ordered list of sources to render (stable order). */
const SOURCE_ORDER: NewsSource[] = [
  'bbc',
  'cnn',
  'yahoo',
  'googleFinance',
  'seekingalpha',
  'investing',
];

/** Status word + color classes per health state (never brand-500). */
const STATE_META: Record<SourceHealthState, { label: string; dot: string; badge: string }> = {
  healthy: { label: 'Healthy', dot: 'bg-bull', badge: 'text-bull bg-bull/15' },
  stale: { label: 'Stale', dot: 'bg-amber-500', badge: 'text-amber-500 bg-amber-500/15' },
  degraded: { label: 'Degraded', dot: 'bg-bear', badge: 'text-bear bg-bear/15' },
  'no-data': { label: 'No data', dot: 'bg-neutral', badge: 'text-neutral bg-neutral/15' },
};

function SourceHealthIndicatorImpl({
  health,
  correlatedCounts,
  isDark,
  loading,
  error,
}: SourceHealthIndicatorProps) {
  const now = Date.now();
  const stalenessThresholdMs = CONFIG.collection.stalenessThresholdMs;

  // loading: render placeholder skeleton badges instead of empty copy.
  if (loading) {
    return (
      <div className="mb-3">
        <div className="flex flex-wrap gap-2" aria-busy="true" aria-label="Loading source health">
          {SOURCE_ORDER.map((source) => (
            <div
              key={source}
              className={`flex items-center gap-2 px-2 py-1 rounded text-xs animate-pulse ${
                isDark ? 'bg-slate-800' : 'bg-light-border'
              }`}
            >
              <span className="inline-block w-2 h-2 rounded-full bg-neutral/40" />
              <span className="font-semibold opacity-60">{sourceLabels[source]}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Error: snapshot read failure.
  if (error) {
    return (
      <div className="mb-3">
        <p
          className={`text-[12px] ${isDark ? 'text-red-400/80' : 'text-red-600/80'}`}
          role="alert"
        >
          Health data unavailable — check your connection and run collection again.
        </p>
      </div>
    );
  }

  // Empty: no sourceHealth entries at all.
  const hasAnyEntry = SOURCE_ORDER.some((source) => health[source] !== undefined);
  if (!hasAnyEntry) {
    return (
      <div className="mb-3">
        <p className={`text-[12px] ${isDark ? 'text-slate-400' : 'text-light-muted'}`}>
          <span className="font-semibold">No health data available</span>
          <span className="opacity-80"> — Run a collection to see per-source status.</span>
        </p>
      </div>
    );
  }

  // Populated / partial / overflow / zero-one-many: render the badge row.
  return (
    <div className="mb-3">
      <div className="flex flex-wrap gap-2">
        {SOURCE_ORDER.map((source) => {
          const entry = health[source];
          const state = computeHealth(entry, stalenessThresholdMs, now);
          const meta = STATE_META[state];
          const fetched = entry?.itemCount ?? 0;
          const correlated = correlatedCounts[source] ?? 0;

          return (
            <div
              key={source}
              className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${meta.badge}`}
              title={`${sourceLabels[source]}: ${meta.label} — fetched ${fetched} · correlated ${correlated}`}
            >
              <span className={`inline-block w-2 h-2 rounded-full ${meta.dot}`} />
              <span className="font-semibold">{sourceLabels[source]}</span>
              <span className="opacity-80">{meta.label}</span>
              <span className="tabular-nums opacity-80">
                fetched {fetched} · correlated {correlated}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const SourceHealthIndicator = memo(SourceHealthIndicatorImpl);
