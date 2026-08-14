# 📊 HypeMarket — Social Sentiment × Prediction Markets

A cross-browser extension (Chrome MV3 & Firefox compatible) that tracks social sentiment and viral trends across **X (Twitter)**, **Reddit**, and **TikTok**, and correlates them in real-time with prediction market odds on **Polymarket** and **Kalshi**.

## 🎯 What It Does

| Feature | Description |
|---------|-------------|
| **Market Context Detection** | When you browse Polymarket or Kalshi, the extension reads the active contract and fetches live odds. |
| **Social Signal Scraping** | When you browse X, Reddit, or TikTok, the extension extracts trending keywords from the page. |
| **Correlation Engine** | Matches social keywords/entities to prediction market contracts using Jaccard similarity + cashtag/hashtag boosting. |
| **Odds Overlay** | Injects a floating overlay on social platforms showing correlated market odds. |
| **Popup Dashboard** | React-based popup with a dashboard, market browser, and settings panel. |
| **Background Polling** | MV3 `chrome.alarms`-based polling that survives service worker termination. |

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Extension Architecture                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────┐     runtime.sendMessage     ┌──────────────────┐     │
│  │  Popup   │ ◄──────────────────────────► │  Background SW   │     │
│  │  (React) │                              │  (MV3 Service    │     │
│  │  Tailwind│                              │   Worker)        │     │
│  └──────────┘                              │                  │     │
│                                            │  ┌────────────┐  │     │
│  ┌──────────┐     tabs.sendMessage         │  │ API Clients│  │     │
│  │ Content  │ ◄──────────────────────────► │  │ Polymarket │  │     │
│  │ Scripts  │                              │  │ Kalshi     │  │     │
│  │          │                              │  │ Reddit     │  │     │
│  │ • Markets│                              │  └────────────┘  │     │
│  │ • Socials│                              │                  │     │
│  └──────────┘                              │  ┌────────────┐  │     │
│                                            │  │ Correlation│  │     │
│                                            │  │ Engine     │  │     │
│                                            │  └────────────┘  │     │
│                                            │                  │     │
│                                            │  chrome.alarms   │     │
│                                            │  chrome.storage  │     │
│                                            └──────────────────┘     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
TrendCast/
├── src/
│   ├── manifest.config.ts          # Typed MV3 manifest (@crxjs/vite-plugin)
│   ├── background/
│   │   └── index.ts                # Service worker: alarms, message routing, polling
│   ├── content/
│   │   ├── prediction-markets/
│   │   │   └── index.ts            # Polymarket/Kalshi DOM scraper + URL detection
│   │   └── socials/
│   │       ├── index.ts            # X/Reddit/TikTok keyword extraction + overlay injection
│   │       └── overlay.css         # Scoped overlay styles
│   ├── messaging/
│   │   ├── browser.ts              # webextension-polyfill re-export
│   │   └── index.ts                # Type-safe sendMessage / onMessage helpers
│   ├── popup/
│   │   ├── index.html              # Popup HTML entry
│   │   ├── index.tsx               # React entry point
│   │   ├── App.tsx                 # Main app with tab navigation
│   │   ├── popup.css               # Tailwind directives
│   │   ├── components/
│   │   │   ├── Dashboard.tsx       # Correlated markets overview
│   │   │   ├── MarketsView.tsx     # Browse cached market contracts
│   │   │   └── Settings.tsx        # API keys, polling, platform toggles
│   │   └── hooks/
│   │       ├── useCachedMarkets.ts # Read/refresh markets from storage
│   │       └── useSettings.ts      # Read/update extension settings
│   ├── services/
│   │   ├── api/
│   │   │   ├── polymarket.ts       # Polymarket Gamma + CLOB API client
│   │   │   ├── kalshi.ts           # Kalshi REST v2 API client
│   │   │   └── reddit.ts           # Reddit OAuth + search API client
│   │   └── engine/
│   │       └── correlation.ts      # Keyword matching + confidence scoring
│   ├── types/
│   │   └── index.ts                # Shared domain types (MarketContract, SocialSignal, etc.)
│   ├── config/
│   │   └── index.ts                # API endpoints, rate limits, polling config
│   └── utils/
│       ├── keywords.ts             # Keyword extraction + Jaccard similarity
│       └── rate-limiter.ts         # Token-bucket rate limiter
├── public/
│   └── icons/
│       └── icon.svg                # Placeholder icon (generate PNGs before publishing)
├── tests/
│   └── unit/
│       └── correlation.test.ts     # Vitest tests for keywords + correlation
├── manifest.json                   # Static manifest reference
├── package.json
├── tsconfig.json
├── vite.config.ts                  # Vite + @crxjs/vite-plugin config
├── tailwind.config.ts
├── postcss.config.js
├── .eslintrc.cjs
├── .prettierrc
└── .gitignore
```

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9 (or pnpm/yarn)
- Chrome ≥ 114 or Firefox ≥ 121

### Installation

```bash
# Clone the repo
cd TrendCast

# Install dependencies
npm install
```

### Development

```bash
# Start Vite dev server with HMR (Chrome)
npm run dev

# For Firefox
npm run dev:firefox
```

> **Note:** `@crxjs/vite-plugin` provides HMR for content scripts and the popup.
> The background service worker reloads automatically on changes.

### Build

```bash
# Build for Chrome
npm run build

# Build for Firefox
npm run build:firefox

# Package as ZIP (for Chrome Web Store / AMO upload)
npm run zip
```

The built extension will be in `dist/`.

## 🧪 Testing

### Unit Tests

```bash
# Run tests once
npm run test

# Watch mode
npm run test:watch
```

Tests use **Vitest** with `jsdom` environment. Current coverage:
- `extractKeywords` — hashtag, cashtag, stop word filtering
- `keywordSimilarity` — Jaccard similarity computation
- `correlate` — signal-to-contract matching, confidence scoring, sorting

### Type Checking

```bash
npm run typecheck
```

### Linting

```bash
npm run lint
npm run lint:fix
```

## 🌐 Loading the Extension

### Chrome / Edge / Brave

1. Run `npm run build`
2. Open `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the `dist/` folder
6. The HypeMarket icon should appear in your toolbar

### Firefox

1. Run `npm run build:firefox`
2. Open `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on**
4. Select `dist/manifest.json`
5. The extension loads temporarily (until Firefox restarts)

> For permanent installation in Firefox, you need to sign the extension via
> [AMO](https://addons.mozilla.org/developers/) or use an unbranded build.

## ⚙️ Configuration

### API Keys

Open the popup → **Settings** tab to configure:

| Key | Required For | How to Get |
|-----|-------------|------------|
| Reddit Client ID | Reddit social signals | [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) → create "script" app |
| Reddit Client Secret | Reddit social signals | Provided when you create the app |
| X Bearer Token | X (Twitter) signals | [developer.x.com](https://developer.x.com/) → create a project |

> **Polymarket and Kalshi** public market data does **not** require API keys.

### Settings Options

- **Polling interval**: How often the background worker refreshes market data (1–60 min)
- **Enabled platforms**: Toggle X, Reddit, TikTok signal sources
- **Notification threshold**: Minimum virality score (0–100) to trigger desktop notifications

## ⚠️ Browser Extension Pitfalls (Developer Notes)

### MV3 Service Worker Lifecycle

The service worker is **ephemeral** — Chrome kills it after ~30s of inactivity.

- ❌ **Never** use `setInterval` for polling — it will be killed. Use `chrome.alarms`.
- ❌ **Never** store state in module-level variables. Use `chrome.storage.local`.
- ❌ **Never** rely on WebSocket connections persisting. Reconnect on alarm events.
- ✅ **Always** register all event listeners synchronously at the top level of the worker script.

### CORS

- Content scripts can make `fetch()` calls to any URL listed in `host_permissions`.
- The background worker can fetch any URL in `host_permissions` without CORS restrictions.
- If you add new API endpoints, update `host_permissions` in `manifest.config.ts`.

### API Rate Limits

| Platform | Limit | Notes |
|----------|-------|-------|
| Polymarket | ~60 req/min | Public, no auth needed |
| Kalshi | ~60 req/min | Public market data, no auth |
| Reddit | 600 req/10min | Requires OAuth (app-only) |
| X API v2 | 15 req/15min (free) | Very limited free tier; consider scraping fallback |
| TikTok | N/A | No official API; DOM scraping only |

### DOM Mutation Observers

- Social platforms are SPAs — route changes don't trigger page reloads.
- We use `MutationObserver` with **debouncing** (500ms) to avoid thrashing.
- Always disconnect observers when the content script is unloaded.

### Content Script Isolation

- Content scripts run in an **isolated world** — they cannot access page JS variables.
- They CAN read/write the DOM and send messages to the background worker.
- To access page JS context, use `chrome.scripting.executeScript` with `world: 'MAIN'`.

## 🔧 Tech Stack

| Tool | Purpose |
|------|---------|
| **React 18** | Popup UI |
| **TypeScript 5** | Type safety across all modules |
| **Tailwind CSS 3** | Popup styling |
| **Vite 5** | Build tool + dev server |
| **@crxjs/vite-plugin** | Extension-aware bundling + HMR |
| **webextension-polyfill** | Cross-browser API normalisation |
| **Vitest** | Unit testing |

## 📦 Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (Chrome) |
| `npm run dev:firefox` | Start dev server (Firefox) |
| `npm run build` | Production build (Chrome) |
| `npm run build:firefox` | Production build (Firefox) |
| `npm run test` | Run unit tests |
| `npm run test:watch` | Watch mode tests |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | ESLint |
| `npm run format` | Prettier formatting |
| `npm run zip` | Package `dist/` as ZIP |

## 🗺️ Roadmap

- [ ] X (Twitter) API client + DOM scraping fallback
- [ ] TikTok trend extraction
- [ ] WebSocket support for real-time Polymarket order book
- [ ] NER-based entity extraction (replace keyword matching)
- [ ] Historical correlation charts in the popup
- [ ] Desktop notifications on sentiment spikes
- [ ] Firefox permanent signing via AMO
- [ ] Chrome Web Store submission

## 📄 License

MIT