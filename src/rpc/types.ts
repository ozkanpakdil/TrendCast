/**
 * Shared types for the TrendCast RPC library.
 *
 * The RPC surface is defined ONCE, declaratively, in `src/rpc/definitions.ts`
 * (metadata + handler co-located per method). Two consumers read it:
 *
 *   1. The extension background worker — `registerAllRpcHandlers(ctx)` wires
 *      every definition's handler into the log-forwarder's WebSocket bridge.
 *   2. The debug reader (`src/rpc/server.ts`) — imports the same definitions
 *      to auto-build its CLI (help text, param parsing, dispatch) instead of
 *      hand-writing one `switch` case per RPC.
 *
 * Handlers never import the browser/background directly — they receive a
 * `RpcContext` (injected by the background) so the debug reader can import
 * the definitions in Node without pulling in the webextension polyfill or
 * the background worker.
 */

import type { Browser } from '@/messaging/browser';
import type {
  CollectionSnapshot,
  CorrelationEngine,
  CorrelationResult,
  ExtensionSettings,
  MarketContract,
  NewsItem,
  SocialSignal,
} from '@/types';
import type { MlRunQueue } from '@/utils/ml-run-queue';
import type { readStoredAnalysis } from '@/utils/correlation-persistence';

/** The stored correlation result shape the background's summarizer accepts. */
export type StoredCorrelation = NonNullable<Awaited<ReturnType<typeof readStoredAnalysis>>>;

/** A single RPC parameter spec — drives both CLI parsing and help text. */
export interface RpcParamSpec {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'string[]';
  description: string;
  /** When true, the param may be omitted (a default is applied). */
  optional?: boolean;
  /** Default value shown in help (not applied by the reader — the handler owns defaults). */
  default?: unknown;
  /** Allowed values (validated in help; the handler still guards). */
  choices?: string[];
}

/** A declarative RPC definition: metadata + handler, one place per method. */
export interface RpcDefinition {
  method: string;
  /** Grouping label for the auto-generated help output. */
  group: string;
  description: string;
  params?: RpcParamSpec[];
  handler: (params: Record<string, unknown>, ctx: RpcContext) => Promise<unknown> | unknown;
}

/**
 * Live dependencies the background injects into every handler.
 *
 * Keeping the browser-touching functions here (instead of importing them
 * directly in the handler modules) is what lets the debug reader import the
 * definitions in Node: the handler modules only reference `ctx`, so they pull
 * in no extension-only code at import time.
 */
export interface RpcContext {
  browser: Browser;
  buildVersion: string;
  userAgent: string;
  getSettings: () => Promise<ExtensionSettings>;
  getCollectedMarkets: () => Promise<MarketContract[]>;
  getCollectedSignals: () => Promise<SocialSignal[]>;
  getCollectedNews: () => Promise<NewsItem[]>;
  getLatestSnapshot: () => Promise<CollectionSnapshot | null>;
  runCollection: () => Promise<CollectionSnapshot>;
  runCorrelationAsync: (
    engine: CorrelationEngine,
    model: string,
    requestId: string,
  ) => Promise<void>;
  runCorrelationWithEngine: (
    markets: MarketContract[],
    signals: SocialSignal[],
    news: NewsItem[],
    engine: CorrelationEngine,
    model: string,
    requestId?: string,
  ) => Promise<CorrelationResult>;
  runCorrelationPrecompute: (
    markets: MarketContract[],
    signals: SocialSignal[],
    news: NewsItem[],
    settings: ExtensionSettings,
  ) => Promise<void>;
  mlRunQueue: MlRunQueue;
  measureStorageUsage: () => Promise<{ totalBytes: number; perKey: Record<string, number> }>;
  summarizeCorrelation: (stored: StoredCorrelation) => unknown;
}
