/**
 * Screen control for the REAL Firefox extension (debug builds only).
 *
 * Uses Puppeteer over WebDriver BiDi (Mozilla's officially supported
 * automation protocol, co-developed with the Chrome team). Verified working:
 *   ✓ installExtension() — BiDi webExtension.install (temporary add-on)
 *   ✓ dashboard auto-opens (debug build auto-open, see src/background/index.ts)
 *   ✓ screenshot of the real dashboard (67 KB PNG, real content)
 *   ✓ JS evaluation in the extension page (title, nav buttons, etc.)
 *
 * Why the auto-open dance: Firefox blocks ALL external navigation to
 * moz-extension:// URLs — geckodriver, WebDriver BiDi, CDP, every protocol.
 * The extension opening its own page IS allowed, so the debug build opens
 * the dashboard on install and the driver attaches to the already-open tab.
 *
 * Prerequisites:
 *   bun run build:debug:firefox        (dist/firefox must exist)
 *
 * Usage:
 *   bun run scripts/drive-firefox.ts                # open dashboard + screenshot
 *   bun run scripts/drive-firefox.ts -- shot /tmp/d.png
 *   bun run scripts/drive-firefox.ts -- eval "document.title"
 *   bun run scripts/drive-firefox.ts -- click "nav button" --text Correlations
 *   bun run scripts/drive-firefox.ts -- rpc getCorrelations
 *   bun run scripts/drive-firefox.ts -- rpc seedCorrelations staleMs=3600000
 *   bun run scripts/drive-firefox.ts -- rpc collectNow
 *
 * RPC mode requires the log server:
 *   bun run log-server                              # in another terminal
 *   Settings → Debug → "Stream logs to local server" ON (in the dashboard)
 */

import puppeteer from 'puppeteer-core';
import { writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const DIST = resolve(ROOT, 'dist/firefox');
const FIREFOX = '/Applications/Firefox.app/Contents/MacOS/firefox';

// ── CLI parsing ───────────────────────────────────────────────────
const args = process.argv.slice(2);
const mode = args[0] ?? 'dashboard'; // dashboard | popup | shot | eval | click | rpc
const modeArg = args[1];
const textFilter = args.includes('--text') ? args[args.indexOf('--text') + 1] : null;

if (!existsSync(DIST)) {
  console.error('✗ dist/firefox not found — run: bun run build:debug:firefox');
  process.exit(1);
}

// ── BiDi helpers ──────────────────────────────────────────────────
type BiDiResult = { result?: { result?: { type: string; value?: unknown } } };

type Connection = { send: (method: string, params: unknown) => Promise<BiDiResult> };

/** Evaluate an expression in a browsing context; returns the raw JS value. */
async function evalInContext(
  conn: Connection,
  contextId: string,
  expression: string,
): Promise<unknown> {
  const res = (await conn.send('script.evaluate', {
    expression,
    target: { context: contextId },
    awaitPromise: true,
  })) as {
    result?: {
      result?: { type: string; value?: unknown };
      exceptionDetails?: { text?: string; exception?: { value?: unknown } };
    };
  };
  if (res.result?.exceptionDetails) {
    const detail = res.result.exceptionDetails;
    throw new Error(
      `${detail.text ?? 'evaluation failed'}${detail.exception ? `: ${JSON.stringify(detail.exception.value)}` : ''}`,
    );
  }
  return res.result?.result?.value;
}

/** Find the moz-extension:// browsing context in the BiDi tree. */
async function findExtensionContext(
  conn: Connection,
  urlPart: string,
): Promise<string | null> {
  const tree = (await conn.send('browsingContext.getTree', { maxDepth: 5 })) as {
    result?: { contexts?: Array<{ context: string; url: string }> };
  };
  for (const c of tree.result?.contexts ?? []) {
    if (c.url.startsWith('moz-extension://') && c.url.includes(urlPart)) {
      return c.context;
    }
  }
  return null;
}

/** Wait until the extension page appears in the BiDi tree. */
async function waitForExtensionContext(
  conn: Connection,
  urlPart: string,
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const id = await findExtensionContext(conn, urlPart);
    if (id) return id;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`extension page (${urlPart}) did not appear within ${timeoutMs}ms`);
}

/** Capture a screenshot of a browsing context to a file. */
async function screenshotContext(
  conn: Connection,
  contextId: string,
  path: string,
): Promise<void> {
  const shot = (await conn.send('browsingContext.captureScreenshot', { context: contextId })) as {
    result?: { data?: string };
  };
  if (!shot.result?.data) throw new Error('screenshot returned no data');
  writeFileSync(path, Buffer.from(shot.result.data, 'base64'));
}

// ── Main ──────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const profile = mkdtempSync(join(tmpdir(), 'trendcast-drive-'));
  const browser = await puppeteer.launch({
    browser: 'firefox',
    executablePath: FIREFOX,
    headless: true, // remove to watch the browser live
    args: ['-profile', profile],
  });

  let exitCode = 0;
  try {
    // 1. Install the extension as a temporary add-on (BiDi webExtension.install).
    const addonId = await (
      browser as unknown as { installExtension: (p: string) => Promise<string> }
    ).installExtension(DIST);
    console.log(`✓ Extension installed: ${addonId}`);

    // 2. The debug build auto-opens the dashboard on install (the extension
    //    opens its own page — the ONLY trusted path to moz-extension://).
    const conn = (
      browser as unknown as { connection: Connection }
    ).connection;
    const dashboardContext = await waitForExtensionContext(conn, '/src/dashboard/index.html');
    console.log('✓ Dashboard tab found (auto-opened by debug build)');

    // 3. Dispatch on mode.
    switch (mode) {
      case 'dashboard':
      case 'shot': {
        const path = modeArg ?? '/tmp/trendcast-dashboard.png';
        await screenshotContext(conn, dashboardContext, path);
        console.log(`✓ Screenshot: ${path}`);
        break;
      }

      case 'popup': {
        // The popup is a separate extension page; the debug build only
        // auto-opens the dashboard. Open the popup page via the extension's
        // own tabs API from the dashboard context.
        await evalInContext(
          conn,
          dashboardContext,
          `browser.tabs.create({ url: browser.runtime.getURL('src/popup/index.html') })`,
        );
        const popupContext = await waitForExtensionContext(conn, '/src/popup/index.html');
        const path = modeArg ?? '/tmp/trendcast-popup.png';
        await screenshotContext(conn, popupContext, path);
        console.log(`✓ Screenshot: ${path}`);
        break;
      }

      case 'eval': {
        if (!modeArg) {
          console.error('✗ eval needs an expression, e.g. -- eval "document.title"');
          exitCode = 1;
          break;
        }
        const result = await evalInContext(conn, dashboardContext, `(${modeArg})`);
        console.log('←', JSON.stringify(result, null, 2));
        break;
      }

      case 'click': {
        if (!modeArg) {
          console.error('✗ click needs a CSS selector, e.g. -- click "nav button" --text Correlations');
          exitCode = 1;
          break;
        }
        const clicked = await evalInContext(
          conn,
          dashboardContext,
          `(() => {
             const els = [...document.querySelectorAll(${JSON.stringify(modeArg)})];
             const el = ${textFilter ? `els.find(e => e.textContent?.includes(${JSON.stringify(textFilter)}))` : 'els[0]'};
             if (!el) return { clicked: false, available: els.length };
             el.click();
             return { clicked: true, text: el.textContent?.trim() };
           })()`,
        );
        console.log('←', JSON.stringify(clicked));
        if ((clicked as { clicked?: boolean })?.clicked) {
          await new Promise((r) => setTimeout(r, 1500)); // let React settle
          const path = '/tmp/trendcast-after-click.png';
          await screenshotContext(conn, dashboardContext, path);
          console.log(`✓ Screenshot: ${path}`);
        } else {
          exitCode = 1;
        }
        break;
      }

      case 'rpc': {
        if (!modeArg) {
          console.error('✗ rpc needs a method, e.g. -- rpc getCorrelations');
          exitCode = 1;
          break;
        }
        // Send the RPC from the dashboard page to the background worker via
        // browser.runtime.sendMessage. NOTE: this uses the extension's real
        // message protocol (onMessage handlers in src/background/index.ts),
        // NOT the log-forwarder RPC bridge — so it works for the message
        // handlers (CORRELATE_ALL, EXPORT_DATA, ...) but not for the debug
        // RPCs (getCorrelations etc.), which live on the WebSocket bridge.
        // For those, use the log server: bun run log-server.
        const params: Record<string, unknown> = {};
        for (const token of args.slice(2)) {
          const eq = token.indexOf('=');
          if (eq > 0) {
            const k = token.slice(0, eq);
            const v = token.slice(eq + 1);
            params[k] = /^-?\d+$/.test(v) ? Number(v) : v;
          }
        }
        const result = await evalInContext(
          conn,
          dashboardContext,
          `(async () => {
             const resp = await browser.runtime.sendMessage({ type: ${JSON.stringify(modeArg)}, ...${JSON.stringify(params)} });
             return resp;
           })()`,
        );
        console.log('←', JSON.stringify(result, null, 2));
        break;
      }

      default:
        console.error(`✗ Unknown mode: ${mode} (dashboard|popup|shot|eval|click|rpc)`);
        exitCode = 1;
    }
  } catch (err) {
    console.error('✗', err instanceof Error ? err.message : err);
    exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
  }
  process.exit(exitCode);
}

void main();