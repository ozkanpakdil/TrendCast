/**
 * Local WebSocket log server for TrendCast debug builds.
 *
 * Receives forwarded `[TrendCast]` console output from the extension's
 * background worker (see src/utils/log-forwarder.ts) and prints it to
 * this terminal. Also accepts interactive commands that are forwarded to
 * the extension over the same socket as RPC requests:
 *
 *   collectNow            — trigger a full collection cycle
 *   correlate [engine]    — run correlation (heuristic|embedding|…)
 *   getSnapshot           — latest collection snapshot summary
 *   getVersion            — extension build version + user agent
 *   getSettings           — current extension settings (JSON)
 *   getStorageUsage       — chrome.storage.local usage breakdown
 *   benchmark             — run correlation for several engines/models and score them
 *   benchmarkResults      — print the last stored benchmark report as a table
 *   ping                  — liveness check
 *
 * Run it BEFORE triggering a collection/correlation in the extension:
 *   bun run scripts/log-server.ts
 *
 * The extension connects to ws://localhost:18080. If the server isn't
 * running, the extension just buffers (up to 500 lines) and flushes on
 * connect, so you can start the server at any time.
 */

import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { createInterface } from 'node:readline';

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

const HELP = `Commands:
  collectNow              trigger a full collection cycle (waits for completion)
  correlate [engine]      run correlation (heuristic|embedding|sentiment|ner|llm)
  getSnapshot             latest collection snapshot summary
  getVersion              extension build version + user agent
  getSettings             current extension settings
  getStorageUsage         storage usage breakdown
  benchmark [engines]     run correlation per engine and score them
                          (default: heuristic embedding sentiment zeroshot ner;
                          e.g. "benchmark embedding embedding" with different models
                          is not supported yet — one run per engine)
  benchmarkResults        print the last benchmark report as a scored table
  ping                    liveness check
  help                    this message
  quit                    exit the server`;

interface BenchRun {
  engine: string;
  model: string;
  durationMs: number;
  error?: string;
  counts: Record<string, number>;
  top10Mean: Record<string, number>;
  score?: { total: number; coverage: number; precision: number; spread: number; speed: number };
}

interface BenchReport {
  benchmarkedAt?: number;
  inputs?: { markets: number; signals: number; news: number };
  runs?: BenchRun[];
  empty?: boolean;
}

const PASS_LABELS: Array<[string, string]> = [
  ['matches', 'sig→mkt'],
  ['newsMatches', 'news→mkt'],
  ['newsSocialMatches', 'news→soc'],
  ['newsNewsMatches', 'news↔news'],
];

/** Print a scored comparison table for a benchmark report. */
function printBenchmarkReport(report: BenchReport): void {
  if (!report || report.empty || !report.runs || report.runs.length === 0) {
    print('benchmark', COLORS.warn, 'No benchmark results yet — run "benchmark" first.');
    return;
  }
  if (report.inputs) {
    print('benchmark', COLORS.dim, `inputs: ${report.inputs.markets} markets, ${report.inputs.signals} signals, ${report.inputs.news} news`);
  }
  const rows = [...report.runs].sort((a, b) => (b.score?.total ?? -1) - (a.score?.total ?? -1));
  const header = `${'rank'.padEnd(5)}${'engine'.padEnd(11)}${'model'.padEnd(38)}${'score'.padEnd(7)}${'cov'.padEnd(6)}${'prec'.padEnd(6)}${'sprd'.padEnd(6)}${'spd'.padEnd(6)}${'time'.padEnd(9)}${PASS_LABELS.map(([, l]) => l.padEnd(10)).join('')}error`;
  print('benchmark', COLORS.ok, header);
  rows.forEach((r, i) => {
    const model = r.model.length > 36 ? r.model.slice(0, 35) + '…' : r.model;
    const s = r.score;
    const score = s ? s.total.toFixed(1) : 'FAIL';
    const cov = s ? s.coverage.toFixed(0) : '-';
    const prec = s ? s.precision.toFixed(0) : '-';
    const sprd = s ? s.spread.toFixed(0) : '-';
    const spd = s ? s.speed.toFixed(0) : '-';
    const time = `${(r.durationMs / 1000).toFixed(1)}s`;
    const counts = PASS_LABELS.map(([k]) => String(r.counts?.[k] ?? 0).padEnd(10)).join('');
    const err = r.error ? ` ${r.error.slice(0, 60)}` : '';
    const line = `${String(i + 1).padEnd(5)}${r.engine.padEnd(11)}${model.padEnd(38)}${score.padEnd(7)}${cov.padEnd(6)}${prec.padEnd(6)}${sprd.padEnd(6)}${spd.padEnd(6)}${time.padEnd(9)}${counts}${err}`;
    print('benchmark', r.error ? COLORS.error : COLORS.log, line);
  });
  print('benchmark', COLORS.dim, 'score = 40% coverage + 30% precision + 15% spread + 15% speed (0–100, higher = better)');
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
  const arg = rest.join(' ');

  try {
    switch (cmd) {
      case 'help':
        console.log(HELP);
        break;
      case 'quit':
      case 'exit':
        process.exit(0);
        break;
      case 'ping':
        print('rpc', COLORS.ok, `→ ${await callRpc('ping')}`);
        break;
      case 'getVersion':
        print('rpc', COLORS.rpc, JSON.stringify(await callRpc('getVersion'), null, 2));
        break;
      case 'collectNow':
        print('rpc', COLORS.rpc, JSON.stringify(await callRpc('collectNow'), null, 2));
        break;
      case 'correlate': {
        const params = arg ? { engine: arg } : {};
        print('rpc', COLORS.rpc, JSON.stringify(await callRpc('correlate', params), null, 2));
        break;
      }
      case 'getSnapshot':
        print('rpc', COLORS.rpc, JSON.stringify(await callRpc('getSnapshot'), null, 2));
        break;
      case 'getSettings':
        print('rpc', COLORS.rpc, JSON.stringify(await callRpc('getSettings'), null, 2));
        break;
      case 'getStorageUsage':
        print('rpc', COLORS.rpc, JSON.stringify(await callRpc('getStorageUsage'), null, 2));
        break;
      case 'benchmark': {
        const engines = arg ? arg.split(/[,\s]+/).filter(Boolean) : undefined;
        const report = (await callRpc('benchmark', engines ? { engines } : {})) as BenchReport;
        printBenchmarkReport(report);
        break;
      }
      case 'benchmarkResults': {
        const stored = (await callRpc('benchmarkResults')) as BenchReport;
        printBenchmarkReport(stored);
        break;
      }
      default:
        print('log-server', COLORS.warn, `Unknown command: ${cmd} (try "help")`);
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
