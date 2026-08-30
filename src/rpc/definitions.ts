/**
 * RPC definitions barrel — Node-safe, for the extension background worker.
 *
 * The debug reader (src/rpc/server.ts) auto-discovers handlers by scanning
 * ./handlers at runtime, so it does NOT use this barrel. The background
 * worker is bundled by Vite and cannot fs-scan, so it imports this barrel,
 * which side-effect-imports every handler module to trigger their `@rpc`
 * decorators. Adding a new handler file requires adding one import here.
 *
 * This module is Node-safe (no browser/extension imports) so it can be
 * imported by both the bundled worker and (if ever needed) the server.
 */

import './handlers/core';
import './handlers/benchmark';
import './handlers/correlations';
import './handlers/screen';

export { getRpcDefinitions, getRpcDefinition } from './registry';
export type { RpcContext, RpcDefinition, RpcParamSpec } from './types';
