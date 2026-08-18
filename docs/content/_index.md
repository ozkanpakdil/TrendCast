---
title: "TrendCast"
description: "TrendCast — a 100% client-side browser extension tracking social sentiment and prediction market odds."
---

<div class="hero">
  <h1>📊 TrendCast</h1>
  <p class="tagline">Social Sentiment × Prediction Markets</p>
  <div class="cta-group">
    <a class="cta cta-primary" href="/TrendCast/installation/">Install Now</a>
    <a class="cta cta-secondary" href="/TrendCast/screenshots/">View Screenshots</a>
    <a class="cta cta-secondary" href="https://github.com/ozkanpakdil/TrendCast" target="_blank" rel="noopener">GitHub ↗</a>
  </div>
</div>

<div class="callout">
  <strong>100% client-side.</strong> No API keys. No servers. No data sent anywhere.
  TrendCast uses your own browser sessions to collect data from X, Reddit, TikTok,
  BBC, CNN, Polymarket, and Kalshi — then correlates it all in real-time.
</div>

## What It Does

When you install TrendCast:

1. **Hourly background collection** — The background worker fetches public data
   (Polymarket Gamma API, Kalshi v2, Reddit `.json`, BBC/CNN RSS feeds) directly
   via `fetch()`. No authentication needed.
2. **Content script scraping** — When you browse X, Reddit, TikTok, BBC, or CNN,
   content scripts scrape the DOM for trending posts and headlines using your
   active login session.
3. **New tab dashboard** — Every time you open a new tab, you see all the latest
   hypes, news, and correlated market odds in one place.
4. **Odds overlay** — On social platforms, a floating overlay shows correlated
   prediction market odds for what you're reading.

## Quick Stats

<div class="feature-grid">
  <div class="feature-card">
    <div class="icon">🔥</div>
    <h3>Social Signals</h3>
    <p>X (Twitter), Reddit, and TikTok trending posts scraped via content scripts using your own login session.</p>
  </div>
  <div class="feature-card">
    <div class="icon">📈</div>
    <h3>Market Odds</h3>
    <p>Polymarket and Kalshi contracts fetched from public APIs — no API keys needed. Treemap heatmap by volume.</p>
  </div>
  <div class="feature-card">
    <div class="icon">📰</div>
    <h3>News Headlines</h3>
    <p>BBC, CNN, Yahoo Finance, and Google News headlines via public RSS feeds — no login required.</p>
  </div>
  <div class="feature-card">
    <div class="icon">🔗</div>
    <h3>Correlation Engine</h3>
    <p>Matches social signals and news to market contracts using keyword similarity, NER, embeddings, or LLM.</p>
  </div>
  <div class="feature-card">
    <div class="icon">🎨</div>
    <h3>Dark / Light Theme</h3>
    <p>Full theme toggle that persists across sessions. The dashboard adapts to your preference.</p>
  </div>
  <div class="feature-card">
    <div class="icon">🔒</div>
    <h3>Privacy First</h3>
    <p>No telemetry, no analytics, no tracking. All data stored locally in your browser. Open source MIT.</p>
  </div>
</div>

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    TrendCast — 100% Client-Side Architecture             │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐    chrome.storage     ┌───────────────────────────┐    │
│  │  New Tab    │ ◄───────────────────► │  Background Service Worker │    │
│  │  Dashboard  │    read / listen      │  (MV3 — ephemeral)         │    │
│  └─────────────┘                       │                           │    │
│                                        │  ┌─────────────────────┐  │    │
│  ┌─────────────┐    sendMessage        │  │ Hourly Collection   │  │    │
│  │  Popup      │ ◄──────────────────►  │  │ (chrome.alarms)     │  │    │
│  └─────────────┘                       │  └─────────────────────┘  │    │
│                                        │  ┌─────────────────────┐  │    │
│  ┌─────────────┐    REPORT_*_DATA       │  │ Correlation Engine  │  │    │
│  │  Content    │ ─────────────────────►│  └─────────────────────┘  │    │
│  │  Scripts    │                       └───────────────────────────┘    │
│  └─────────────┘                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Learn More

- [Features](/TrendCast/features/) — Detailed breakdown of every feature
- [Use Cases](/TrendCast/use-cases/) — Real-world scenarios with screenshots
- [Screenshots](/TrendCast/screenshots/) — Full gallery of the UI
- [Installation](/TrendCast/installation/) — How to install on Chrome, Firefox, Edge, and Brave
- [Privacy](/TrendCast/privacy/) — What data is collected and where it stays