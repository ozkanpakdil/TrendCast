# 📊 TrendCast — Social Sentiment × Prediction Markets

A cross-browser extension (Chrome MV3 & Firefox compatible) that tracks social sentiment and viral trends across **X (Twitter)**, **Reddit**, **TikTok**, **BBC**, and **CNN**, and correlates them in real-time with prediction market odds on **Polymarket** and **Kalshi**.

📖 **Documentation**: [https://ozkanpakdil.github.io/TrendCast](https://ozkanpakdil.github.io/TrendCast)
📸 **Screenshots**: [https://ozkanpakdil.github.io/TrendCast/screenshots/](https://ozkanpakdil.github.io/TrendCast/screenshots/)

## 🎯 What It Does

**100% client-side. No API keys. No servers. No data sent anywhere.**

The extension uses your own browser sessions to collect data. When you install it:

1. **Hourly background collection** — The background worker fetches public data (Polymarket Gamma API, Kalshi v2, Reddit .json, BBC/CNN RSS feeds) directly via `fetch()`. No authentication needed.
2. **Content script scraping** — When you browse X, Reddit, TikTok, BBC, or CNN, content scripts scrape the DOM for trending posts and headlines using your active login session.
3. **New tab dashboard** — Every time you open a new tab, you see all the latest hypes, news, and correlated market odds in one place.
4. **Odds overlay** — On social platforms, a floating overlay shows correlated prediction market odds for what you're reading.

| Feature | Description |
|---------|-------------|
| **New Tab Dashboard** | Full-page React dashboard replacing the new tab — shows aggregated hypes, news, market odds, and correlations. |
| **Hourly Collection** | `chrome.alarms`-based background collection from all enabled sources. Survives service worker termination. |
| **Social Signal Scraping** | Content scripts scrape X, Reddit, and TikTok for trending posts using your own login session. |
| **News Headlines** | BBC and CNN headlines fetched via public RSS feeds — no login required. |
| **Market Odds** | Polymarket and Kalshi market data fetched from public APIs — no API keys needed. |
| **Correlation Engine** | Matches social signals and news headlines to market contracts using Jaccard similarity + cashtag/hashtag boosting. |
| **Odds Overlay** | Floating overlay on social platforms showing correlated market odds. |
| **Popup Quick-Launcher** | Compact popup with "Open Dashboard" button, "Collect Now" button, and source toggles. |

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    TrendCast — 100% Client-Side Architecture             │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐    chrome.storage     ┌───────────────────────────┐    │
│  │  New Tab    │ ◄───────────────────► │  Background Service Worker │    │
│  │  Dashboard  │    read / listen      │  (MV3 — ephemeral)         │    │
│  │  (React +   │                       │                           │    │
│  │   Tailwind) │                       │  ┌─────────────────────┐  │    │
│  └─────────────┘                       │  │ Hourly Collection   │  │    │
│                                        │  │ (chrome.alarms)     │  │    │
│  ┌─────────────┐    sendMessage        │  │                     │  │    │
│  │  Popup      │ ◄──────────────────►  │  │  fetch() to:        │  │    │
│  │  (Quick     │                       │  │  • Polymarket Gamma │  │    │
│  │   Launcher) │                       │  │  • Kalshi v2        │  │    │
│  └─────────────┘                       │  │  • Reddit .json     │  │    │
│                                        │  │  • BBC RSS          │  │    │
│  ┌─────────────┐    REPORT_*_DATA       │  │  • CNN RSS          │  │    │
│  │  Content    │ ─────────────────────►│  └─────────────────────┘  │    │
│  │  Scripts    │                       │                           │    │
│  │             │                       │  ┌─────────────────────┐  │    │
│  │ • Markets   │                       │  │ Correlation Engine  │  │    │
│  │ • Socials  │                       │  │ (keyword matching)  │  │    │
│  │ • News     │                       │  └─────────────────────┘  │    │
│  └─────────────┘                       │                           │    │
│                                        │  chrome.storage.local     │    │
│  User's browser sessions:              └───────────────────────────┘    │
│  • X / Reddit / TikTok login cookies                                     │
│  • BBC / CNN (no login needed)                                           │
│  • Polymarket / Kalshi (no login needed for public data)                 │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
TrendCast/
├── src/
│   ├── manifest.config.ts              # Typed MV3 manifest (@crxjs/vite-plugin)
│   ├── background/
│   │   └── index.ts                    # Service worker: alarms, collection, messaging
│   ├── content/
│   │   ├── prediction-markets/
│   │   │   └── index.ts                # Polymarket/Kalshi DOM scraper
│   │   ├── socials/
│   │   │   ├── index.ts                # X/Reddit/TikTok signal scraper + overlay
│   │   │   └── overlay.css             # Scoped overlay styles
│   │   └── news/
│   │       └── index.ts                # BBC/CNN headline scraper
│   ├── dashboard/                      # 🆕 New tab dashboard (primary UI)
│   │   ├── index.html
│   │   ├── index.tsx
│   │   ├── App.tsx                     # Full-page dashboard with tabs
│   │   ├── dashboard.css
│   │   ├── components/
│   │   │   ├── HypeFeed.tsx            # Trending social signals
│   │   │   ├── NewsFeed.tsx            # BBC/CNN headlines
│   │   │   ├── MarketOdds.tsx          # Prediction market odds
│   │   │   └── CorrelationPanel.tsx    # Signal→Market + News→Market matches
│   │   └── hooks/
│   │       ├── useSnapshot.ts          # Read latest collection snapshot
│   │       └── useCorrelations.ts       # Run correlation analysis
│   ├── messaging/
│   │   ├── browser.ts                  # webextension-polyfill re-export
│   │   └── index.ts                    # Type-safe sendMessage / onMessage
│   ├── popup/
│   │   ├── index.html
│   │   ├── index.tsx
│   │   ├── App.tsx                     # Quick-launcher (open dashboard, collect now)
│   │   ├── popup.css
│   │   ├── components/
│   │   │   └── Settings.tsx            # Source toggles, interval, threshold
│   │   └── hooks/
│   │       ├── useSettings.ts
│   │       ├── useSnapshot.ts
│   │       └── useCachedMarkets.ts
│   ├── services/
│   │   ├── collectors/                 # 🆕 Replaces old API clients
│   │   │   ├── polymarket.ts           # Polymarket Gamma API (public, no key)
│   │   │   ├── kalshi.ts               # Kalshi v2 API (public, no auth)
│   │   │   ├── reddit.ts               # Reddit .json endpoints (no OAuth)
│   │   │   ├── news.ts                 # BBC/CNN RSS feed parser
│   │   │   └── index.ts                # Barrel export
│   │   └── engine/
│   │       └── correlation.ts          # Keyword matching + confidence scoring
│   ├── types/
│   │   └── index.ts                    # Shared domain types
│   ├── config/
│   │   └── index.ts                    # Scrape URLs, collection config, storage keys
│   └── utils/
│       ├── keywords.ts                 # Keyword extraction + Jaccard similarity
│       └── rate-limiter.ts             # Token-bucket rate limiter
├── tests/
│   └── unit/
│       └── correlation.test.ts
├── dist/
│   ├── chrome/                    # Chrome / Edge / Brave build
│   └── firefox/                   # Firefox build
├── manifest.json
├── package.json
├── vite.config.ts
├── tailwind.config.ts
└── postcss.config.js
```

## 🚀 Getting Started

### Prerequisites

- **Bun** ≥ 1.3 (or Node.js ≥ 18 with npm/pnpm/yarn)
- Chrome ≥ 114 or Firefox ≥ 121

### Installation

```bash
cd TrendCast
bun install
```

### Development

```bash
# Start Vite dev server with HMR (Chrome)
bun run dev

# For Firefox
bun run dev:firefox
```

### Build

```bash
# Build for BOTH Chrome and Firefox (recommended)
bun run build

# Build for a single browser
bun run build:chrome
bun run build:firefox

# Package as ZIP / XPI
bun run zip:chrome
bun run zip:firefox
```

Each browser gets its own output folder so the two builds never clobber
each other:

```
dist/
├── chrome/    # ← load this in Chrome / Edge / Brave
│   └── manifest.json   → background.service_worker
└── firefox/   # ← load this in Firefox
    └── manifest.json   → background.scripts
```

> ⚠️ **Why separate folders?** Firefox does not support
> `background.service_worker` in MV3 — it requires `background.scripts`.
> The manifest switches automatically based on the build target, so the
> two builds must live in separate directories.

## 🧪 Testing

```bash
bun run test          # Run unit tests
bun run test:watch    # Watch mode
bun run typecheck      # TypeScript type checking
bun run lint           # ESLint
```

## 📸 Screenshots & Documentation

The full documentation site is hosted on GitHub Pages at
[https://ozkanpakdil.github.io/TrendCast](https://ozkanpakdil.github.io/TrendCast)
and is **automatically rebuilt on every release**.

### Generate screenshots locally

```bash
bunx playwright install --with-deps chromium   # one-time
bun run screenshots                             # captures all UI tabs + popup + overlay
bun run docs:manifest                           # updates docs/data/screenshots.json
```

Screenshots are saved to `docs/static/assets/screenshots/` and a screen-cast
WebM is recorded for the dashboard tab tour.

### Serve docs locally

```bash
bun run docs:serve    # Hugo dev server at http://localhost:1313/TrendCast/
```

### How it works in CI

The `.github/workflows/docs.yml` workflow triggers on version tags (`v*`):

1. Builds the extension in debug mode and serves it via `sirv-cli`.
2. Runs the Playwright screenshot spec
   (`tests/screenshots/screenshots.spec.ts`) with a dedicated config
   (`playwright.screenshots.config.ts`).
3. Renames the screen-cast to `trendcast-tour.webm`.
4. Runs `scripts/generate-screenshot-manifest.ts` to produce
   `docs/data/screenshots.json`.
5. Builds the Hugo site and deploys to GitHub Pages.

## 🤖 CI/CD & Releases

A GitHub Actions workflow (`.github/workflows/release.yml`) automatically builds and publishes releases.

### Automatic (tag push)

```bash
git tag v0.1.0
git push origin v0.1.0
```

This triggers the workflow which:
1. Runs unit tests
2. Builds both Chrome and Firefox targets in parallel (`build:chrome` / `build:firefox`)
3. Packages each from its own folder as `trendcast-{chrome,firefox}-<tag>.zip`
4. Creates a GitHub Release with auto-generated notes and both zips attached

### Manual dispatch

Go to **Actions** → **Build & Release** → **Run workflow** and enter a tag name (e.g. `v0.1.0`).

The release artifacts appear under **Releases** on your repository page, ready to download and load as unpacked extensions.

## 🌐 Loading the Extension

### Chrome / Edge / Brave

1. Run `bun run build` (or `bun run build:chrome`)
2. Open `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the `dist/chrome/` folder
6. Open a new tab — the TrendCast dashboard appears

### Firefox

1. Run `bun run build` (or `bun run build:firefox`)
2. Open `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on**
4. Select `dist/firefox/manifest.json`

## ⚙️ Configuration

**No API keys needed!** The extension is 100% client-side.

Open the popup → **Settings** tab to configure:

| Setting | Description | Default |
|---------|-------------|---------|
| Collection interval | How often the background worker collects data | 60 min (hourly) |
| Data sources | Toggle Polymarket, Kalshi, X, Reddit, TikTok, BBC, CNN | All enabled (TikTok off by default) |
| Highlight threshold | Minimum virality score to highlight signals | 60/100 |
| Override new tab | Replace the new tab page with the dashboard | Enabled |

## 📊 Data Sources

| Source | Method | Login Required? | Data Collected |
|--------|--------|----------------|----------------|
| **Polymarket** | Public Gamma API (`fetch()`) | No | Market questions, odds, volume |
| **Kalshi** | Public v2 API (`fetch()`) | No | Market questions, odds, volume |
| **Reddit** | Public `.json` endpoints (`fetch()`) | No (login enhances personalization) | Post titles, upvotes, comments |
| **X (Twitter)** | DOM scraping (content script) | Yes (user's session) | Tweet text, engagement metrics |
| **TikTok** | DOM scraping (content script) | Yes (user's session) | Trend titles |
| **BBC News** | Public RSS feed (`fetch()`) | No | Headlines, summaries, images |
| **CNN** | Public RSS feed (`fetch()`) | No | Headlines, summaries, images |

## ⚠️ Browser Extension Pitfalls (Developer Notes)

### MV3 Service Worker Lifecycle

The service worker is **ephemeral** — Chrome kills it after ~30s of inactivity.

- ❌ **Never** use `setInterval` for polling — use `chrome.alarms`.
- ❌ **Never** store state in module-level variables — use `chrome.storage.local`.
- ✅ **Always** register all event listeners synchronously at the top level.

### Content Script Isolation

- Content scripts run in an **isolated world** — they cannot access page JS variables.
- They CAN read/write the DOM and send messages to the background worker.
- The user's login session cookies are sent automatically by the browser — we never handle credentials.

### DOM Scraping Fragility

- Social platforms (X, TikTok) change their DOM frequently. Selectors may break.
- We use `MutationObserver` with **debouncing** (500ms) to handle SPA route changes.
- The background collection (RSS, public APIs) is more stable than DOM scraping.

## 🔧 Tech Stack

| Tool | Purpose |
|------|---------|
| **React 18** | Popup + new tab dashboard UI |
| **TypeScript 5** | Type safety across all modules |
| **Tailwind CSS 3** | Popup + dashboard styling |
| **Vite 5** | Build tool + dev server |
| **@crxjs/vite-plugin** | Extension-aware bundling + HMR |
| **webextension-polyfill** | Cross-browser API normalisation |
| **Bun** | Package manager + script runner |
| **Vitest** | Unit testing |

## 🗺️ Roadmap

### Phase 1 — Foundation (✅ Complete)
- [x] Project scaffolding (React + TypeScript + Tailwind + Vite + @crxjs)
- [x] MV3 manifest with cross-browser support
- [x] Type system (MarketContract, SocialSignal, NewsItem, CollectionSnapshot)
- [x] Messaging layer (type-safe sendMessage/onMessage)
- [x] Keyword extraction + Jaccard similarity
- [x] Correlation engine (signal→market + news→market)

### Phase 2 — Client-Side Architecture (✅ Complete)
- [x] Replace API clients with collectors (no API keys)
- [x] Background hourly collection via `chrome.alarms`
- [x] New tab dashboard (HypeFeed, NewsFeed, MarketOdds, CorrelationPanel)
- [x] BBC/CNN RSS news collection
- [x] Content scripts for prediction markets, socials, and news
- [x] Popup simplified to quick-launcher
- [x] Source toggle settings (no API key inputs)

### Phase 3 — Enhancement (✅ Complete)
- [x] X (Twitter) trending topics scraping (explore page)
- [x] TikTok trend extraction (discover page)
- [x] NER-based entity extraction (replace keyword matching)
- [x] Historical correlation charts in the dashboard
- [x] Sentiment analysis (NLP-based, not just upvote ratio)
- [x] Custom watchlists (user picks markets to track)
- [x] Dark/light theme toggle for dashboard
- [x] Data export (CSV/JSON)

### Phase 4 — Polish & Ship
- [ ] Firefox permanent signing via AMO — ready for submission (see `docs/STORE_LISTING.md`)
- [ ] Chrome Web Store submission — ready for submission (see `docs/STORE_LISTING.md`)
- [x] Cross-browser QA (Chrome, Edge, Firefox, Brave) — see `docs/QA_CHECKLIST.md`
- [x] Performance optimization (storage size limits, collection efficiency)
      — 7 MB storage budget with automatic pruning (`src/utils/storage.ts`)
      — ETag/Last-Modified conditional fetch to skip unchanged responses (`src/utils/conditional-fetch.ts`)
- [x] Privacy policy + documentation — `PRIVACY.md`, `docs/STORE_LISTING.md`, `docs/QA_CHECKLIST.md`

## � Community & Support

| Channel | Use for | Link |
|---------|---------|------|
| **Telegram** | General chat, announcements, quick questions | [t.me/trendcast_community](https://t.me/trendcast_community) |
| **GitHub Issues** | Bug reports, feature requests | [GitHub Issues](https://github.com/ozkanpakdil/trendcast/issues) |

The extension is 100% client-side — the Telegram link is just for community discussion. No data is ever sent to Telegram or any server.

## �📄 License

MIT