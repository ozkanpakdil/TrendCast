/**
 * CorrelationStatsBar — compact stats summary for the last correlation run.
 *
 * Shows match counts, average confidence, confidence spread, and elapsed time
 * so the user can compare models at a glance.
 */

import { memo } from 'react';
import type { CorrelationRunStats } from '@/types';

interface CorrelationStatsBarProps {
  stats: CorrelationRunStats | null;
  isDark: boolean;
}

function CorrelationStatsBarImpl({ stats, isDark }: CorrelationStatsBarProps) {
  if (!stats) return null;

  const totalMatches =
    stats.matchCount + stats.newsMatchCount + stats.newsSocialMatchCount + (stats.newsNewsMatchCount ?? 0);
  const cardClass = isDark
    ? 'bg-slate-900/80 border-slate-700 text-slate-300'
    : 'bg-slate-50 border-light-border text-light-text';

  const labelClass = isDark ? 'text-slate-500' : 'text-light-muted';

  const stats_ = [
    { label: 'Matches', value: totalMatches.toString(), icon: '🔗' },
    { label: 'Avg Conf', value: `${(stats.avgConfidence * 100).toFixed(0)}%`, icon: '📊' },
    { label: 'Max Conf', value: `${(stats.maxConfidence * 100).toFixed(0)}%`, icon: '📈' },
    { label: 'Spread', value: `±${(stats.confidenceSpread * 100).toFixed(0)}%`, icon: '📉' },
    { label: 'Time', value: `${(stats.elapsedMs / 1000).toFixed(1)}s`, icon: '⏱' },
  ];

  return (
    <div className={`mb-3 p-3 rounded-lg border text-xs ${cardClass}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="font-semibold">
          {stats.engine === 'heuristic' ? '🧮 Heuristic' :
           stats.engine === 'embedding' ? '🧠 Embedding' :
           stats.engine === 'sentiment' ? '📊 Sentiment' :
           stats.engine === 'ner' ? '🏷️ NER' :
           stats.engine === 'llm' ? '🤖 LLM' : stats.engine}
        </span>
        {stats.model && (
          <span className={`text-[10px] ${labelClass}`}>
            · {stats.model.split('/').pop()}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        {stats_.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span className="text-[10px]">{s.icon}</span>
            <span className={`text-[10px] ${labelClass}`}>{s.label}</span>
            <span className="font-semibold tabular-nums">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const CorrelationStatsBar = memo(CorrelationStatsBarImpl);