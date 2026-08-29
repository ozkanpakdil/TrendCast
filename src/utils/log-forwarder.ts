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
 * Server (run in a terminal):
 *   bun run scripts/log-server.ts
 *   # listens on ws://localhost:18080 and prints incoming log lines
 */

const WS_URL = 'ws://localhost:18080';

// Only enable in debug builds. `import.meta.env.DEBUG_LOG_FORWARD` is
// replaced at build time by Vite's `define` (see vite.config.ts).
const ENABLED = import.meta.env.DEBUG_LOG_FORWARD === true;

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
