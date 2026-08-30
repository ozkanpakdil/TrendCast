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
 *
 * ⚠️ The extension only connects when the "Stream logs to local server"
 * setting is enabled (Settings → Debug). The forwarder is debug-build-only
 * and is stripped from production bundles regardless of the setting.
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
                          (default: heuristic embedding sentiment ner;
                          engine=model pairs override the model, e.g.
                          "benchmark llm=HuggingFaceTB/SmolLM2-360M-Instruct")
  benchmarkResults        print the last benchmark report as a scored table
  getCorrelations         stored correlation result (engine/model/computedAt/counts)
  seedCorrelations        write a synthetic stored result to test gate/badge/trigger
                          (opts: engine=… model=… staleMs=… error="msg" requestId=…)
  clearCorrelations       remove the stored correlation result
  runState                ML run-state marker + queue liveness (live/queued ids)
  lastCollection          lastCollectionAt + snapshot collectedAt + input counts
  evaluateTrigger         dry-run of the Phase 16 re-analysis trigger decision
  triggerPrecompute       run the post-collection precompute path now (awaits)
  tabs                    list open extension pages (dashboard/popup)
  text [--page popup]     full page text (innerText) of an extension page
  dom <selector> [--text X] [--page popup]
                          query DOM elements (tag/text/visible) in a page
  shot [path]             screenshot the dashboard → PNG file
  shot [path] --page popup  target the popup page instead
  open <dashboard|popup>  open or focus an extension page
  click <selector> [--text X] [--page popup]
                          click an element in an extension page
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
        // Accept "engine" or "engine=model" tokens; a model override maps to
        // the `model` RPC param the background correlate handler supports
        // (lets UAT force a broken/unavailable model to test error paths).
        const tokens = arg ? arg.split(/[\s,]+/).filter(Boolean) : [];
        const params: Record<string, string> = {};
        for (const token of tokens) {
          const eq = token.indexOf('=');
          if (eq > 0) {
            const engine = token.slice(0, eq);
            if (engine === 'model') {
              params.model = token.slice(eq + 1);
            } else {
              params.engine = engine;
              params.model = token.slice(eq + 1);
            }
          } else {
            params.engine = token;
          }
        }
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
        // Accept "engine" or "engine=model" tokens; model overrides map to the
        // RPC params the background benchmark handler already supports.
        const tokens = arg ? arg.split(/[\s,]+/).filter(Boolean) : [];
        const engines: string[] = [];
        const params: Record<string, string> = {};
        for (const token of tokens) {
          const eq = token.indexOf('=');
          if (eq > 0) {
            const engine = token.slice(0, eq);
            params[`${engine}Model`] = token.slice(eq + 1);
            if (!engines.includes(engine)) engines.push(engine);
          } else {
            engines.push(token);
          }
          if (!['heuristic', 'embedding', 'sentiment', 'ner', 'llm'].includes(
            eq > 0 ? token.slice(0, token.indexOf('=')) : token,
          )) {
            print('benchmark', COLORS.warn, `Unknown engine in "${token}" — valid: heuristic embedding sentiment ner llm`);
          }
        }
        const report = (await callRpc('benchmark', { ...params, ...(engines.length ? { engines } : {}) })) as BenchReport;
        printBenchmarkReport(report);
        break;
      }
      case 'benchmarkResults': {
        const stored = (await callRpc('benchmarkResults')) as BenchReport;
        printBenchmarkReport(stored);
        break;
      }
      case 'getCorrelations':
        print('rpc', COLORS.rpc, JSON.stringify(await callRpc('getCorrelations'), null, 2));
        break;
      case 'seedCorrelations': {
        // Accept key=value tokens: engine= model= staleMs= error= requestId=
        const params: Record<string, unknown> = {};
        for (const token of arg.split(/[\s,]+/).filter(Boolean)) {
          const eq = token.indexOf('=');
          if (eq <= 0) {
            print('seedCorrelations', COLORS.warn, `Ignoring malformed token "${token}" (expected key=value)`);
            continue;
          }
          const key = token.slice(0, eq);
          const value = token.slice(eq + 1);
          if (key === 'staleMs') params[key] = Number(value);
          else params[key] = value;
        }
        print('rpc', COLORS.rpc, JSON.stringify(await callRpc('seedCorrelations', params), null, 2));
        break;
      }
      case 'clearCorrelations':
        print('rpc', COLORS.ok, JSON.stringify(await callRpc('clearCorrelations'), null, 2));
        break;
      case 'runState':
        print('rpc', COLORS.rpc, JSON.stringify(await callRpc('getRunState'), null, 2));
        break;
      case 'lastCollection':
        print('rpc', COLORS.rpc, JSON.stringify(await callRpc('getLastCollection'), null, 2));
        break;
      case 'evaluateTrigger':
        print('rpc', COLORS.rpc, JSON.stringify(await callRpc('evaluateTrigger'), null, 2));
        break;
      case 'triggerPrecompute':
        print('rpc', COLORS.rpc, JSON.stringify(await callRpc('triggerPrecompute'), null, 2));
        break;
      case 'tabs': {
        const res = (await callRpc('debugTabs')) as { tabs?: Array<{ page: string; tabId: number | null; url: string; title: string; active: boolean }> };
        if (!res.tabs || res.tabs.length === 0) {
          print('tabs', COLORS.warn, 'No extension pages open (open the dashboard or popup first).');
        } else {
          for (const t of res.tabs) {
            print('tabs', COLORS.ok, `#${t.tabId ?? '?'} ${t.active ? '*' : ' '} ${t.page.padEnd(10)} ${t.title.slice(0, 40)}  ${t.url.slice(0, 60)}`);
          }
        }
        break;
      }
      case 'text': {
        // text [--page popup]
        const pageIdx = rest.indexOf('--page');
        const page = pageIdx >= 0 ? rest[pageIdx + 1] : 'dashboard';
        const res = (await callRpc('debugText', { page })) as { text?: string };
        if (typeof res.text === 'string') {
          print('text', COLORS.rpc, res.text.slice(0, 4000));
        } else {
          print('text', COLORS.warn, 'No text returned (is the page open?)');
        }
        break;
      }
      case 'dom': {
        // dom <selector> [--text X] [--page popup]
        const textIdx = rest.indexOf('--text');
        const text = textIdx >= 0 ? rest[textIdx + 1] : null;
        const pageIdx = rest.indexOf('--page');
        const page = pageIdx >= 0 ? rest[pageIdx + 1] : 'dashboard';
        const positional = rest.filter((t, i) => t !== '--text' && t !== '--page' && i !== textIdx + 1 && i !== pageIdx + 1);
        const selector = positional.join(' ');
        if (!selector) {
          print('dom', COLORS.warn, 'Usage: dom <selector> [--text X] [--page popup]');
          break;
        }
        const res = (await callRpc('debugDom', { selector, text, page })) as { count?: number; items?: unknown[] };
        print('dom', COLORS.rpc, JSON.stringify(res, null, 2));
        break;
      }
      case 'shot': {
        // shot [path] [--page popup]
        const pageIdx = rest.indexOf('--page');
        const page = pageIdx >= 0 ? rest[pageIdx + 1] : 'dashboard';
        const positional = rest.filter((t, i) => t !== '--page' && i !== pageIdx + 1 && !t.startsWith('--'));
        const path = positional[0] ?? '/tmp/trendcast-bridge-shot.png';
        const res = (await callRpc('debugCapture', { page })) as { dataUrl?: string };
        if (!res.dataUrl) {
          print('shot', COLORS.error, 'Capture returned no data (is the tab visible?).');
          break;
        }
        const { writeFileSync } = await import('node:fs');
        writeFileSync(path, Buffer.from(res.dataUrl.split(',')[1] ?? '', 'base64'));
        print('shot', COLORS.ok, `✓ Screenshot: ${path}`);
        break;
      }
      case 'open': {
        const page = arg || 'dashboard';
        if (!['dashboard', 'popup'].includes(page)) {
          print('open', COLORS.warn, 'Usage: open <dashboard|popup>');
          break;
        }
        const res = await callRpc('debugOpen', { page });
        print('open', COLORS.ok, JSON.stringify(res));
        break;
      }
      case 'click': {
        // click <selector> [--text X] [--page popup]
        const textIdx = rest.indexOf('--text');
        const text = textIdx >= 0 ? rest[textIdx + 1] : null;
        const pageIdx = rest.indexOf('--page');
        const page = pageIdx >= 0 ? rest[pageIdx + 1] : 'dashboard';
        const positional = rest.filter((t, i) => t !== '--text' && t !== '--page' && i !== textIdx + 1 && i !== pageIdx + 1);
        const selector = positional.join(' ');
        if (!selector) {
          print('click', COLORS.warn, 'Usage: click <selector> [--text X] [--page popup]');
          break;
        }
        const res = (await callRpc('debugClick', { selector, text, page })) as { result?: unknown };
        print('click', COLORS.rpc, JSON.stringify(res.result, null, 2));
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
