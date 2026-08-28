/**
 * SourceHealthIndicator — compact, clickable per-source filter sidebar.
 *
 * Renders one small badge per news source showing its favicon + a health
 * dot. Clicking a badge toggles it as a news filter (multi-select). The
 * badge shows the semantic health state via the dot color and a tooltip
 * with fetched/correlated/fail counts.
 *
 * Modeled on CorrelationStatsBar (memo, isDark prop, badge row) but
 * rendered as a vertical sidebar so it doesn't take up the top of the
 * news tab.
 */

import { memo } from 'react';
import type { NewsItem, NewsSource, SourceHealth } from '@/types';
import { computeFetchedCounts, computeHealth, type SourceHealthState } from '@/utils/source-health';
import { CONFIG } from '@/config';

interface SourceHealthIndicatorProps {
  health: SourceHealth;
  correlatedCounts: Partial<Record<NewsSource, number>>;
  /** Per-source bridging coverage (CORR-04): items bridged / total collected. */
  bridgingCoverage?: Partial<Record<NewsSource, { total: number; bridged: number }>>;
  /** Accumulated news items — used to show the real per-source fetched count. */
  news: NewsItem[];
  /** Currently selected (filtered) sources. */
  selected: NewsSource[];
  /** Called when a source badge is toggled. */
  onToggle: (source: NewsSource) => void;
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
  usaStocksIndicator: 'Stock Indicator',
  stockScreener: 'Breakout',
  stockScreener2: 'VCP',
};

/** Domain used to fetch each source's favicon via Google's s2 service. */
const sourceDomains: Record<NewsSource, string> = {
  bbc: 'bbc.com',
  cnn: 'cnn.com',
  yahoo: 'finance.yahoo.com',
  googleFinance: 'news.google.com',
  seekingalpha: 'seekingalpha.com',
  investing: 'investing.com',
  usaStocksIndicator: 'ozkanpakdil.github.io',
  stockScreener: 'ozkanpakdil.github.io',
  stockScreener2: 'ozkanpakdil.github.io',
};

/** Ordered list of sources to render (stable order). */
const SOURCE_ORDER: NewsSource[] = [
  'bbc',
  'cnn',
  'yahoo',
  'googleFinance',
  'seekingalpha',
  'investing',
  'usaStocksIndicator',
  'stockScreener',
  'stockScreener2',
];

/** Status word + color classes per health state (never brand-500). */
const STATE_META: Record<SourceHealthState, { label: string; dot: string }> = {
  healthy: { label: 'Healthy', dot: 'bg-bull' },
  stale: { label: 'Stale', dot: 'bg-amber-500' },
  degraded: { label: 'Degraded', dot: 'bg-bear' },
  'no-data': { label: 'No data', dot: 'bg-neutral' },
};

/** Google favicon service URL for a source domain. */
function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}

function SourceHealthIndicatorImpl({
  health,
  correlatedCounts,
  bridgingCoverage,
  news,
  selected,
  onToggle,
  isDark,
  loading,
  error,
}: SourceHealthIndicatorProps) {
  const now = Date.now();
  const stalenessThresholdMs = CONFIG.collection.stalenessThresholdMs;
  const fetchedCounts = computeFetchedCounts(news);

  // loading: render placeholder skeleton badges instead of empty copy.
  if (loading) {
    return (
      <div className="flex flex-col gap-1.5" aria-busy="true" aria-label="Loading source health">
        {SOURCE_ORDER.map((source) => (
          <div
            key={source}
            className={`flex items-center gap-2 px-2 py-1 rounded text-xs animate-pulse ${
              isDark ? 'bg-slate-800' : 'bg-light-border'
            }`}
          >
            <span className="inline-block w-4 h-4 rounded-full bg-neutral/40" />
            <span className="font-semibold opacity-60">{sourceLabels[source]}</span>
          </div>
        ))}
      </div>
    );
  }

  // Error: snapshot read failure.
  if (error) {
    return (
      <p
        className={`text-[12px] ${isDark ? 'text-red-400/80' : 'text-red-600/80'}`}
        role="alert"
      >
        Health data unavailable — check your connection and run collection again.
      </p>
    );
  }

  // Empty: no sourceHealth entries at all.
  const hasAnyEntry = SOURCE_ORDER.some((source) => health[source] !== undefined);
  if (!hasAnyEntry) {
    return (
      <p className={`text-[12px] ${isDark ? 'text-slate-400' : 'text-light-muted'}`}>
        <span className="font-semibold">No health data</span>
        <span className="opacity-80"> — Run a collection.</span>
      </p>
    );
  }

  // Populated / partial / overflow / zero-one-many: render the filter sidebar.
  return (
    <div className="flex flex-col gap-1">
      {SOURCE_ORDER.map((source) => {
        const entry = health[source];
        const fetched = fetchedCounts[source] ?? 0;
        const state = computeHealth(entry, stalenessThresholdMs, now, fetched);
        const meta = STATE_META[state];
        const correlated = correlatedCounts[source] ?? 0;
        const fails = entry?.consecutiveFailures ?? 0;
        const active = selected.includes(source);
        // CORR-04: bridging coverage segment — defined 0/0 when absent or
        // empty so the tooltip never interpolates NaN/undefined.
        const coverage = bridgingCoverage?.[source];
        const bridged = coverage && coverage.total > 0 ? coverage.bridged : 0;
        const bridgedTotal = coverage && coverage.total > 0 ? coverage.total : 0;

        return (
          <button
            key={source}
            type="button"
            onClick={() => onToggle(source)}
            aria-pressed={active}
            title={`${sourceLabels[source]}: ${meta.label} — fetched ${fetched} · correlated ${correlated} · bridged ${bridged}/${bridgedTotal}${fails > 0 ? ` · ${fails} fail${fails === 1 ? '' : 's'}` : ''}${active ? ' (click to remove filter)' : ' (click to filter)'}`}
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
                src={faviconUrl(sourceDomains[source])}
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
            <span className="font-semibold truncate">{sourceLabels[source]}</span>
            <span className="ml-auto tabular-nums opacity-70">{fetched}</span>
          </button>
        );
      })}
    </div>
  );
}

export const SourceHealthIndicator = memo(SourceHealthIndicatorImpl);
