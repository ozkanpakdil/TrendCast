/**
 * MarketOdds — displays prediction market contracts with their odds.
 * Shows platform, question, Yes/No probabilities, volume, and expiry.
 */

import type { MarketContract } from '@/types';

interface MarketOddsProps {
  markets: MarketContract[];
}

const platformBadges: Record<string, { icon: string; color: string }> = {
  polymarket: { icon: '🔵', color: 'bg-blue-900/50 text-blue-300' },
  kalshi: { icon: '🟢', color: 'bg-green-900/50 text-green-300' },
};

export function MarketOdds({ markets }: MarketOddsProps) {
  const sorted = [...markets].sort(
    (a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0),
  );

  return (
    <div className="space-y-2">
      {sorted.length === 0 && (
        <p className="text-slate-500 text-sm text-center py-8">
          No market data collected yet. Wait for the next hourly collection.
        </p>
      )}
      {sorted.slice(0, 50).map((market) => {
        const badge = platformBadges[market.platform] ?? {
          icon: '⚪',
          color: 'bg-slate-700 text-slate-300',
        };
        const yesOutcome = market.outcomes.find((o) => o.label.toLowerCase() === 'yes');
        const noOutcome = market.outcomes.find((o) => o.label.toLowerCase() === 'no');
        const yesPct = yesOutcome ? Math.round(yesOutcome.price * 100) : null;
        const noPct = noOutcome ? Math.round(noOutcome.price * 100) : null;

        return (
          <div
            key={`${market.platform}:${market.id}`}
            className="card-hover rounded-lg p-3 bg-slate-900 border border-slate-800"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${badge.color}`}>
                {badge.icon} {market.platform}
              </span>
              {market.volume24h != null && (
                <span className="text-xs text-slate-500">
                  Vol: ${(market.volume24h / 1000).toFixed(1)}K
                </span>
              )}
            </div>
            <p className="text-sm text-slate-200 mb-2 line-clamp-2">{market.question}</p>
            {yesPct != null && noPct != null && (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-6 rounded-full overflow-hidden flex bg-slate-800">
                  <div
                    className="bg-bull flex items-center justify-center text-[10px] font-bold text-white"
                    style={{ width: `${yesPct}%` }}
                  >
                    {yesPct > 15 && `Yes ${yesPct}%`}
                  </div>
                  <div
                    className="bg-bear flex items-center justify-center text-[10px] font-bold text-white"
                    style={{ width: `${noPct}%` }}
                  >
                    {noPct > 15 && `No ${noPct}%`}
                  </div>
                </div>
              </div>
            )}
            {market.endDate && (
              <p className="text-[10px] text-slate-600 mt-1">
                Ends: {new Date(market.endDate).toLocaleDateString()}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}