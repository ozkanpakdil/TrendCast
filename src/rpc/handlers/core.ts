/**
 * Core RPC handlers — version, collection, correlation, settings, storage.
 *
 * These are the "everyday" debug commands. Each method is decorated with
 * `@rpc` (standard ES decorators) so it self-registers into the RPC
 * registry — the debug reader auto-discovers it, no manual wiring needed.
 */

import { rpc } from '../registry';
import type { RpcContext } from '../types';

export class CoreRpc {
  @rpc('getVersion', {
    group: 'core',
    description: 'extension build version + user agent',
  })
  getVersion(_params: Record<string, unknown>, ctx: RpcContext) {
    return {
      version: ctx.buildVersion,
      userAgent: ctx.userAgent,
      timestamp: new Date().toISOString(),
    };
  }

  @rpc('collectNow', {
    group: 'core',
    description: 'trigger a full collection cycle (waits for completion)',
  })
  async collectNow(_params: Record<string, unknown>, ctx: RpcContext) {
    console.log('[TrendCast] RPC: collectNow');
    const snapshot = await ctx.runCollection();
    return {
      collectedAt: snapshot.collectedAt,
      markets: snapshot.markets.length,
      signals: snapshot.signals.length,
      news: snapshot.news.length,
    };
  }

  @rpc('correlate', {
    group: 'core',
    description: 'run correlation (heuristic|embedding|sentiment|ner|llm)',
    params: [
      { name: 'engine', type: 'string', description: 'correlation engine', optional: true, choices: ['heuristic', 'embedding', 'sentiment', 'ner', 'llm'] },
      { name: 'model', type: 'string', description: 'model override (engine=model pairs also accepted)', optional: true },
    ],
  })
  async correlate(params: Record<string, unknown>, ctx: RpcContext) {
    const settings = await ctx.getSettings();
    const engine = (params.engine as typeof settings.correlationEngine) ?? settings.correlationEngine;
    const model = (params.model as string) ?? settings.embeddingModel;
    const requestId = `rpc-corr-${Date.now()}`;
    console.log(`[TrendCast] RPC: correlate engine="${engine}" model="${model}"`);
    // Fire-and-forget like the dashboard path — result lands in storage and
    // streams back through the log channel (CORRELATE_ALL OK line).
    void ctx.runCorrelationAsync(engine, model, requestId);
    return { started: true, requestId, engine, model };
  }

  @rpc('getSnapshot', {
    group: 'core',
    description: 'latest collection snapshot summary',
  })
  async getSnapshot(_params: Record<string, unknown>, ctx: RpcContext) {
    const snapshot = await ctx.getLatestSnapshot();
    if (!snapshot) return { empty: true };
    return {
      collectedAt: snapshot.collectedAt,
      markets: snapshot.markets.length,
      signals: snapshot.signals.length,
      news: snapshot.news.length,
    };
  }

  @rpc('getSettings', {
    group: 'core',
    description: 'current extension settings (JSON)',
  })
  async getSettings(_params: Record<string, unknown>, ctx: RpcContext) {
    return ctx.getSettings();
  }

  @rpc('getStorageUsage', {
    group: 'core',
    description: 'chrome.storage.local usage breakdown',
  })
  async getStorageUsage(_params: Record<string, unknown>, ctx: RpcContext) {
    return ctx.measureStorageUsage();
  }

  @rpc('ping', {
    group: 'core',
    description: 'liveness check',
  })
  ping(_params: Record<string, unknown>, _ctx: RpcContext) {
    return 'pong';
  }
}
