/**
 * AlertsTab — read-only list of correlation alerts (Phase 4, D-08).
 *
 * Renders each `AlertRecord` with a direction badge (bull/bear/mixed), the
 * market question, the top correlated signal/news headline, and a relative
 * timestamp. Provides a de-emphasized destructive "Clear all" action with a
 * two-step inline confirm (D-10).
 *
 * This is the in-dashboard surface for alerts — the fallback when OS
 * notifications are denied (D-07) and the persistent history view.
 */

import { useState, useMemo, memo } from 'react';
import type { AlertRecord } from '@/types';

interface AlertsTabProps {
  alerts: AlertRecord[];
  loading: boolean;
  error: string | null;
  onClear: () => Promise<void>;
  isDark: boolean;
}

/** Direction badge styling per the UI-SPEC color contract. */
const directionBadges: Record<AlertRecord['direction'], { label: string; arrow: string; cls: string }> = {
  bullish: { label: 'Bullish', arrow: '▲', cls: 'bg-green-900/50 text-green-300' },
  bearish: { label: 'Bearish', arrow: '▼', cls: 'bg-red-900/50 text-red-300' },
  mixed: { label: 'Mixed', arrow: '◆', cls: 'bg-slate-700 text-slate-300' },
};

/** Format an epoch ms as a relative time string (e.g. "2h ago"). */
function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function AlertsTabImpl({ alerts, loading, error, onClear, isDark }: AlertsTabProps) {
  const [confirming, setConfirming] = useState(false);

  // Newest first.
  const sorted = useMemo(() => [...alerts].sort((a, b) => b.alertedAt - a.alertedAt), [alerts]);

  const handleClear = async () => {
    if (!confirming) {
      setConfirming(true);
      // Revert the confirm state after 3s if the user doesn't confirm.
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    setConfirming(false);
    await onClear();
  };

  const muted = isDark ? 'text-slate-500' : 'text-light-muted';
  const card = isDark ? 'bg-slate-900 border-slate-800' : 'bg-light-surface border-light-border';

  if (loading) {
    return <p className="text-slate-500 text-sm text-center py-8">Loading alerts…</p>;
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-slate-500 text-sm mb-2">Couldn&apos;t load alerts.</p>
        <p className="text-slate-600 text-xs">Check your connection and try again.</p>
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-slate-500 text-sm mb-2">No alerts yet</p>
        <p className="text-slate-600 text-xs">
          Alerts appear here when a watchlisted market moves, or when a topic gains consensus across multiple sources.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-2">
        <h3 className={`text-xs font-bold uppercase tracking-wider ${muted}`}>
          🔔 Alerts ({sorted.length})
        </h3>
        <button
          onClick={handleClear}
          className={`text-xs font-medium transition-colors ${
            confirming
              ? 'text-bear font-bold'
              : isDark
                ? 'text-slate-500 hover:text-bear'
                : 'text-light-muted hover:text-bear'
          }`}
          title="Clear all alerts"
          aria-label="Clear all alerts"
        >
          {confirming ? 'Confirm clear?' : 'Clear all'}
        </button>
      </div>

      {sorted.map((alert) => {
        const badge = directionBadges[alert.direction] ?? directionBadges.mixed;
        const body = alert.topSignalText ?? alert.topNewsHeadline ?? '';
        const absTime = new Date(alert.alertedAt).toLocaleString();
        const isCrossSource = alert.kind === 'crossSource';
        const title = isCrossSource ? (alert.topicLabel ?? alert.question) : alert.question;
        const sourceBreakdown = isCrossSource && alert.sourceTypes ? alert.sourceTypes.join(' · ') : '';
        return (
          <div
            key={alert.id}
            className={`rounded-lg p-3 border ${card}`}
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${badge.cls}`}>
                    {badge.arrow} {badge.label}
                  </span>
                  {isCrossSource && (
                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-indigo-900/50 text-indigo-300">
                      Cross-source
                    </span>
                  )}
                  <span className={`text-[10px] ${muted}`} title={absTime}>
                    {relativeTime(alert.alertedAt)}
                  </span>
                </div>
                <p className={`text-sm line-clamp-2 ${isDark ? 'text-slate-200' : 'text-light-text'}`}>
                  {title}
                </p>
                {sourceBreakdown && (
                  <p className={`text-xs mt-0.5 ${muted}`}>{sourceBreakdown}</p>
                )}
                {body && (
                  <p className={`text-xs mt-1 line-clamp-2 ${muted}`}>{body}</p>
                )}
                {(alert.topNewsUrl || alert.topSignalUrl) && (
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {alert.topNewsUrl && (
                      <a
                        href={alert.topNewsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={`text-xs font-medium underline underline-offset-2 ${isDark ? 'text-indigo-300 hover:text-indigo-200' : 'text-brand-600 hover:text-brand-700'}`}
                      >
                        Source ↗
                      </a>
                    )}
                    {alert.topSignalUrl && (
                      <a
                        href={alert.topSignalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={`text-xs font-medium underline underline-offset-2 ${isDark ? 'text-indigo-300 hover:text-indigo-200' : 'text-brand-600 hover:text-brand-700'}`}
                      >
                        Social post ↗
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export const AlertsTab = memo(AlertsTabImpl);
