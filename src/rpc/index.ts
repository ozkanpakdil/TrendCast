/**
 * TrendCast RPC library — single source of truth for the debug RPC surface.
 *
 * Every RPC is declared ONCE as a `RpcDefinition` (method, group,
 * description, params, handler). Two consumers read the same definitions:
 *
 *   1. The extension background worker calls `registerAllRpcHandlers(ctx)`
 *      to wire every handler into the log-forwarder's WebSocket bridge.
 *   2. The debug reader (`src/rpc/server.ts`) imports `rpcDefinitions` to
 *      auto-build its CLI (help text, param parsing, dispatch) — no more
 *      hand-writing one `switch` case per RPC.
 *
 * Handlers receive an injected `RpcContext` (see types.ts) so they never
 * import the browser/background directly — which is what lets the debug
 * reader import this module in Node without pulling in the webextension
 * polyfill or the background worker.
 */

import { registerRpcHandler } from '@/utils/log-forwarder';
import type { RpcContext } from './types';
import { getRpcDefinitions } from './registry';
import './definitions'; // side-effect: trigger @rpc decorators in every handler

export { getRpcDefinitions, getRpcDefinition } from './registry';
export type { RpcContext, RpcDefinition, RpcParamSpec } from './types';

/**
 * Register every RPC handler into the log-forwarder bridge.
 *
 * Called once from the background worker at startup. `registerRpcHandler`
 * is a no-op in production builds, so this whole call is stripped too.
 */
export function registerAllRpcHandlers(ctx: RpcContext): void {
  for (const def of getRpcDefinitions()) {
    registerRpcHandler(def.method, (params) => def.handler(params, ctx));
  }
}
