/**
 * MarketOdds — displays prediction market contracts with their odds.
 * Shows platform, question, Yes/No probabilities, volume, and expiry.
 * Includes star toggle for adding/removing from watchlist (Phase 3).
 */

import { useState, useEffect, useCallback } from 'react';
import type { MarketContract, WatchlistEntry } from '@/types';
import { sendMessage } from '@/messaging';
import { browser } from '@/messaging/browser';
import { CONFIG } from '@/config';
import { StarToggle } from './Watchlist';

interface MarketOddsProps {
  markets: MarketContract[];
}

const platformBadges: Record<string, { icon: string; color: string }> = {
  polymarket: { icon: '🔵', color: 'bg-blue-900/50 text-blue-300' },
  kalshi: { icon: '🟢', color: 'bg-green-900/50 text-green-300' },
};

export function MarketOdds({ markets }: MarketOddsProps) {
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);

  // Fetch watchlist to know which markets are starred
  const fetchWatchlist = useCallback(async () => {
    try {
      const result = await sendMessage('GET_WATCHLIST', {});
      if (result && typeof result === 'object' && 'watchlist' in result) {
        setWatchlist((result as { watchlist: WatchlistEntry[] }).watchlist);
      }
    } catch {
      // Fallback to storage
      try {
        const storageResult = await browser.storage.local.get(CONFIG.storage.watchlist);
        setWatchlist((storageResult[CONFIG.storage.watchlist] as WatchlistEntry[]) ?? []);
      } catch {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    fetchWatchlist();
    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      if (changes[CONFIG.storage.watchlist]?.newValue) {
        setWatchlist(changes[CONFIG.storage.watchlist].newValue as WatchlistEntry[]);
      }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, [fetchWatchlist]);

  const handleStarToggle = useCallback(async (market: MarketContract, isWatched: boolean) => {
    if (isWatched) {
      await sendMessage('REMOVE_FROM_WATCHLIST', { contractId: market.id });
    } else {
      await sendMessage('ADD_TO_WATCHLIST', {
        entry: {
          contractId: market.id,
          platform: market.platform,
          question: market.question,
          addedAt: Date.now(),
        },
      });
    }
  }, []);

  const isWatched = (market: MarketContract) =>
    watchlist.some((w) => w.contractId === market.id && w.platform === market.platform);

  // Sort each platform by volume descending, then interleave so the
  // tab shows a balanced mix (e.g. 25 Polymarket + 25 Kalshi) instead
  // of being dominated by whichever platform has more markets.
  const perPlatform = 25;
  const byPlatform = new Map<string, MarketContract[]>();
  for (const m of markets) {
    const list = byPlatform.get(m.platform) ?? [];
    list.push(m);
    byPlatform.set(m.platform, list);
  }
  const sortedPerPlatform = Array.from(byPlatform.values()).map((list) =>
    [...list].sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0)).slice(0, perPlatform),
  );
  // Interleave: take turns picking one market from each platform's top list
  const sorted: MarketContract[] = [];
  const maxLen = Math.max(...sortedPerPlatform.map((l) => l.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const list of sortedPerPlatform) {
      if (i < list.length) sorted.push(list[i]);
    }
  }

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
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
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
              <StarToggle
                market={market}
                isWatched={isWatched(market)}
                onToggle={handleStarToggle}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}