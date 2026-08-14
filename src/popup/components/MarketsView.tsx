/**
 * MarketsView component — browse cached prediction market contracts.
 */

import React, { useState } from 'react';
import type { MarketContract, MarketPlatform } from '@/types';

interface MarketsViewProps {
  markets: MarketContract[];
  loading: boolean;
}

export function MarketsView({ markets, loading }: MarketsViewProps) {
  const [filter, setFilter] = useState<MarketPlatform | 'all'>('all');
  const [search, setSearch] = useState('');

  const filtered = markets.filter((m) => {
    if (filter !== 'all' && m.platform !== filter) return false;
    if (search && !m.question.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-2">
      {/* Search */}
      <input
        type="text"
        placeholder="Search markets…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-md focus:outline-none focus:border-brand-400"
      />

      {/* Platform filter */}
      <div className="flex gap-1">
        {(['all', 'polymarket', 'kalshi'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex-1 py-1 text-[10px] font-medium rounded transition-colors ${
              filter === f
                ? 'bg-brand-500 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {f === 'all' ? 'All' : f}
          </button>
        ))}
      </div>

      {/* Market list */}
      {loading && <p className="text-xs text-slate-500 text-center py-4">Loading markets…</p>}
      {!loading && filtered.length === 0 && (
        <p className="text-xs text-slate-500 text-center py-4">No markets found.</p>
      )}
      <div className="space-y-1.5">
        {filtered.map((market) => (
          <MarketRow key={`${market.platform}:${market.id}`} market={market} />
        ))}
      </div>
    </div>
  );
}

function MarketRow({ market }: { market: MarketContract }) {
  const yesOutcome = market.outcomes.find((o) => o.label.toLowerCase() === 'yes');
  const yesPct = yesOutcome ? (yesOutcome.price * 100).toFixed(0) : '—';

  return (
    <div className="bg-slate-800 rounded-lg p-2 hover:bg-slate-750 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-slate-200 flex-1 line-clamp-2">{market.question}</p>
        <span className="text-xs font-bold text-brand-400 shrink-0">{yesPct}%</span>
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px] text-slate-500 capitalize">{market.platform}</span>
        {market.volume24h != null && (
          <span className="text-[10px] text-slate-600">
            Vol: ${(market.volume24h / 1000).toFixed(1)}k
          </span>
        )}
      </div>
    </div>
  );
}