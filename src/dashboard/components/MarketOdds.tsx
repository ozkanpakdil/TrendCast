/**
 * MarketOdds — treemap/heatmap view of prediction market contracts.
 *
 * Tile size is proportional to 24h volume (bigger volume = bigger tile).
 * Tile color reflects the Yes probability (green = high Yes, red = high No).
 * Layout uses the squarified treemap algorithm for good aspect ratios.
 *
 * Inspired by Yahoo Finance's stock heatmap:
 * https://finance.yahoo.com/markets/stocks/most-active/heatmap/
 */

import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import type { MarketContract, WatchlistEntry } from '@/types';
import { sendMessage } from '@/messaging';
import { browser } from '@/messaging/browser';
import { CONFIG } from '@/config';
import { WATCHLIST_VERSION } from '@/utils/watchlist';
import { StarToggle } from './Watchlist';
import { squarify, type TreemapRect } from '../utils/treemap';

interface MarketOddsProps {
  markets: MarketContract[];
}

const platformIcons: Record<string, string> = {
  polymarket: '🔵',
  kalshi: '🟢',
};

/** Map a probability (0–100) to a background color. */
function heatColor(pct: number | null): string {
  if (pct === null) return '#1e293b'; // slate-800
  // 50% = neutral dark, >50% = green tint, <50% = red tint
  if (pct >= 50) {
    // Interpolate from slate (50%) to green (100%)
    const t = (pct - 50) / 50; // 0..1
    const r = Math.round(30 + t * (22 - 30));   // 30→22
    const g = Math.round(41 + t * (163 - 41));   // 41→163
    const b = Math.round(59 + t * (74 - 59));    // 59→74
    return `rgb(${r},${g},${b})`;
  } else {
    // Interpolate from slate (50%) to red (0%)
    const t = (50 - pct) / 50; // 0..1
    const r = Math.round(30 + t * (220 - 30));   // 30→220
    const g = Math.round(41 + t * (38 - 41));    // 41→38
    const b = Math.round(59 + t * (38 - 59));    // 59→38
    return `rgb(${r},${g},${b})`;
  }
}

/** Pick text color (white/dark) based on background luminance. */
function textColor(pct: number | null): string {
  if (pct === null) return '#cbd5e1';
  return pct > 35 && pct < 65 ? '#cbd5e1' : '#ffffff';
}

/**
 * Get the primary probability for a market.
 * Prefers "Yes" outcome; falls back to first outcome.
 * Returns { pct, label } or null.
 */
function getPrimaryOdds(market: MarketContract): { pct: number; label: string } | null {
  const yesOutcome = market.outcomes.find((o) => o.label.toLowerCase() === 'yes');
  if (yesOutcome) {
    return { pct: Math.round(yesOutcome.price * 100), label: 'Yes' };
  }
  // For non-Yes/No markets (e.g. "Team A vs Team B"), use the first outcome.
  if (market.outcomes.length > 0) {
    const first = market.outcomes[0];
    return { pct: Math.round(first.price * 100), label: first.label };
  }
  return null;
}

/**
 * Resolve a clickable URL for a market.
 * Uses market.url if present; otherwise constructs from slug + platform.
 */
function getMarketUrl(market: MarketContract): string | undefined {
  if (market.url) return market.url;
  if (!market.slug) return undefined;
  if (market.platform === 'polymarket') return `https://polymarket.com/event/${market.slug}`;
  if (market.platform === 'kalshi') return `https://kalshi.com/markets/${market.slug}`;
  return undefined;
}

export function MarketOddsImpl({ markets }: MarketOddsProps) {
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [viewMode, setViewMode] = useState<'heatmap' | 'grid'>('heatmap');
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 800, height: 600 });

  // Fetch watchlist to know which markets are starred
  const fetchWatchlist = useCallback(async () => {
    try {
      const result = await sendMessage('GET_WATCHLIST', {});
      // The messaging layer wraps responses as { ok: true, data: ... }
      const unwrapped =
        result && typeof result === 'object' && 'ok' in result
          ? (result as { ok: boolean; data: unknown }).data
          : result;
      if (unwrapped && typeof unwrapped === 'object' && 'watchlist' in unwrapped) {
        setWatchlist((unwrapped as { watchlist: WatchlistEntry[] }).watchlist);
      }
    } catch {
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

  // Track container size for treemap layout — debounced via rAF
  useEffect(() => {
    if (!containerRef.current) return;
    let rafId = 0;
    const ro = new ResizeObserver((entries) => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) {
            setDims({ width: Math.round(width), height: Math.round(height) });
          }
        }
      });
    });
    ro.observe(containerRef.current);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);

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
          version: WATCHLIST_VERSION,
        },
      });
    }
  }, []);

  const isWatched = (market: MarketContract) =>
    watchlist.some((w) => w.contractId === market.id && w.platform === market.platform);

  // Sort by volume descending, take top 50.
  const sorted = useMemo(
    () =>
      [...markets]
        .sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0)),
    [markets],
  );

  // Compute treemap rectangles.
  const rects = useMemo(() => {
    if (sorted.length === 0) return [];
    const inputs = sorted.map((m) => ({
      id: `${m.platform}:${m.id}`,
      value: Math.max(m.volume24h ?? 1, 1), // avoid zero-area tiles
    }));
    return squarify(inputs, 0, 0, dims.width, dims.height);
  }, [sorted, dims.width, dims.height]);

  // Build a lookup map from market id → market (O(n), reused by marketMap).
  const marketById = useMemo(() => {
    const map = new Map<string, MarketContract>();
    for (const m of sorted) map.set(`${m.platform}:${m.id}`, m);
    return map;
  }, [sorted]);

  // Build a lookup from rect id → market + rect — O(n) using marketById map.
  const marketMap = useMemo(() => {
    const map = new Map<string, { market: MarketContract; rect: TreemapRect }>();
    for (const rect of rects) {
      const market = marketById.get(rect.id);
      if (market) map.set(rect.id, { market, rect });
    }
    return map;
  }, [rects, marketById]);

  if (sorted.length === 0) {
    return (
      <p className="text-slate-500 text-sm text-center py-8">
        No market data collected yet. Wait for the next hourly collection.
      </p>
    );
  }

  return (
    <div>
      {/* View toggle */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => setViewMode('heatmap')}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            viewMode === 'heatmap'
              ? 'bg-brand-500 text-white'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
          }`}
        >
          🔥 Heatmap
        </button>
        <button
          onClick={() => setViewMode('grid')}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            viewMode === 'grid'
              ? 'bg-brand-500 text-white'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
          }`}
        >
          ▦ Grid
        </button>
      </div>

      {viewMode === 'heatmap' ? (
        <div
          ref={containerRef}
          className="relative w-full overflow-hidden rounded-lg border border-slate-800"
          style={{ height: '70vh', minHeight: '500px' }}
        >
          {Array.from(marketMap.values()).map(({ market, rect }) => {
            const icon = platformIcons[market.platform] ?? '⚪';
            const odds = getPrimaryOdds(market);
            const pct = odds?.pct ?? null;
            const bg = heatColor(pct);
            const fg = textColor(pct);

            // Determine font size based on tile area.
            const area = rect.width * rect.height;
            const isLarge = area > 25000; // ~158x158
            const isMedium = area > 8000;  // ~89x89
            const isSmall = area > 2500;   // ~50x50

            // Only show text if tile is big enough.
            const showQuestion = isSmall;
            const showOdds = isMedium;
            const showVolume = isLarge;
            const showPlatform = isMedium;
            const showStar = isMedium;

            const href = getMarketUrl(market);
            const Wrapper = href ? 'a' : 'div';
            const wrapperProps = href
              ? { href, target: '_blank', rel: 'noopener noreferrer' }
              : {};

            return (
              <Wrapper
                key={rect.id}
                {...wrapperProps}
                className="absolute flex flex-col justify-between overflow-hidden cursor-pointer transition-opacity hover:opacity-80 hover:ring-2 hover:ring-white/30"
                style={{
                  left: rect.x,
                  top: rect.y,
                  width: rect.width,
                  height: rect.height,
                  backgroundColor: bg,
                  color: fg,
                  padding: isLarge ? '10px' : isMedium ? '6px' : '3px',
                }}
              >
                {/* Top row: platform icon + star */}
                {(showPlatform || showStar) && (
                  <div className="flex items-start justify-between gap-1">
                    {showPlatform && (
                      <span
                        className="font-bold uppercase opacity-80"
                        style={{ fontSize: isLarge ? '11px' : '9px' }}
                      >
                        {icon} {market.platform}
                      </span>
                    )}
                    {showStar && (
                      <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                        <StarToggle
                          market={market}
                          isWatched={isWatched(market)}
                          onToggle={handleStarToggle}
                        />
                      </span>
                    )}
                  </div>
                )}

                {/* Center: question text */}
                {showQuestion && (
                  <p
                    className="font-semibold leading-tight"
                    style={{
                      fontSize: isLarge ? '15px' : isMedium ? '11px' : '9px',
                      lineHeight: isLarge ? '1.3' : '1.2',
                      display: '-webkit-box',
                      WebkitLineClamp: isLarge ? 3 : isMedium ? 2 : 1,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {market.question}
                  </p>
                )}

                {/* Bottom row: odds + volume */}
                {(showOdds || showVolume) && (
                  <div className="flex items-end justify-between gap-1">
                    {showOdds && pct !== null && (
                      <span
                        className="font-bold"
                        style={{ fontSize: isLarge ? '18px' : '12px' }}
                      >
                        {pct}%
                      </span>
                    )}
                    {showVolume && market.volume24h != null && (
                      <span
                        className="opacity-70"
                        style={{ fontSize: isLarge ? '10px' : '8px' }}
                      >
                        ${(market.volume24h / 1000).toFixed(0)}K
                      </span>
                    )}
                  </div>
                )}

                {/* Tiny tiles: just show the percentage if available */}
                {!showQuestion && pct !== null && (
                  <span
                    className="m-auto font-bold"
                    style={{ fontSize: '10px' }}
                  >
                    {pct}%
                  </span>
                )}
              </Wrapper>
            );
          })}
        </div>
      ) : (
        /* Uniform grid view — all tiles same size */
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
          {sorted.map((market) => {
            const icon = platformIcons[market.platform] ?? '⚪';
            const odds = getPrimaryOdds(market);
            const pct = odds?.pct ?? null;
            const bg = heatColor(pct);
            const fg = textColor(pct);

            const href = getMarketUrl(market);
            const Wrapper = href ? 'a' : 'div';
            const wrapperProps = href
              ? { href, target: '_blank', rel: 'noopener noreferrer' }
              : {};

            return (
              <Wrapper
                key={`${market.platform}:${market.id}`}
                {...wrapperProps}
                className="card-hover rounded-lg border border-slate-800 hover:border-slate-600 cursor-pointer block p-2.5"
                style={{ backgroundColor: bg, color: fg, minHeight: '100px' }}
              >
                <div className="flex items-start justify-between gap-1 mb-1">
                  <span className="text-[9px] font-bold uppercase opacity-80">
                    {icon} {market.platform}
                  </span>
                  <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                    <StarToggle
                      market={market}
                      isWatched={isWatched(market)}
                      onToggle={handleStarToggle}
                    />
                  </span>
                </div>
                <p
                  className="font-semibold leading-tight mb-1"
                  style={{
                    fontSize: '11px',
                    lineHeight: '1.2',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {market.question}
                </p>
                <div className="flex items-end justify-between gap-1">
                  {pct !== null && (
                    <span className="font-bold text-sm">{pct}%</span>
                  )}
                  {market.volume24h != null && (
                    <span className="opacity-70 text-[9px]">
                      ${(market.volume24h / 1000).toFixed(0)}K
                    </span>
                  )}
                </div>
              </Wrapper>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const MarketOdds = memo(MarketOddsImpl);