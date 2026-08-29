/**
 * Debug log forwarder — streams console output to a local WebSocket server.
 *
 * ⚠️ DEBUG-ONLY. This is gated behind `import.meta.env.DEBUG_LOG_FORWARD`,
 * which Vite sets to `true` only for `--mode development` builds
 * (`bun run build:debug:firefox`). Production builds strip this entirely.
 *
 * The forwarder is additionally gated at runtime by the user's
 * `logServerEnabled` setting (Settings → Debug → "Stream logs to local
 * server"). It only connects and patches `console.*` when that setting is
 * on, and reacts to changes so toggling it takes effect immediately.
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

import { CONFIG } from '@/config';
import { browser } from '@/messaging/browser';

const WS_URL = 'ws://localhost:18080';

// Only include this module in debug builds. `import.meta.env.DEBUG_LOG_FORWARD`
// is replaced at build time by Vite's `define` (see vite.config.ts) — it is
// `true` only for `--mode development` builds, so production bundles strip
// this entire module.
const DEBUG_BUILD = import.meta.env.DEBUG_LOG_FORWARD === true;

/** An RPC handler: receives params, returns the result (or throws). */
export type RpcHandler = (params: Record<string, unknown>) => Promise<unknown> | unknown;

const rpcHandlers = new Map<string, RpcHandler>();

/**
 * Register a handler for an RPC method. Called from the background worker
 * at startup. No-op in production builds (the whole module is stripped).
 */
export function registerRpcHandler(method: string, handler: RpcHandler): void {
  if (!DEBUG_BUILD) return;
  rpcHandlers.set(method, handler);
}

let ws: WebSocket | null = null;
let queue: string[] = [];
let consolePatched = false;
let enabled = false;
/** Set once a connection attempt has failed, so we only warn the user once. */
let connectFailed = false;

/**
 * Enable or disable the forwarder at runtime.
 *
 * The forwarder is only active when BOTH the build is a debug build AND the
 * user has turned on `logServerEnabled` in settings. When disabled, the
 * console patch is removed (if it was applied) and the socket is closed.
 */
function setEnabled(next: boolean): void {
  if (next === enabled) return;
  enabled = next;

  if (enabled) {
    connectFailed = false;
    patchConsole();
    connect();
  } else {
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      ws = null;
    }
    queue = [];
    if (consolePatched) {
      restoreConsole();
    }
  }
}

function connect(): void {
  if (!enabled) return;
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
    // Deliberately do NOT auto-reconnect here. A tight reconnect loop spams
    // the dev console with "can't establish a connection to the server"
    // errors when the log server isn't running. Instead we connect once and
    // reconnect only when the setting is toggled off→on or the worker restarts.
  });

  ws.addEventListener('error', () => {
    // Non-fatal — the server may simply not be running. Print a single notice
    // (once) instead of spamming the console on every retry.
    if (!connectFailed) {
      connectFailed = true;
      console.warn(
        `[TrendCast] Log server not reachable at ${WS_URL} — start it with \`bun run log-server\`, then toggle the setting off/on.`,
      );
    }
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
  if (!enabled) return;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(text);
  } else {
    // RPC replies are dropped if the socket is down (the caller sees a
    // timeout on the server side); log lines are buffered instead.
  }
}

function send(level: string, args: unknown[]): void {
  if (!enabled) return;
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

let originalConsole: {
  log: typeof console.log;
  error: typeof console.error;
  warn: typeof console.warn;
  info: typeof console.info;
} | null = null;

function patchConsole(): void {
  if (consolePatched) return;
  consolePatched = true;

  originalConsole = {
    log: console.log.bind(console),
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console),
  };

  console.log = (...args: unknown[]) => {
    originalConsole!.log(...args);
    send('log', args);
  };
  console.error = (...args: unknown[]) => {
    originalConsole!.error(...args);
    send('error', args);
  };
  console.warn = (...args: unknown[]) => {
    originalConsole!.warn(...args);
    send('warn', args);
  };
  console.info = (...args: unknown[]) => {
    originalConsole!.info(...args);
    send('info', args);
  };
}

function restoreConsole(): void {
  if (!consolePatched || !originalConsole) return;
  consolePatched = false;
  console.log = originalConsole.log;
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
  console.info = originalConsole.info;
  originalConsole = null;
}

// ── Runtime enable/disable from settings ─────────────────────────
// The forwarder only streams when the user has enabled it in settings
// (`logServerEnabled`). We read the current value on worker start and
// react to changes so toggling the setting takes effect immediately.
// In production builds this whole block is stripped (DEBUG_BUILD is false).

function readLogServerEnabled(): boolean {
  try {
    // Synchronous read is not possible; we kick off an async read below.
    void browser.storage.local.get(CONFIG.storage.settings).then((result) => {
      const stored = result[CONFIG.storage.settings] as { logServerEnabled?: boolean } | undefined;
      setEnabled(Boolean(stored?.logServerEnabled));
    });
  } catch {
    /* ignore */
  }
  return false;
}

function watchSettings(): void {
  if (!DEBUG_BUILD) return;
  readLogServerEnabled();
  try {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const change = changes[CONFIG.storage.settings];
      if (!change) return;
      const stored = change.newValue as { logServerEnabled?: boolean } | undefined;
      setEnabled(Boolean(stored?.logServerEnabled));
    });
  } catch {
    /* ignore */
  }
}

// Patch immediately, then connect. The worker is ephemeral, so this runs
// on every worker start — which is exactly when we want the logs.
watchSettings();
