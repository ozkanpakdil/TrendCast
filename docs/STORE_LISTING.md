# Store Listing Assets

Ready-to-paste copy for the Chrome Web Store and Firefox AMO (Add-ons
for Mozilla) listing pages. Keep these in sync with `package.json` and
`PRIVACY.md`.

---

## Chrome Web Store

### Name
TrendCast — Social Sentiment × Prediction Markets

### Summary (132 chars max)
Track social sentiment across X, Reddit, and TikTok and correlate it
in real-time with Polymarket and Kalshi prediction market odds.

### Description

TrendCast is a 100% client-side browser extension that tracks social
sentiment and viral trends across X (Twitter), Reddit, and TikTok, and
correlates them in real-time with prediction market odds on Polymarket
and Kalshi.

**No API keys. No servers. No data sent anywhere.**

The extension uses your own browser sessions to collect data. When you
install it:

1. **Hourly background collection** — The background worker fetches
   public data (Polymarket Gamma API, Kalshi v2, Reddit .json, BBC/CNN
   RSS feeds) directly via `fetch()`. No authentication needed.
2. **Content script scraping** — When you browse X, Reddit, TikTok, BBC,
   or CNN, content scripts scrape the DOM for trending posts and
   headlines using your active login session.
3. **New tab dashboard** — Every time you open a new tab, you see all
   the latest hypes, news, and correlated market odds in one place.
4. **Odds overlay** — On social platforms, a floating overlay shows
   correlated prediction market odds for what you're reading.

**Features:**
- 🔥 Hype Feed — Virality heatmap of trending social signals
- 📈 Market Odds — Volume heatmap of Polymarket & Kalshi contracts
- 📰 News Feed — BBC, CNN, Yahoo Finance, and Google News headlines
- 🔗 Correlation Engine — Matches social signals and news to market
  contracts using NER-based entity matching + Jaccard similarity
- ⭐ Watchlist — Star markets to track them personally
- 📊 History Charts — Historical collection trends with interactive
  SVG charts
- 🎨 Dark/Light theme toggle
- 📤 Data export (CSV/JSON)
- 📊 Storage usage indicator with automatic pruning

**Privacy:**
- 100% client-side — no servers, no API keys
- No telemetry, no analytics, no tracking
- All data stored locally in your browser
- Open source under the MIT license

### Category
Productivity

### Language
English

### Privacy Policy URL
(Add the URL to PRIVACY.md hosted on GitHub Pages or your site)

### Single Purpose
TrendCast tracks social sentiment and prediction market odds in a
single dashboard, correlating viral trends with market contracts to
help users spot emerging narratives.

### Permission Justifications

| Permission | Justification |
|-----------|---------------|
| `storage` | Store collected market data, social signals, news headlines, and user settings locally in the browser. |
| `alarms` | Schedule hourly background data collection (MV3 service workers are ephemeral; `chrome.alarms` survives restarts). |
| `tabs` | Open the TrendCast dashboard in a new tab and detect the active tab URL for odds overlay injection. |
| `scripting` | Inject content scripts to scrape publicly visible DOM content on supported sites (X, Reddit, TikTok, BBC, CNN, Polymarket, Kalshi). |
| `host_permissions: *://*.polymarket.com/*` | Fetch Polymarket public Gamma API and scrape market cards when the user visits polymarket.com. |
| `host_permissions: *://*.kalshi.com/*` | Fetch Kalshi public v2 API and scrape market pages when the user visits kalshi.com. |
| `host_permissions: *://*.x.com/*` | Scrape trending topics when the user visits x.com. |
| `host_permissions: *://*.reddit.com/*` | Fetch Reddit public .json endpoints and scrape post titles when the user visits reddit.com. |
| `host_permissions: *://*.tiktok.com/*` | Scrape trend titles when the user visits tiktok.com. |
| `host_permissions: *://*.bbc.com/*` | Fetch BBC RSS feed and scrape headlines when the user visits bbc.com. |
| `host_permissions: *://*.cnn.com/*` | Fetch CNN news (via Google News RSS) and scrape headlines when the user visits cnn.com. |
| `host_permissions: *://api.rss2json.com/*` | CORS proxy for RSS feeds (BBC, CNN, Yahoo Finance, Google News, Google Trends) — necessary because browsers block direct RSS fetches from extension workers. |

---

## Firefox AMO (Add-ons for Mozilla)

### Name
TrendCast — Social Sentiment × Prediction Markets

### Summary
Track social sentiment across X, Reddit, and TikTok and correlate it
in real-time with Polymarket and Kalshi prediction market odds. 100%
client-side — no servers, no API keys.

### Description
(Same as Chrome Web Store description above)

### Categories
- Social Media
- News & Blogging
- Developer Tools

### Privacy Policy
See `PRIVACY.md`.

### Firefox-specific notes
- Requires Firefox 121+ (MV3 support)
- Background uses `scripts` (event page), not `service_worker`
- `browser_specific_settings.gecko.id`: `trendcast@trendcast.dev`

---

## Screenshots needed

Prepare these screenshots (1280×800 or 640×400) for the store listings:

1. **Dashboard — Hype Feed tab** — Virality heatmap with trending signals
2. **Dashboard — Markets tab** — Volume heatmap of prediction markets
3. **Dashboard — Correlations tab** — Network graph of signal→market matches
4. **Dashboard — History tab** — Historical collection charts
5. **Popup** — Quick-launcher with stats and storage indicator
6. **Settings** — Source toggles and collection interval

## Icons

Replace the placeholder PNG icons in `public/icons/` before submission:
- `icon-16.png` (16×16)
- `icon-32.png` (32×32)
- `icon-48.png` (48×48)
- `icon-128.png` (128×128)

A promotional tile (440×280) is also needed for the Chrome Web Store.