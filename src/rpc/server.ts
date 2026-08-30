/**
 * TrendCast debug reader — local WebSocket log server + auto-discovering RPC CLI.
 *
 * Receives forwarded `[TrendCast]` console output from the extension's
 * background worker (see src/utils/log-forwarder.ts) and prints it to
 * this terminal. Also accepts interactive commands that are forwarded to
 * the extension over the same socket as RPC requests.
 *
 * Unlike the old hand-written `switch(cmd)` server, this reader auto-discovers
 * the RPC surface: it scans `./handlers` at runtime, dynamic-imports every
 * handler module (which triggers their `@rpc` decorators), and auto-builds
 * its CLI from the registry:
 *
 *   - `help` lists every RPC grouped by its `group` field, with each
 *     method's description and params.
 *   - Typing a method name dispatches to that RPC, parsing `key=value`
 *     tokens against the definition's `RpcParamSpec[]` (and accepting
 *     positional args for the first non-optional params).
 *   - Adding a new RPC = adding one decorated method in a handler file.
 *     The reader picks it up automatically — no server-side switch to
 *     maintain, and no barrel to update.
 *
 * Run it BEFORE triggering a collection/correlation in the extension:
 *   bun run src/rpc/server.ts
 *
 * The extension connects to ws://localhost:18080. If the server isn't
 * running, the extension just buffers (up to 500 lines) and flushes on
 * connect, so you can start the server at any time.
 *
 * ⚠️ The extension only connects when the "Stream logs to local server"
 * setting is enabled (Settings → Debug). The forwarder is debug-build-only
 * and is stripped from production bundles regardless of the setting.
 */

import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { createInterface } from 'node:readline';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRpcDefinitions, getRpcDefinition } from './registry';
import type { RpcDefinition, RpcParamSpec } from './types';

const PORT = 18080;
const RPC_TIMEOUT_MS = 120_000; // collection can take a while (staggered feeds)

const COLORS = {
  log: '\x1b[37m', // white
  info: '\x1b[36m', // cyan
  warn: '\x1b[33m', // yellow
  error: '\x1b[31m', // red
  rpc: '\x1b[35m', // magenta
  ok: '\x1b[32m', // green
  dim: '\x1b[2m',
  reset: '\x1b[0m',
} as const;

const server = createServer();
const wss = new WebSocketServer({ server });

/** The single connected extension socket (latest wins). */
let ext: WebSocket | null = null;
let rpcSeq = 0;
/** Pending RPC calls awaiting a reply, by id. */
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

function print(tag: string, color: string, text: string): void {
  process.stdout.write(`${color}[${tag}] ${text}${COLORS.reset}\n`);
}

wss.on('connection', (socket) => {
  ext = socket;
  print('log-server', COLORS.ok, 'Extension connected — streaming logs… (type "help" for commands)');

  socket.on('message', (raw) => {
    let msg: { type?: string; ts?: string; data?: string; id?: string; method?: string; result?: unknown; error?: string };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      print('log-server', COLORS.log, raw.toString());
      return;
    }

    if (msg.type === 'rpc-result' || msg.type === 'rpc-error') {
      const p = msg.id ? pending.get(msg.id) : undefined;
      if (p) {
        clearTimeout(p.timer);
        pending.delete(msg.id!);
      }
      if (msg.type === 'rpc-error') {
        print('rpc', COLORS.error, `RPC ${msg.method} FAILED: ${msg.error}`);
        p?.reject(new Error(msg.error ?? 'RPC error'));
      } else {
        print('rpc', COLORS.rpc, `RPC ${msg.method} → ${JSON.stringify(msg.result)}`);
        p?.resolve(msg.result);
      }
      // Re-prompt after async output so the CLI prompt stays readable.
      rl.prompt(true);
      return;
    }

    const level = (msg.type ?? 'log') as keyof typeof COLORS;
    const color = COLORS[level] ?? COLORS.log;
    const ts = msg.ts ? new Date(msg.ts).toLocaleTimeString() : '';
    process.stdout.write(`${color}[${ts}] ${msg.data ?? ''}${COLORS.reset}\n`);
  });

  socket.on('close', () => {
    if (ext === socket) ext = null;
    print('log-server', COLORS.warn, 'Extension disconnected.');
  });
});

/** Send an RPC request to the extension and await its reply. */
function callRpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  if (!ext || ext.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('Extension not connected. Open the popup/dashboard or trigger any extension event to wake the worker.'));
  }
  const id = `rpc-${++rpcSeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`RPC ${method} timed out after ${RPC_TIMEOUT_MS / 1000}s`));
    }, RPC_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    ext!.send(JSON.stringify({ type: 'rpc', id, method, params }));
    print('rpc', COLORS.dim, `→ ${method} ${Object.keys(params).length ? JSON.stringify(params) : ''}`);
  });
}

// ── Auto-discovery: load every handler module so its @rpc decorators run ──
// The server runs standalone under Bun (no Vite), so it cannot use
// import.meta.glob. Instead it scans ./handlers at runtime and
// dynamic-imports each file — the closest analogue to a Java classpath
// scan. Adding a new handler file needs no registration here.
async function discoverHandlers(): Promise<void> {
  const dir = join(fileURLToPath(new URL('.', import.meta.url)), 'handlers');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
  for (const file of files) {
    await import(join(dir, file));
  }
}

// ── Auto-generated help from the RPC definitions ─────────────────
function formatParam(p: RpcParamSpec): string {
  const parts = [`${p.name}:${p.type}`];
  if (p.optional) parts.push('optional');
  if (p.default !== undefined) parts.push(`default=${JSON.stringify(p.default)}`);
  if (p.choices && p.choices.length > 0) parts.push(`(${p.choices.join('|')})`);
  return `${parts.join(' ')} — ${p.description}`;
}

function buildHelp(): string {
  const groups = new Map<string, RpcDefinition[]>();
  for (const def of getRpcDefinitions()) {
    const list = groups.get(def.group) ?? [];
    list.push(def);
    groups.set(def.group, list);
  }

  const lines: string[] = ['Commands (auto-discovered from the RPC library):', ''];
  for (const [group, defs] of groups) {
    lines.push(`── ${group} ──`);
    for (const def of defs) {
      const params = def.params && def.params.length > 0
        ? ` ${def.params.map((p) => (p.optional ? `[${p.name}=…]` : `<${p.name}>`)).join(' ')}`
        : '';
      lines.push(`  ${def.method}${params}`);
      lines.push(`      ${def.description}`);
      if (def.params && def.params.length > 0) {
        for (const p of def.params) lines.push(`        ${formatParam(p)}`);
      }
    }
    lines.push('');
  }
  lines.push('  help                    this message');
  lines.push('  quit                    exit the server');
  return lines.join('\n');
}

let HELP = '';

async function main(): Promise<void> {
  await discoverHandlers();
  HELP = buildHelp();

  const rl = createInterface({ input: process.stdin, terminal: true });
  rl.setPrompt(`${COLORS.ok}trendcast${COLORS.reset}> `);
  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }
    const [cmd, ...rest] = input.split(/\s+/);

    try {
      if (cmd === 'help') {
        console.log(HELP);
      } else if (cmd === 'quit' || cmd === 'exit') {
        process.exit(0);
      } else {
        const def = getRpcDefinition(cmd);
        if (!def) {
          print('log-server', COLORS.warn, `Unknown command: ${cmd} (try "help")`);
        } else {
          const params = parseParams(def, rest);
          const result = await callRpc(def.method, params);
          print('rpc', COLORS.rpc, JSON.stringify(result, null, 2));
        }
      }
    } catch (err) {
      print('rpc', COLORS.error, err instanceof Error ? err.message : String(err));
    }
    rl.prompt(true);
  });

  rl.on('close', () => process.exit(0));

  server.listen(PORT, () => {
    print('log-server', COLORS.ok, `Listening on ws://localhost:${PORT}`);
    print('log-server', COLORS.ok, 'Waiting for the TrendCast extension to connect…');
    console.log('');
    rl.prompt(true);
  });
}

main().catch((err) => {
  console.error('Failed to start debug reader:', err);
  process.exit(1);
});

// ── Param parsing from the definition's spec ────────────────────
function coerceValue(type: RpcParamSpec['type'], raw: string): unknown {
  switch (type) {
    case 'number': {
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    }
    case 'boolean':
      return raw === 'true' || raw === '1';
    case 'string[]':
      return raw.split(/[\s,]+/).filter(Boolean);
    default:
      return raw;
  }
}

/**
 * Parse a command line into RPC params.
 *
 * Accepts `key=value` tokens (coerced per the spec type) plus positional
 * args that fill the first non-optional params in order. Unknown keys are
 * passed through as strings so the handler can still guard them.
 */
function parseParams(def: RpcDefinition, tokens: string[]): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const positional: string[] = [];
  for (const token of tokens) {
    const eq = token.indexOf('=');
    if (eq > 0) {
      const key = token.slice(0, eq);
      const value = token.slice(eq + 1);
      const spec = def.params?.find((p) => p.name === key);
      params[key] = spec ? coerceValue(spec.type, value) : value;
    } else {
      positional.push(token);
    }
  }
  // Fill the first non-optional params with positional args.
  if (positional.length > 0 && def.params) {
    let pi = 0;
    for (const spec of def.params) {
      if (spec.optional) continue;
      if (pi >= positional.length) break;
      params[spec.name] = coerceValue(spec.type, positional[pi]);
      pi++;
    }
  }
  return params;
}

const rl = createInterface({ input: process.stdin, terminal: true });
rl.setPrompt(`${COLORS.ok}trendcast${COLORS.reset}> `);
rl.prompt();

rl.on('line', async (line) => {
  const input = line.trim();
  if (!input) {
    rl.prompt();
    return;
  }
  const [cmd, ...rest] = input.split(/\s+/);

  try {
    if (cmd === 'help') {
      console.log(HELP);
    } else if (cmd === 'quit' || cmd === 'exit') {
      process.exit(0);
    } else {
      const def = getRpcDefinition(cmd);
      if (!def) {
        print('log-server', COLORS.warn, `Unknown command: ${cmd} (try "help")`);
      } else {
        const params = parseParams(def, rest);
        const result = await callRpc(def.method, params);
        print('rpc', COLORS.rpc, JSON.stringify(result, null, 2));
      }
    }
  } catch (err) {
    print('rpc', COLORS.error, err instanceof Error ? err.message : String(err));
  }
  rl.prompt(true);
});

rl.on('close', () => process.exit(0));

server.listen(PORT, () => {
  print('log-server', COLORS.ok, `Listening on ws://localhost:${PORT}`);
  print('log-server', COLORS.ok, 'Waiting for the TrendCast extension to connect…');
  console.log('');
  rl.prompt(true);
});
