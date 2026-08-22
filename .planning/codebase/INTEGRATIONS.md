# External Integrations

**Analysis Date:** 2026-08-22

## APIs & External Services

**Prediction Markets (public, no auth):**
- **Polymarket Gamma API** — Fetches active markets. Endpoint: `https://gamma-api.polymarket.com/markets?limit=100&active=true&closed=false&order=volume&ascending=false` (configured in `src/config/index.ts`). Consumed directly via `fetch()` in `src/services/collectors/polymarket.ts`. Docs: https://docs.polymarket.com.
- **Kalshi Trade API v2** — Fetches open events with nested markets. Endpoint: `https://external-api.kalshi.com/trade-api/v2/events?status=open&limit=100&mve_filter=exclude&with_nested_markets=true`. Uses cursor-based pagination in `src/services/collectors/kalshi.ts`. Docs: https://trading-api.readme.io/kalshi/v2/overview.

**Social Platforms (DOM scraping + public endpoints):**
- **Reddit** — Public `.json` endpoints (`https://www.reddit.com/r/popular/hot.json?limit=50` and per-subreddit feeds). No OAuth/API key. Collector: `src/services/collectors/reddit.ts`. Content script scrapes DOM on `reddit.com` (`src/content/socials/index.ts`).
- **X (Twitter)** — No free public API. Trends sourced via Google Trends RSS proxied through rss2json.com. Collector: `src/services/collectors/x-trends.ts`. Content script scrapes DOM on `x.com`/`twitter.com`.
- **TikTok** — DOM scraping only on `tiktok.com` via content script (`src/content/socials/index.ts`). No API.

**News (RSS via rss2json.com CORS proxy):**
- **rss2json.com** — CORS-friendly JSON proxy converting RSS feeds to JSON. Required because Firefox MV3 background workers enforce CORS even with host_permissions, and RSS feeds don't send CORS headers. Used for BBC, CNN, Yahoo Finance, Google News, Seeking Alpha, and Investing.com feeds. Collector: `src/services/collectors/news.ts`.
  - BBC: `https://feeds.bbci.co.uk/news/rss.xml`
  - CNN: Google News RSS filtered to `site:cnn.com`
  - Yahoo Finance: `https://finance.yahoo.com/news/rssindex`
  - Google Finance: Google News RSS filtered to finance/politics keywords
  - Seeking Alpha / Investing.com: Google News RSS filtered by site (no public RSS)
- **Google Trends RSS** — `https://trends.google.com/trending/rss?geo=US` (via rss2json) for X trends.
- Content scripts also scrape news DOM on `bbc.com`, `cnn.com`, `seekingalpha.com`, `investing.com` (`src/content/news/index.ts`).

**ML Model Downloads (Hugging Face Hub):**
- **Hugging Face Hub** — Model weights downloaded on first use via `@huggingface/transformers`. No API keys; only public model weights fetched. Host permissions granted for `huggingface.co`, `cdn-lfs.huggingface.co`, `cdn-lfs-us-1.huggingface.co`, `cdn-lfs-eu-1.huggingface.co`. Models configured in `src/config/index.ts` (`CONFIG.ml`).
  - Embedding: `Xenova/all-MiniLM-L6-v2`, `Xenova/bge-small-en-v1.5`, `Xenova/gte-small`
  - Sentiment: `Xenova/distilbert-base-uncased-finetuned-sst-2-english`, `Xenova/twitter-roberta-base-sentiment-latest`, `Xenova/finbert`, `Xenova/bert-base-multilingual-uncased-sentiment`
  - Zero-shot: `Xenova/distilbert-base-uncased-mnli`, `Xenova/deberta-v3-base-zeroshot`
  - NER: `Xenova/bert-base-NER-uncased`, `Xenova/bert-large-NER-uncased`
  - LLM: `HuggingFaceTB/SmolLM2-135M-Instruct`, `HuggingFaceTB/SmolLM2-360M-Instruct`, `onnx-community/Qwen2.5-0.5B-Instruct-ONNX`, `onnx-community/Qwen2.5-1.5B-Instruct-ONNX`, `onnx-community/Phi-3.5-mini-instruct-onnx-web`, `onnx-community/DeepSeek-R1-Distill-Qwen-1.5B-ONNX`, `onnx-community/glm-edge-1.5b-chat-ONNX`

## Data Storage

**Databases:**
- None. No server-side database.

**File Storage:**
- Local filesystem only — the extension persists data in `chrome.storage.local` (MV3 quota ~10 MB, budgeted to 7 MB in `src/config/index.ts` `CONFIG.storageBudget`). Storage keys defined in `CONFIG.storage`. Pruning logic in `src/utils/storage.ts`.

**Caching:**
- `chrome.storage.local` — ETag/Last-Modified conditional-fetch cache (`CONFIG.fetch.cacheKey`) in `src/utils/conditional-fetch.ts`.
- Browser Cache API — used by Transformers.js for ML model caching (`src/services/engine/ml/transformers.ts`).

## Authentication & Identity

**Auth Provider:**
- None. No API keys, no OAuth, no user accounts. The extension relies on the user's own browser login sessions (cookies sent automatically by the browser) for DOM scraping of X, Reddit, TikTok, and Polymarket/Kalshi. Public endpoints (Gamma, Kalshi v2, Reddit .json, RSS) require no auth.

## Monitoring & Observability

**Error Tracking:**
- None. No external error-tracking service.

**Logs:**
- `console.log` / `console.warn` / `console.error` throughout the codebase (e.g., `[TrendCast]`-prefixed messages in `src/background/index.ts`, collectors, and the ML worker). No structured logging.

## CI/CD & Deployment

**Hosting:**
- GitHub Pages — documentation site at `https://ozkanpakdil.github.io/TrendCast/` (configured in `docs/hugo.toml`).

**CI Pipeline:**
- Not detected in repo (no `.github/workflows` referenced in scope). Build/package scripts exist in `package.json` (`build`, `zip`, `zip:chrome`, `zip:firefox`).

## Environment Configuration

**Required env vars:**
- `TARGET=firefox` — build-time switch for Firefox output (`vite.config.ts`, `src/manifest.config.ts`).
- No secret env vars required. No `.env` files present.

**Secrets location:**
- Not applicable — no secrets/API keys used.

## Webhooks & Callbacks

**Incoming:**
- None. No server-side webhook endpoints.

**Outgoing:**
- None. The extension only makes outbound `fetch()` calls to public APIs and RSS proxies; it does not register webhooks.

## Cross-Browser Integration Notes

- **Chrome MV3**: background uses `service_worker`; `chrome.action` popup; `chrome_url_overrides.newtab` dashboard.
- **Firefox MV3**: background uses `background.scripts` (event page) — Firefox does not support `service_worker`. `browser_specific_settings.gecko` with `id: trendcast@trendcast.dev`, `strict_min_version: 121.0`. `webextension-polyfill` bridges the API differences (`src/messaging/browser.ts`).
- **CORS caveat**: Firefox MV3 background workers enforce CORS even with host_permissions, so RSS feeds are routed through the rss2json.com proxy.

---

*Integration audit: 2026-08-22*
