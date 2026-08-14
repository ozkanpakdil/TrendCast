/**
 * HypeFeed — displays trending social signals sorted by virality.
 * Shows platform, text, engagement metrics, sentiment, and virality score.
 */

import type { SocialSignal } from '@/types';

interface HypeFeedProps {
  signals: SocialSignal[];
  highlightThreshold: number;
}

const platformIcons: Record<string, string> = {
  x: '𝕏',
  reddit: '👽',
  tiktok: '🎵',
};

const platformColors: Record<string, string> = {
  x: 'bg-slate-700 text-slate-200',
  reddit: 'bg-orange-900/50 text-orange-300',
  tiktok: 'bg-pink-900/50 text-pink-300',
};

export function HypeFeed({ signals, highlightThreshold }: HypeFeedProps) {
  const sorted = [...signals].sort((a, b) => b.virality - a.virality);
  const top = sorted.slice(0, 50);

  return (
    <div className="space-y-2">
      {top.length === 0 && (
        <p className="text-slate-500 text-sm text-center py-8">
          No social signals collected yet. Visit X, Reddit, or TikTok to collect data,
          or wait for the next hourly collection.
        </p>
      )}
      {top.map((signal) => {
        const isHot = signal.virality >= highlightThreshold;
        return (
          <div
            key={signal.id}
            className={`card-hover rounded-lg p-3 border ${
              isHot
                ? 'bg-slate-800/80 border-brand-500/40 shadow-lg shadow-brand-500/10'
                : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className="flex items-start gap-3">
              <span
                className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${platformColors[signal.platform] ?? 'bg-slate-700'}`}
              >
                {platformIcons[signal.platform] ?? '?'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-200 line-clamp-2">{signal.text}</p>
                <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                  <span>{signal.author}</span>
                  <span>❤️ {signal.metrics.likes}</span>
                  <span>💬 {signal.metrics.comments}</span>
                  {signal.metrics.views != null && <span>👁️ {signal.metrics.views}</span>}
                  <span
                    className={
                      signal.sentiment > 0.2
                        ? 'text-bull'
                        : signal.sentiment < -0.2
                          ? 'text-bear'
                          : 'text-neutral'
                    }
                  >
                    {signal.sentiment > 0.2 ? '📈' : signal.sentiment < -0.2 ? '📉' : '➖'}{' '}
                    {Math.round(signal.sentiment * 100)}%
                  </span>
                </div>
              </div>
              <div className="flex-shrink-0 text-right">
                <div
                  className={`text-lg font-bold ${
                    isHot ? 'text-brand-400' : 'text-slate-400'
                  }`}
                >
                  {Math.round(signal.virality)}
                </div>
                <div className="text-[10px] text-slate-600">virality</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}