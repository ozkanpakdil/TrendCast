/**
 * CorrelationPanel — displays correlated signal-market and news-market matches.
 * Shows which social signals and news headlines match which market contracts,
 * with confidence scores and matched keywords.
 */

import type { CorrelationMatch, NewsCorrelationMatch } from '@/types';

interface CorrelationPanelProps {
  matches: CorrelationMatch[];
  newsMatches: NewsCorrelationMatch[];
}

export function CorrelationPanel({ matches, newsMatches }: CorrelationPanelProps) {
  const topMatches = [...matches].sort((a, b) => b.confidence - a.confidence).slice(0, 20);
  const topNews = [...newsMatches].sort((a, b) => b.confidence - a.confidence).slice(0, 20);

  return (
    <div className="space-y-4">
      {/* Signal → Market correlations */}
      <div>
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
          📊 Social → Market Correlations ({matches.length})
        </h3>
        <div className="space-y-2">
          {topMatches.length === 0 && (
            <p className="text-slate-500 text-sm text-center py-4">
              No correlations found. Collect more data to see matches.
            </p>
          )}
          {topMatches.map((match, i) => (
            <div
              key={`${match.signal.id}-${match.contract.id}-${i}`}
              className="rounded-lg p-3 bg-slate-900 border border-slate-800"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-slate-500">
                  {match.signal.platform} → {match.contract.platform}
                </span>
                <span className="text-xs font-bold text-brand-400">
                  {Math.round(match.confidence * 100)}% match
                </span>
              </div>
              <p className="text-sm text-slate-200 line-clamp-1">{match.contract.question}</p>
              <p className="text-xs text-slate-400 line-clamp-1 mt-1">"{match.signal.text}"</p>
              {match.matchedKeywords.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {match.matchedKeywords.slice(0, 5).map((kw) => (
                    <span
                      key={kw}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-300"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* News → Market correlations */}
      <div>
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
          📰 News → Market Correlations ({newsMatches.length})
        </h3>
        <div className="space-y-2">
          {topNews.length === 0 && (
            <p className="text-slate-500 text-sm text-center py-4">
              No news correlations found.
            </p>
          )}
          {topNews.map((match, i) => (
            <div
              key={`${match.news.id}-${match.contract.id}-${i}`}
              className="rounded-lg p-3 bg-slate-900 border border-slate-800"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-slate-500">
                  {match.news.source} → {match.contract.platform}
                </span>
                <span className="text-xs font-bold text-brand-400">
                  {Math.round(match.confidence * 100)}% match
                </span>
              </div>
              <p className="text-sm text-slate-200 line-clamp-1">{match.contract.question}</p>
              <p className="text-xs text-slate-400 line-clamp-1 mt-1">"{match.news.headline}"</p>
              {match.matchedKeywords.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {match.matchedKeywords.slice(0, 5).map((kw) => (
                    <span
                      key={kw}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-300"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}