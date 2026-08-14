/**
 * Dashboard component — shows correlated markets and social signals overview.
 */

import React, { useEffect, useState } from 'react';
import { sendMessage } from '@/messaging';
import type { CorrelationMatch, ExtensionSettings, MarketContract } from '@/types';

interface DashboardProps {
  markets: MarketContract[];
  settings: ExtensionSettings;
}

export function Dashboard({ markets, settings }: DashboardProps) {
  const [correlations, setCorrelations] = useState<CorrelationMatch[]>([]);
  const [loading, setLoading] = useState(false);

  // Auto-correlate the top 3 markets by volume.
  useEffect(() => {
    const topMarkets = [...markets]
      .sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0))
      .slice(0, 3);

    if (topMarkets.length === 0) return;

    setLoading(true);
    Promise.all(
      topMarkets.map((m) => sendMessage('CORRELATE', { contractId: m.id })),
    )
      .then((results) => {
        const allMatches = results.flatMap((r) => {
          const response = r as { ok: boolean; data: CorrelationMatch[] };
          return response?.data ?? [];
        });
        setCorrelations(allMatches);
      })
      .catch((err) => console.error('[HypeMarket] Correlation failed:', err))
      .finally(() => setLoading(false));
  }, [markets]);

  return (
    <div className="space-y-3">
      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Markets" value={markets.length} />
        <StatCard
          label="Signals"
          value={correlations.length}
          accent={correlations.length > 0 ? 'bull' : 'neutral'}
        />
        <StatCard
          label="Threshold"
          value={settings.notificationThreshold}
          suffix="/100"
        />
      </div>

      {/* Correlated matches */}
      <div>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
          Top Correlations
        </h2>
        {loading && <p className="text-xs text-slate-500">Analyzing…</p>}
        {!loading && correlations.length === 0 && (
          <p className="text-xs text-slate-500">No correlations found yet. Browse markets to trigger analysis.</p>
        )}
        <div className="space-y-2">
          {correlations.slice(0, 5).map((match, i) => (
            <CorrelationCard key={i} match={match} />
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  suffix,
  accent = 'neutral',
}: {
  label: string;
  value: number;
  suffix?: string;
  accent?: 'bull' | 'bear' | 'neutral';
}) {
  const colorClass =
    accent === 'bull' ? 'text-bull' : accent === 'bear' ? 'text-bear' : 'text-slate-200';
  return (
    <div className="bg-slate-800 rounded-lg p-2 text-center">
      <div className={`text-lg font-bold ${colorClass}`}>
        {value}
        {suffix}
      </div>
      <div className="text-[10px] text-slate-500 uppercase">{label}</div>
    </div>
  );
}

function CorrelationCard({ match }: { match: CorrelationMatch }) {
  const confidencePct = (match.confidence * 100).toFixed(0);
  return (
    <div className="bg-slate-800 rounded-lg p-2 border-l-2 border-brand-400">
      <p className="text-xs font-medium text-slate-200 line-clamp-2">{match.contract.question}</p>
      <div className="flex items-center justify-between mt-1">
        <div className="flex gap-1">
          {match.contract.outcomes.map((o) => (
            <span
              key={o.label}
              className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                o.label.toLowerCase() === 'yes'
                  ? 'bg-bull/20 text-bull'
                  : 'bg-bear/20 text-bear'
              }`}
            >
              {o.label} {(o.price * 100).toFixed(0)}%
            </span>
          ))}
        </div>
        <span className="text-[10px] text-brand-400 font-semibold">{confidencePct}%</span>
      </div>
      <div className="flex items-center gap-1 mt-1">
        <span className="text-[10px] text-slate-500 capitalize">{match.signal.platform}</span>
        <span className="text-[10px] text-slate-600">·</span>
        <span className="text-[10px] text-slate-500">
          🔥 {match.signal.virality.toFixed(0)}
        </span>
      </div>
    </div>
  );
}