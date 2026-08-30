/**
 * Benchmark RPC handlers — run the correlation pipeline per engine/model
 * and score the results so the user can compare engines and drop the ones
 * that aren't useful.
 *
 * Scoring (0–100, higher = better):
 *   coverage  (40%) — how many of the 4 correlation passes produced
 *                     matches at all (a pass with 0 matches scores 0)
 *   precision (30%) — mean confidence of the top-10 matches per pass,
 *                     normalised against each pass's threshold
 *   spread    (15%) — confidence spread (std dev) of the top-10 per
 *                     pass: a good engine discriminates (some strong,
 *                     some weak matches), not everything-at-0.9
 *   speed     (15%) — log-scaled duration vs the fastest run in the set
 * Results are stored under CONFIG.storage.modelBenchmark and returned
 * by the `benchmark` / `benchmarkResults` log-server commands.
 */

import { CONFIG } from '@/config';
import { rpc } from '../registry';
import type { RpcContext } from '../types';

/** One engine/model benchmark run. */
export interface BenchmarkRun {
  engine: string;
  model: string;
  startedAt: number;
  durationMs: number;
  error?: string;
  counts: { matches: number; newsMatches: number; newsSocialMatches: number; newsNewsMatches: number };
  /** Mean confidence of the top-10 matches per pass (0 if no matches). */
  top10Mean: { matches: number; newsMatches: number; newsSocialMatches: number; newsNewsMatches: number };
  /** Std-dev of confidence across the top-10 matches per pass. */
  top10Spread: { matches: number; newsSocialMatches: number; newsMatches: number; newsNewsMatches: number };
  score?: BenchmarkScore;
}

/** Weighted quality score for a benchmark run (0–100). */
export interface BenchmarkScore {
  total: number;
  coverage: number;
  precision: number;
  spread: number;
  speed: number;
}

/** Per-pass thresholds — mirrors src/services/engine/ml/types.ts. */
const BENCH_THRESHOLDS = {
  matches: 0.45,
  newsMatches: 0.45,
  newsSocialMatches: 0.35,
  newsNewsMatches: 0.45,
} as const;

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/** Mean confidence of the top-N matches in a pass. */
function topNMean<T extends { confidence: number }>(items: T[], n = 10): number {
  return mean([...items].sort((a, b) => b.confidence - a.confidence).slice(0, n).map((m) => m.confidence));
}

/** Std-dev of confidence across the top-N matches in a pass. */
function topNSpread<T extends { confidence: number }>(items: T[], n = 10): number {
  return stdev([...items].sort((a, b) => b.confidence - a.confidence).slice(0, n).map((m) => m.confidence));
}

/** Score one run. `fastestMs` is the fastest duration in the benchmark set. */
function scoreRun(run: BenchmarkRun, fastestMs: number): BenchmarkScore {
  const passes = ['matches', 'newsMatches', 'newsSocialMatches', 'newsNewsMatches'] as const;

  // Coverage: fraction of passes that found anything (40%)
  const passesWithMatches = passes.filter((p) => run.counts[p] > 0).length;
  const coverage = (passesWithMatches / passes.length) * 100;

  // Precision: mean top-10 confidence normalised against the pass
  // threshold, capped at 1 (30%). Only passes with matches contribute.
  const precisions = passes
    .filter((p) => run.counts[p] > 0)
    .map((p) => Math.min(1, run.top10Mean[p] / BENCH_THRESHOLDS[p]));
  const precision = mean(precisions) * 100;

  // Spread: normalised std-dev of top-10 confidences (15%). A good
  // engine discriminates — spread of 0 means everything scored the same.
  const spreads = passes
    .filter((p) => run.counts[p] > 1)
    .map((p) => Math.min(1, run.top10Spread[p] / 0.2)); // 0.2 spread = fully discriminating
  const spread = mean(spreads) * 100;

  // Speed: log-scaled vs the fastest run (15%). 2× slower ≈ 70 pts,
  // 10× slower ≈ 30 pts, 100× slower ≈ 0 pts.
  const ratio = run.durationMs / Math.max(1, fastestMs);
  const speed = Math.max(0, Math.min(100, 100 - 33.3 * Math.log10(Math.max(1, ratio))));

  const total = coverage * 0.4 + precision * 0.3 + spread * 0.15 + speed * 0.15;
  return {
    total: Math.round(total * 10) / 10,
    coverage: Math.round(coverage * 10) / 10,
    precision: Math.round(precision * 10) / 10,
    spread: Math.round(spread * 10) / 10,
    speed: Math.round(speed * 10) / 10,
  };
}

export class BenchmarkRpc {
  @rpc('benchmark', {
    group: 'benchmark',
    description: 'run correlation per engine and score them',
    params: [
      { name: 'engines', type: 'string[]', description: 'engines to benchmark (default: heuristic embedding sentiment ner)', optional: true, choices: ['heuristic', 'embedding', 'sentiment', 'ner', 'llm'] },
      { name: 'embeddingModel', type: 'string', description: 'embedding model override', optional: true },
      { name: 'sentimentModel', type: 'string', description: 'sentiment model override', optional: true },
      { name: 'nerModel', type: 'string', description: 'NER model override', optional: true },
      { name: 'llmModel', type: 'string', description: 'LLM model override', optional: true },
    ],
  })
  async benchmark(params: Record<string, unknown>, ctx: RpcContext) {
    const engines = (params.engines as string[] | undefined) ?? ['heuristic', 'embedding', 'sentiment', 'ner'];
    const modelsByEngine: Record<string, string> = {
      heuristic: '',
      embedding: (params.embeddingModel as string) ?? 'Xenova/all-MiniLM-L6-v2',
      sentiment: (params.sentimentModel as string) ?? 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
      ner: (params.nerModel as string) ?? 'Xenova/bert-base-NER-uncased',
      llm: (params.llmModel as string) ?? 'HuggingFaceTB/SmolLM2-135M-Instruct',
    };

    const markets = await ctx.getCollectedMarkets();
    const signals = await ctx.getCollectedSignals();
    const news = await ctx.getCollectedNews();
    const inputs = { markets: markets.length, signals: signals.length, news: news.length };
    console.log(`[TrendCast] RPC: benchmark engines=[${engines.join(', ')}] inputs:`, inputs);

    if (markets.length === 0 || (signals.length === 0 && news.length === 0)) {
      return { error: 'No collected data — run collectNow first.', inputs };
    }

    const runs: BenchmarkRun[] = [];
    for (const engine of engines) {
      const model = modelsByEngine[engine] ?? '';
      const startedAt = Date.now();
      try {
        const result = await ctx.runCorrelationWithEngine(
          markets, signals, news,
          engine as 'heuristic' | 'embedding' | 'sentiment' | 'ner' | 'llm',
          model,
          `bench-${engine}-${startedAt}`,
        );
        const durationMs = Date.now() - startedAt;
        const run: BenchmarkRun = {
          engine,
          model,
          startedAt,
          durationMs,
          counts: {
            matches: result.matches.length,
            newsMatches: result.newsMatches.length,
            newsSocialMatches: result.newsSocialMatches.length,
            newsNewsMatches: result.newsNewsMatches.length,
          },
          top10Mean: {
            matches: topNMean(result.matches),
            newsMatches: topNMean(result.newsMatches),
            newsSocialMatches: topNMean(result.newsSocialMatches),
            newsNewsMatches: topNMean(result.newsNewsMatches),
          },
          top10Spread: {
            matches: topNSpread(result.matches),
            newsMatches: topNSpread(result.newsMatches),
            newsSocialMatches: topNSpread(result.newsSocialMatches),
            newsNewsMatches: topNSpread(result.newsNewsMatches),
          },
          error: result.error,
        };
        runs.push(run);
        console.log(
          `[TrendCast] benchmark ${engine} done in ${(durationMs / 1000).toFixed(1)}s:`,
          `signal→market=${run.counts.matches}, news→market=${run.counts.newsMatches},`,
          `news→social=${run.counts.newsSocialMatches}, news↔news=${run.counts.newsNewsMatches}`,
        );
      } catch (err) {
        runs.push({
          engine,
          model,
          startedAt,
          durationMs: Date.now() - startedAt,
          error: err instanceof Error ? err.message : String(err),
          counts: { matches: 0, newsMatches: 0, newsSocialMatches: 0, newsNewsMatches: 0 },
          top10Mean: { matches: 0, newsMatches: 0, newsSocialMatches: 0, newsNewsMatches: 0 },
          top10Spread: { matches: 0, newsMatches: 0, newsSocialMatches: 0, newsNewsMatches: 0 },
        });
        console.error(`[TrendCast] benchmark ${engine} FAILED:`, err);
      }
    }

    // Score all runs relative to the fastest successful one.
    const successful = runs.filter((r) => !r.error);
    const fastestMs = successful.length > 0 ? Math.min(...successful.map((r) => r.durationMs)) : 1;
    for (const run of runs) {
      if (!run.error) run.score = scoreRun(run, fastestMs);
    }

    const report = {
      benchmarkedAt: Date.now(),
      inputs,
      runs,
    };
    await ctx.browser.storage.local.set({ [CONFIG.storage.modelBenchmark]: report });
    console.log('[TrendCast] benchmark complete:', JSON.stringify(report, null, 2));
    return report;
  }

  @rpc('benchmarkResults', {
    group: 'benchmark',
    description: 'print the last stored benchmark report as a table',
  })
  async benchmarkResults(_params: Record<string, unknown>, ctx: RpcContext) {
    const stored = await ctx.browser.storage.local.get(CONFIG.storage.modelBenchmark);
    return stored[CONFIG.storage.modelBenchmark] ?? { empty: true };
  }
}
