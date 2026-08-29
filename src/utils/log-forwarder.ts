/**
 * Debug log forwarder — streams console output to a local WebSocket server.
 *
 * ⚠️ DEBUG-ONLY. This is gated behind `import.meta.env.DEBUG_LOG_FORWARD`,
 * which Vite sets to `true` only for `--mode development` builds
 * (`bun run build:debug:firefox`). Production builds strip this entirely.
 *
 * Why this exists: the `[TrendCast]` collection/correlation logs come from
 * the background service worker, which is a SEPARATE JS context from any
 * page. Pasting a `console.log` override into the dashboard/popup DevTools
 * console does NOT capture worker logs. This module patches `console.*`
 * inside the worker itself and forwards every call to a local server.
 *
 * Usage:
 *   import '@/utils/log-forwarder';   // side-effect: patches console
 *
 * RPC: the connection is bidirectional. The server can send
 *   { type: "rpc", id: "...", method: "collectNow", params: {} }
 * and this module dispatches to handlers registered via
 * `registerRpcHandler(method, fn)` (see src/background/index.ts), replying
 * with { type: "rpc-result", id, method, result } or
 * { type: "rpc-error", id, method, error }.
 *
 * Server (run in a terminal):
 *   bun run scripts/log-server.ts
 *   # listens on ws://localhost:18080, prints logs, accepts commands
 */

const WS_URL = 'ws://localhost:18080';

// Only enable in debug builds. `import.meta.env.DEBUG_LOG_FORWARD` is
// replaced at build time by Vite's `define` (see vite.config.ts).
const ENABLED = import.meta.env.DEBUG_LOG_FORWARD === true;

/** An RPC handler: receives params, returns the result (or throws). */
export type RpcHandler = (params: Record<string, unknown>) => Promise<unknown> | unknown;

const rpcHandlers = new Map<string, RpcHandler>();

/**
 * Register a handler for an RPC method. Called from the background worker
 * at startup. No-op in production builds (the whole module is stripped).
 */
export function registerRpcHandler(method: string, handler: RpcHandler): void {
  if (!ENABLED) return;
  rpcHandlers.set(method, handler);
}

let ws: WebSocket | null = null;
let queue: string[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function connect(): void {
  if (!ENABLED) return;
  try {
    ws = new WebSocket(WS_URL);
  } catch {
    // WebSocket constructor can throw in some sandboxed contexts.
    return;
  }

  ws.addEventListener('open', () => {
    // Flush anything logged before the socket connected.
    if (queue.length > 0) {
      for (const line of queue) ws?.send(line);
      queue = [];
    }
  });

  ws.addEventListener('message', (event: MessageEvent) => {
    // Incoming frames are RPC requests from the server. Logs flow out;
    // commands flow in.
    void handleIncoming(event.data);
  });

  ws.addEventListener('close', () => {
    ws = null;
    // Retry periodically so the forwarder survives server restarts.
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 3000);
  });

  ws.addEventListener('error', () => {
    // Non-fatal — the server may simply not be running. Close triggers retry.
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
  });
}

async function handleIncoming(data: unknown): Promise<void> {
  if (typeof data !== 'string') return;
  let msg: { type?: string; id?: string; method?: string; params?: Record<string, unknown> };
  try {
    msg = JSON.parse(data);
  } catch {
    return; // Not JSON — ignore.
  }
  if (msg.type !== 'rpc' || !msg.id || !msg.method) return;
  await dispatchRpc(msg.id, msg.method, msg.params ?? {});
}

async function dispatchRpc(id: string, method: string, params: Record<string, unknown>): Promise<void> {
  const handler = rpcHandlers.get(method);
  if (!handler) {
    sendRaw(JSON.stringify({ type: 'rpc-error', id, method, error: `Unknown RPC method: ${method}` }));
    return;
  }
  try {
    const result = await handler(params);
    sendRaw(JSON.stringify({ type: 'rpc-result', id, method, result: result ?? null }));
  } catch (err) {
    sendRaw(JSON.stringify({
      type: 'rpc-error',
      id,
      method,
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

function sendRaw(text: string): void {
  if (!ENABLED) return;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(text);
  } else {
    // RPC replies are dropped if the socket is down (the caller sees a
    // timeout on the server side); log lines are buffered instead.
  }
}

function send(level: string, args: unknown[]): void {
  if (!ENABLED) return;
  const line = JSON.stringify({
    type: level,
    ts: new Date().toISOString(),
    data: args.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' '),
  });
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(line);
  } else {
    // Buffer until the socket is ready (bounded to avoid unbounded growth).
    if (queue.length < 500) queue.push(line);
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function patchConsole(): void {
  if (!ENABLED) return;

  const original = {
    log: console.log.bind(console),
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console),
  };

  console.log = (...args: unknown[]) => {
    original.log(...args);
    send('log', args);
  };
  console.error = (...args: unknown[]) => {
    original.error(...args);
    send('error', args);
  };
  console.warn = (...args: unknown[]) => {
    original.warn(...args);
    send('warn', args);
  };
  console.info = (...args: unknown[]) => {
    original.info(...args);
    send('info', args);
  };
}

// Patch immediately, then connect. The worker is ephemeral, so this runs
// on every worker start — which is exactly when we want the logs.
patchConsole();
connect();
