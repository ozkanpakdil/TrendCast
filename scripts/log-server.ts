/**
 * Local WebSocket log server for TrendCast debug builds.
 *
 * Receives forwarded `[TrendCast]` console output from the extension's
 * background worker (see src/utils/log-forwarder.ts) and prints it to
 * this terminal, timestamped and color-coded by level.
 *
 * Run it BEFORE triggering a collection/correlation in the extension:
 *   bun run scripts/log-server.ts
 *
 * The extension connects to ws://localhost:18080. If the server isn't
 * running, the extension just buffers (up to 500 lines) and flushes on
 * connect, so you can start the server at any time.
 *
 * Uses only Node built-ins — no dependencies.
 */

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = 18080;

const COLORS = {
  log: '\x1b[37m', // white
  info: '\x1b[36m', // cyan
  warn: '\x1b[33m', // yellow
  error: '\x1b[31m', // red
  reset: '\x1b[0m',
} as const;

const server = createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', (socket) => {
  console.log(`\x1b[32m[log-server]\x1b[0m Extension connected — streaming logs… (Ctrl+C to stop)\n`);

  socket.on('message', (raw) => {
    let msg: { type?: string; ts?: string; data?: string };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      console.log(raw.toString());
      return;
    }
    const level = (msg.type ?? 'log') as keyof typeof COLORS;
    const color = COLORS[level] ?? COLORS.log;
    const ts = msg.ts ? new Date(msg.ts).toLocaleTimeString() : '';
    console.log(`${color}[${ts}] ${msg.data ?? ''}\x1b[0m`);
  });

  socket.on('close', () => {
    console.log(`\x1b[33m[log-server]\x1b[0m Extension disconnected.\n`);
  });
});

server.listen(PORT, () => {
  console.log(`\x1b[32m[log-server]\x1b[0m Listening on ws://localhost:${PORT}`);
  console.log(`\x1b[32m[log-server]\x1b[0m Waiting for the TrendCast extension to connect…\n`);
});
