/**
 * Correlation persistence + trigger RPC handlers (Phase 16).
 *
 * Inspect and manipulate the persisted correlation state so the debug
 * reader can exercise the persistence + trigger paths (TRIG-01..04)
 * without touching the dashboard UI.
 */

import { CONFIG } from '@/config';
import type { CorrelationResult } from '@/types';
import { readStoredAnalysis, shouldTriggerReanalysis } from '@/utils/correlation-persistence';
import { readMlRunState } from '@/utils/ml-run-state';
import { rpc } from '../registry';
import type { RpcContext } from '../types';

export class CorrelationRpc {
  @rpc('getCorrelations', {
    group: 'correlations',
    description: 'stored correlation result (engine/model/computedAt/counts)',
  })
  async getCorrelations(_params: Record<string, unknown>, ctx: RpcContext) {
    const stored = await readStoredAnalysis(ctx.browser.storage.local, CONFIG.storage.correlations);
    if (!stored) return { empty: true };
    return ctx.summarizeCorrelation(stored);
  }

  // Seed a synthetic stored result to exercise the dashboard gate/badge and
  // the re-analysis trigger without running a real engine. Params:
  //   engine   — stamped engine (default 'heuristic')
  //   model    — stamped model id (default none)
  //   staleMs  — backdate computedAt by this many ms (default 0 = now)
  //   error    — when set, seeds an ERROR result (tests the write policy +
  //              the "error never suppresses re-analysis" rule)
  //   requestId — override the marker id (default seed-<ts>)
  @rpc('seedCorrelations', {
    group: 'correlations',
    description: 'write a synthetic stored result to test gate/badge/trigger',
    params: [
      { name: 'engine', type: 'string', description: 'stamped engine', optional: true, default: 'heuristic', choices: ['heuristic', 'embedding', 'sentiment', 'ner', 'llm'] },
      { name: 'model', type: 'string', description: 'stamped model id', optional: true },
      { name: 'staleMs', type: 'number', description: 'backdate computedAt by this many ms', optional: true, default: 0 },
      { name: 'error', type: 'string', description: 'when set, seeds an ERROR result', optional: true },
      { name: 'requestId', type: 'string', description: 'override the marker id', optional: true },
    ],
  })
  async seedCorrelations(params: Record<string, unknown>, ctx: RpcContext) {
    const engine = (params.engine as CorrelationResult['engine']) ?? 'heuristic';
    const model = typeof params.model === 'string' ? params.model : undefined;
    const staleMs = typeof params.staleMs === 'number' ? params.staleMs : 0;
    const error = typeof params.error === 'string' ? params.error : undefined;
    const requestId = (params.requestId as string) ?? `seed-${Date.now()}`;
    const seeded: CorrelationResult = {
      requestId,
      matches: [],
      newsMatches: [],
      newsSocialMatches: [],
      newsNewsMatches: [],
      engine,
      ...(model !== undefined ? { model } : {}),
      ...(error !== undefined ? { error } : {}),
      computedAt: Date.now() - staleMs,
      inputCounts: { markets: 0, signals: 0, news: 0 },
    };
    // Deliberate raw write — seeding must bypass the persist write policy so
    // an error result can be planted even when a good result exists.
    await ctx.browser.storage.local.set({ [CONFIG.storage.correlations]: seeded });
    console.log('[TrendCast] RPC: seedCorrelations', { requestId, engine, model, staleMs, error });
    return { seeded: true, result: ctx.summarizeCorrelation(seeded) };
  }

  @rpc('clearCorrelations', {
    group: 'correlations',
    description: 'remove the stored correlation result',
  })
  async clearCorrelations(_params: Record<string, unknown>, ctx: RpcContext) {
    await ctx.browser.storage.local.remove(CONFIG.storage.correlations);
    console.log('[TrendCast] RPC: clearCorrelations — stored result removed');
    return { cleared: true };
  }

  @rpc('getRunState', {
    group: 'correlations',
    description: 'ML run-state marker + queue liveness (live/queued ids)',
  })
  async getRunState(_params: Record<string, unknown>, ctx: RpcContext) {
    const marker = await readMlRunState(ctx.browser.storage.local, CONFIG.storage.mlRunState);
    return {
      marker,
      live: marker !== null,
      activeRequestId: ctx.mlRunQueue.activeRequestId,
      queuedRequestIds: ctx.mlRunQueue.queuedRequestIds,
    };
  }

  @rpc('getLastCollection', {
    group: 'correlations',
    description: 'lastCollectionAt + snapshot collectedAt + input counts',
  })
  async getLastCollection(_params: Record<string, unknown>, ctx: RpcContext) {
    const result = await ctx.browser.storage.local.get([
      CONFIG.storage.lastCollectionAt,
      CONFIG.storage.latestSnapshot,
    ]);
    const lastCollectionAt = result[CONFIG.storage.lastCollectionAt] as number | undefined;
    const snapshot = result[CONFIG.storage.latestSnapshot] as { collectedAt?: number; markets?: unknown[]; signals?: unknown[]; news?: unknown[] } | undefined;
    const collectedAt = snapshot?.collectedAt;
    return {
      lastCollectionAt: typeof lastCollectionAt === 'number' ? lastCollectionAt : null,
      snapshotCollectedAt: typeof collectedAt === 'number' ? collectedAt : null,
      ageMs: typeof collectedAt === 'number' ? Date.now() - collectedAt : null,
      counts: snapshot
        ? {
            markets: snapshot.markets?.length ?? 0,
            signals: snapshot.signals?.length ?? 0,
            news: snapshot.news?.length ?? 0,
          }
        : null,
    };
  }

  // Dry-run of the Phase 16 trigger decision (TRIG-03 pre-filter + liveness)
  // — shows exactly what the dashboard's storage.onChanged listener would do
  // for the CURRENT stored state, with a human-readable reason.
  @rpc('evaluateTrigger', {
    group: 'correlations',
    description: 'dry-run of the Phase 16 re-analysis trigger decision',
  })
  async evaluateTrigger(_params: Record<string, unknown>, ctx: RpcContext) {
    const stored = await readStoredAnalysis(ctx.browser.storage.local, CONFIG.storage.correlations);
    const marker = await readMlRunState(ctx.browser.storage.local, CONFIG.storage.mlRunState);
    const liveness = { live: marker !== null, queued: ctx.mlRunQueue.queuedRequestIds.length > 0 };
    const result = await ctx.browser.storage.local.get([
      CONFIG.storage.lastCollectionAt,
      CONFIG.storage.latestSnapshot,
    ]);
    const snap = result[CONFIG.storage.latestSnapshot] as { collectedAt?: number } | undefined;
    const lastCollectionAt = result[CONFIG.storage.lastCollectionAt] as number | undefined;
    // Same precedence as the dashboard listener: snapshot.collectedAt wins,
    // lastCollectionAt is the fallback.
    const snapshotCollectedAt =
      snap && typeof snap.collectedAt === 'number'
        ? snap.collectedAt
        : typeof lastCollectionAt === 'number'
          ? lastCollectionAt
          : null;
    const shouldTrigger = shouldTriggerReanalysis({ liveness, stored, snapshotCollectedAt });
    let reason: string;
    if (liveness.live || liveness.queued) reason = 'run-live-or-queued';
    else if (snapshotCollectedAt === null) reason = 'no-collection-timestamp';
    else if (!stored) reason = 'no-stored-result';
    else if (stored.error) reason = 'stored-result-is-error';
    else if (typeof stored.computedAt !== 'number' || !Number.isFinite(stored.computedAt)) {
      reason = 'legacy-result-no-computedAt';
    } else if (stored.computedAt < snapshotCollectedAt) reason = 'stale-result';
    else reason = 'fresh';
    return {
      shouldTrigger,
      reason,
      liveness,
      snapshotCollectedAt,
      storedComputedAt: stored?.computedAt ?? null,
    };
  }

  // Exercise the exact post-collection precompute path (TRIG-01/02): loads
  // the current collected data, runs the settings engine/model, stamps +
  // persists through the write policy, broadcasts, sweeps alerts, rebuilds
  // the market-news view. Awaits completion so the CLI sees the final state.
  @rpc('triggerPrecompute', {
    group: 'correlations',
    description: 'run the post-collection precompute path now (awaits)',
  })
  async triggerPrecompute(_params: Record<string, unknown>, ctx: RpcContext) {
    const settings = await ctx.getSettings();
    const markets = await ctx.getCollectedMarkets();
    const signals = await ctx.getCollectedSignals();
    const news = await ctx.getCollectedNews();
    console.log('[TrendCast] RPC: triggerPrecompute', {
      engine: settings.correlationEngine,
      markets: markets.length,
      signals: signals.length,
      news: news.length,
    });
    if (markets.length === 0 || (signals.length === 0 && news.length === 0)) {
      return { started: false, error: 'No collected data — run collectNow first.' };
    }
    await ctx.runCorrelationPrecompute(markets, signals, news, settings);
    const stored = await readStoredAnalysis(ctx.browser.storage.local, CONFIG.storage.correlations);
    return {
      started: true,
      persisted: stored ? ctx.summarizeCorrelation(stored) : null,
    };
  }
}
