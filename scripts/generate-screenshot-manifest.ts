/**
 * Screenshot manifest generator.
 *
 * Scans docs/assets/screenshots/ for PNG/WebM files and writes a
 * JSON manifest at docs/_data/screenshots.json. The Jekyll docs
 * site reads this manifest to render the gallery and use-case pages,
 * so new screenshots appear automatically without editing HTML.
 *
 * Run:
 *   bun run docs:manifest
 *
 * In CI, the docs workflow runs this after Playwright generates the
 * screenshots, then builds the Jekyll site.
 */

import { readdirSync, statSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { resolve, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');

const SCREENSHOT_DIR = join(ROOT, 'docs', 'static', 'assets', 'screenshots');
const DATA_DIR = join(ROOT, 'docs', 'data');
const OUTPUT = join(DATA_DIR, 'screenshots.json');

// ── Screenshot metadata ──────────────────────────────────────────
// Each entry maps a filename to a title, description, and use-case
// category. New screenshots should be added here so the docs site
// can render them with proper context.

interface ScreenshotMeta {
  title: string;
  description: string;
  category: 'dashboard' | 'popup' | 'overlay' | 'video';
}

const META: Record<string, ScreenshotMeta> = {
  'dashboard-feed-dark.png': {
    title: 'Hype Feed — Dark Mode',
    description:
      'The default new-tab dashboard showing trending social signals from X, Reddit, and TikTok. Tile colour reflects sentiment (green = bullish, red = bearish). Cards are sorted by virality score.',
    category: 'dashboard',
  },
  'dashboard-feed-light.png': {
    title: 'Hype Feed — Light Mode',
    description:
      'The same Hype Feed in light mode. TrendCast supports a full dark/light theme toggle that persists across sessions.',
    category: 'dashboard',
  },
  'dashboard-markets.png': {
    title: 'Market Odds Treemap',
    description:
      'Prediction market contracts from Polymarket and Kalshi displayed as a treemap. Tile size is proportional to 24h volume; colour reflects Yes probability. Star toggle adds a market to your watchlist.',
    category: 'dashboard',
  },
  'dashboard-news.png': {
    title: 'News Feed',
    description:
      'Latest headlines from BBC, CNN, Yahoo Finance, and Google News. Each card shows the source badge, headline, summary, and publish time.',
    category: 'dashboard',
  },
  'dashboard-correlations.png': {
    title: 'Correlation Network Graph',
    description:
      'Force-directed network graph showing how social signals, news, and market contracts connect. Directed edges show causal flow: News → Social, Social → Market, News → Market. Hover highlights connected nodes.',
    category: 'dashboard',
  },
  'dashboard-watchlist.png': {
    title: 'Watchlist',
    description:
      'Markets you have starred for personal tracking. The watchlist persists in chrome.storage.local across sessions.',
    category: 'dashboard',
  },
  'dashboard-history.png': {
    title: 'History Charts',
    description:
      'Historical collection trends rendered as interactive SVG line charts. Metric selector switches between Markets, Signals, News, Correlations, and Avg Sentiment. Hover shows a tooltip with exact values and a detail panel with top items.',
    category: 'dashboard',
  },
  'dashboard-community.png': {
    title: 'Community',
    description:
      'Links to the TrendCast Telegram group and GitHub Issues for bug reports and feature requests.',
    category: 'dashboard',
  },
  'dashboard-faq.png': {
    title: 'FAQ — Correlation Engines',
    description:
      'In-app FAQ explaining the six correlation engines (Heuristic, Embedding, Sentiment, Zero-Shot, NER, LLM) and how to choose between them.',
    category: 'dashboard',
  },
  'dashboard-settings.png': {
    title: 'Settings',
    description:
      'Configure collection interval, enabled data sources, highlight threshold, correlation engine, and ML model. No API keys needed — everything runs client-side.',
    category: 'dashboard',
  },
  'dashboard-header.png': {
    title: 'Dashboard Header',
    description:
      'Close-up of the sticky header showing the TrendCast logo, live stats (markets/signals/news counts), build version, last collection time, Export dropdown, theme toggle, and Collect Now button.',
    category: 'dashboard',
  },
  'dashboard-empty.png': {
    title: 'Empty State',
    description:
      'The dashboard before any data has been collected, showing the empty-state message.',
    category: 'dashboard',
  },
  'popup-home.png': {
    title: 'Popup — Home',
    description:
      'The toolbar popup quick-launcher. Shows Open Dashboard button, Collect Now button, quick stats (markets/signals/news), storage usage indicator, and active source badges.',
    category: 'popup',
  },
  'popup-faq.png': {
    title: 'Popup — FAQ',
    description: 'Compact FAQ view inside the popup for quick reference.',
    category: 'popup',
  },
  'popup-settings.png': {
    title: 'Popup — Settings',
    description:
      'Settings panel inside the popup for quick access to source toggles and collection interval.',
    category: 'popup',
  },
  'overlay-social.png': {
    title: 'Odds Overlay on Social Platforms',
    description:
      'When browsing X, Reddit, or TikTok, a floating overlay shows correlated prediction market odds for the content you are reading. The overlay is scoped and high-z-index so it stays above the platform UI.',
    category: 'overlay',
  },
  'trendcast-tour.webm': {
    title: 'TrendCast Dashboard Tour',
    description:
      'A 30-second screen-cast walking through all nine dashboard tabs, demonstrating the theme toggle, export menu, and collect-now action.',
    category: 'video',
  },
};

interface ManifestEntry extends ScreenshotMeta {
  file: string;
  path: string;
  size: number;
  modified: string;
}

function ensureDir(dir: string) {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // already exists
  }
}

function renameVideo(): void {
  // Playwright saves videos as page@<hash>.webm — rename to trendcast-tour.webm
  ensureDir(SCREENSHOT_DIR);
  let files: string[] = [];
  try {
    files = readdirSync(SCREENSHOT_DIR);
  } catch {
    return;
  }
  const webmFiles = files.filter((f) => extname(f).toLowerCase() === '.webm');
  for (const f of webmFiles) {
    if (f === 'trendcast-tour.webm') continue;
    const oldPath = join(SCREENSHOT_DIR, f);
    const newPath = join(SCREENSHOT_DIR, 'trendcast-tour.webm');
    if (existsSync(newPath)) {
      // Remove stale trendcast-tour.webm first
      try { renameSync(newPath, newPath + '.bak'); } catch { /* ignore */ }
    }
    try {
      renameSync(oldPath, newPath);
      console.log(`✓ Renamed ${f} → trendcast-tour.webm`);
    } catch (e) {
      console.error(`⚠ Could not rename ${f}: ${e}`);
    }
  }
}

function buildManifest(): ManifestEntry[] {
  ensureDir(SCREENSHOT_DIR);
  let files: string[] = [];
  try {
    files = readdirSync(SCREENSHOT_DIR);
  } catch {
    // directory doesn't exist yet
    return [];
  }

  const entries: ManifestEntry[] = [];

  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (!['.png', '.webm', '.jpg', '.jpeg', '.gif'].includes(ext)) continue;

    const fullPath = join(SCREENSHOT_DIR, file);
    const stat = statSync(fullPath);
    const meta = META[file] ?? {
      title: basename(file, ext),
      description: '',
      category: ext === '.webm' ? ('video' as const) : ('dashboard' as const),
    };

    entries.push({
      file,
      path: `assets/screenshots/${file}`,
      size: stat.size,
      modified: new Date(stat.mtimeMs).toISOString(),
      ...meta,
    });
  }

  // Sort: dashboard, popup, overlay, video — then alphabetical
  const catOrder = { dashboard: 0, popup: 1, overlay: 2, video: 3 };
  entries.sort((a, b) => {
    const co = catOrder[a.category] - catOrder[b.category];
    if (co !== 0) return co;
    return a.file.localeCompare(b.file);
  });

  return entries;
}

function main() {
  renameVideo();
  const manifest = buildManifest();
  ensureDir(DATA_DIR);
  const output = {
    generated_at: new Date().toISOString(),
    screenshots: manifest,
  };
  writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`✓ Wrote ${manifest.length} entries to ${OUTPUT}`);
  for (const e of manifest) {
    console.log(`  ${e.file} (${(e.size / 1024).toFixed(0)} KB) — ${e.title}`);
  }
}

main();