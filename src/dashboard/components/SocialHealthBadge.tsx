/**
 * SocialHealthBadge — single TikTok health badge (Phase 7, D-02).
 *
 * Renders one badge showing TikTok's semantic health state so the user sees
 * a graceful-degradation indicator when TikTok is unavailable (success
 * criterion 3). Reuses the existing `computeHealth` helper and the same
 * STATE_META status word + color classes as SourceHealthIndicator.
 *
 * When the TikTok entry is undefined (never reported), renders the no-data
 * state — the graceful degradation state for an unreachable source.
 *
 * Modeled on SourceHealthIndicator (memo, isDark prop, badge).
 */

import { memo } from 'react';
import type { SocialSourceHealth } from '@/types';
import { computeHealth, type SourceHealthState } from '@/utils/source-health';
import { CONFIG } from '@/config';

interface SocialHealthBadgeProps {
  health: SocialSourceHealth;
  isDark: boolean;
  loading: boolean;
}

/** Status word + color classes per health state (never brand-500). */
const STATE_META: Record<SourceHealthState, { label: string; dot: string; badge: string }> = {
  healthy: { label: 'Healthy', dot: 'bg-bull', badge: 'text-bull bg-bull/15' },
  stale: { label: 'Stale', dot: 'bg-amber-500', badge: 'text-amber-500 bg-amber-500/15' },
  degraded: { label: 'Degraded', dot: 'bg-bear', badge: 'text-bear bg-bear/15' },
  'no-data': { label: 'No data', dot: 'bg-neutral', badge: 'text-neutral bg-neutral/15' },
};

function SocialHealthBadgeImpl({ health, isDark, loading }: SocialHealthBadgeProps) {
  const now = Date.now();
  const stalenessThresholdMs = CONFIG.collection.stalenessThresholdMs;

  // loading: render a placeholder skeleton badge.
  if (loading) {
    return (
      <div
        className={`flex items-center gap-2 px-2 py-1 rounded text-xs animate-pulse ${
          isDark ? 'bg-slate-800' : 'bg-light-border'
        }`}
        aria-busy="true"
        aria-label="Loading TikTok health"
      >
        <span className="inline-block w-2 h-2 rounded-full bg-neutral/40" />
        <span className="font-semibold opacity-60">🎵 TikTok</span>
      </div>
    );
  }

  const entry = health.tiktok;
  const state = computeHealth(entry, stalenessThresholdMs, now);
  const meta = STATE_META[state];
  const fetched = entry?.itemCount ?? 0;

  return (
    <div
      className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${meta.badge}`}
      title={`TikTok: ${meta.label} — fetched ${fetched}`}
      data-testid="social-health-tiktok"
      data-state={state}
    >
      <span className={`inline-block w-2 h-2 rounded-full ${meta.dot}`} />
      <span className="font-semibold">🎵 TikTok</span>
      <span className="opacity-80">{meta.label}</span>
      <span className="tabular-nums opacity-80">fetched {fetched}</span>
    </div>
  );
}

export const SocialHealthBadge = memo(SocialHealthBadgeImpl);
