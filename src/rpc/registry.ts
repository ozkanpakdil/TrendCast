/**
 * RPC registry — the single source of truth for the debug RPC surface.
 *
 * Handlers are declared with the `@rpc` decorator (standard ES decorators,
 * TypeScript 5.0+). Each decorated method self-registers into this registry
 * at class-definition time, so adding a new RPC is just adding a method:
 *
 *   class MyRpc {
 *     @rpc('myMethod', { group: 'mygroup', description: '...' })
 *     myMethod(params, ctx) { ... }
 *   }
 *
 * The module must be imported for the decorator to run. Two consumers load
 * the handler modules:
 *
 *   1. The debug reader (src/rpc/server.ts) scans ./handlers at runtime and
 *      dynamic-imports every file — zero-touch auto-discovery (like Java's
 *      classpath scan).
 *   2. The extension background worker imports the static barrel
 *      (src/rpc/definitions.ts) which side-effect-imports every handler.
 *
 * This module is Node-safe (no browser/extension imports) so both the
 * standalone server and the bundled worker can use it.
 */

import type { RpcDefinition } from './types';

const registry = new Map<string, RpcDefinition>();

/**
 * Decorator that registers a class method as an RPC handler.
 *
 * Usage:
 *   @rpc('methodName', { group: 'core', description: '...', params: [...] })
 *   methodName(params, ctx) { ... }
 *
 * The method signature must match `RpcDefinition['handler']`:
 * `(params: Record<string, unknown>, ctx: RpcContext) => Promise<unknown> | unknown`.
 * Handlers must not rely on `this` — they are invoked as plain functions
 * with the injected `RpcContext`.
 */
export function rpc(method: string, meta: Omit<RpcDefinition, 'method' | 'handler'>) {
  return (value: RpcDefinition['handler'], _context: ClassMethodDecoratorContext): void => {
    registry.set(method, { method, ...meta, handler: value });
  };
}

/** Every registered RPC definition, in registration order. */
export function getRpcDefinitions(): RpcDefinition[] {
  return [...registry.values()];
}

/** Look up a definition by method name. */
export function getRpcDefinition(method: string): RpcDefinition | undefined {
  return registry.get(method);
}
