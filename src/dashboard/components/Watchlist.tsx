/**
 * Watchlist — displays the user's tracked markets.
 *
 * Users can star markets to add them to a personal watchlist.
 * The watchlist is stored in chrome.storage.local and persists
 * across sessions.
 *
 * Phase 3 roadmap item: custom watchlists.
 */

import { useState, useEffect, useCallback } from 'react';
import { browser } from '@/messaging/browser';
import { CONFIG } from '@/config';
import { sendMessage } from '@/messaging';
import type { MarketContract, WatchlistEntry } from '@/types';

interface WatchlistProps {
  /** All collected markets (to match against watchlist entries). */
  markets: MarketContract[];
}

const platformBadges: Record<string, { icon: string; color: string }> = {
  polymarket: { icon: '🔵', color: 'bg-blue-900/50 text-blue-300' },
  kalshi: { icon: '🟢', color: 'bg-green-900/50 text-green-300' },
};

export function Watchlist({ markets }: WatchlistProps) {
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchWatchlist = useCallback(async () => {
    try {
      const result = await sendMessage('GET_WATCHLIST', {});
      if (result && typeof result === 'object' && 'watchlist' in result) {
        setWatchlist((result as { watchlist: WatchlistEntry[] }).watchlist);
      }
    } catch (err) {
      console.error('[HypeMarket] Failed to fetch watchlist:', err);
      // Fallback: read directly from storage
      try {
        const storageResult = await browser.storage.local.get(CONFIG.storage.watchlist);
        setWatchlist((storageResult[CONFIG.storage.watchlist] as WatchlistEntry[]) ?? []);
      } catch {
        // ignore
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWatchlist();

    // Listen for storage changes
    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      if (changes[CONFIG.storage.watchlist]?.newValue) {
        setWatchlist(changes[CONFIG.storage.watchlist].newValue as WatchlistEntry[]);
      }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, [fetchWatchlist]);

  const handleRemove = useCallback(async (contractId: string) => {
    try {
      await sendMessage('REMOVE_FROM_WATCHLIST', { contractId });
      // The storage listener will update the state
    } catch (err) {
      console.error('[HypeMarket] Failed to remove from watchlist:', err);
    }
  }, []);

  if (loading) {
    return (
      <p className="text-slate-500 text-sm text-center py-8">Loading watchlist…</p>
    );
  }

  if (watchlist.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-slate-500 text-sm mb-2">
          Your watchlist is empty.
        </p>
        <p className="text-slate-600 text-xs">
          Click the ⭐ icon next to any market in the Markets tab to add it here.
        </p>
      </div>
    );
  }

  // Sort watchlist by addedAt (newest first)
  const sorted = [...watchlist].sort((a, b) => b.addedAt - a.addedAt);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
          ⭐ Watchlist ({watchlist.length})
        </h3>
      </div>
      {sorted.map((entry) => {
        // Find the live market data if available
        const liveMarket = markets.find(
          (m) => m.id === entry.contractId && m.platform === entry.platform,
        );
        const badge = platformBadges[entry.platform] ?? {
          icon: '⚪',
          color: 'bg-slate-700 text-slate-300',
        };

        // Get current odds if we have live data
        const yesOutcome = liveMarket?.outcomes.find((o) => o.label.toLowerCase() === 'yes');
        const noOutcome = liveMarket?.outcomes.find((o) => o.label.toLowerCase() === 'no');
        const yesPct = yesOutcome ? Math.round(yesOutcome.price * 100) : null;
        const noPct = noOutcome ? Math.round(noOutcome.price * 100) : null;

        return (
          <div
            key={`${entry.platform}:${entry.contractId}`}
            className="card-hover rounded-lg p-3 bg-slate-900 border border-slate-800"
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${badge.color}`}>
                    {badge.icon} {entry.platform}
                  </span>
                  {liveMarket?.volume24h != null && (
                    <span className="text-xs text-slate-500">
                      Vol: ${(liveMarket.volume24h / 1000).toFixed(1)}K
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-200 line-clamp-2">{entry.question}</p>

                {/* Odds bar (if live data available) */}
                {yesPct != null && noPct != null && (
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex-1 h-5 rounded-full overflow-hidden flex bg-slate-800">
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

                {!liveMarket && (
                  <p className="text-xs text-slate-600 mt-1 italic">
                    Market not in current collection (may have expired)
                  </p>
                )}

                <p className="text-[10px] text-slate-600 mt-1">
                  Added: {new Date(entry.addedAt).toLocaleDateString()}
                </p>
              </div>

              {/* Remove button */}
              <button
                onClick={() => handleRemove(entry.contractId)}
                className="flex-shrink-0 text-slate-500 hover:text-bear transition-colors text-lg"
                title="Remove from watchlist"
                aria-label="Remove from watchlist"
              >
                ⭐
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Star toggle button for adding/removing a market from the watchlist.
 * Used within the MarketOdds component.
 */
interface StarToggleProps {
  market: MarketContract;
  isWatched: boolean;
  onToggle: (market: MarketContract, watched: boolean) => void;
}

export function StarToggle({ market, isWatched, onToggle }: StarToggleProps) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle(market, isWatched);
      }}
      className={`flex-shrink-0 text-lg transition-colors ${
        isWatched ? 'text-yellow-400 hover:text-yellow-300' : 'text-slate-600 hover:text-yellow-400'
      }`}
      title={isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
      aria-label={isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
    >
      {isWatched ? '⭐' : '☆'}
    </button>
  );
}