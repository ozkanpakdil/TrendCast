---
title: "Privacy"
description: "TrendCast is 100% client-side — no servers, no API keys, no telemetry."
---

## TL;DR

**TrendCast does not send your data anywhere.** There are no servers, no
API keys, no telemetry, no analytics, and no tracking. All data is collected
and stored locally in your browser.

---

## What Data Is Collected

TrendCast collects **public data** from the following sources:

| Source | Data | How | Login needed? |
|--------|------|-----|---------------|
| Polymarket | Market contracts, odds, volume | Public Gamma API (`fetch()`) | No |
| Kalshi | Market contracts, odds, volume | Public v2 API (`fetch()`) | No |
| Reddit | Trending posts, scores | `.json` endpoints + DOM scrape | Optional |
| X (Twitter) | Trending posts, metrics | DOM content script | Yes |
| TikTok | Trending posts, metrics | DOM content script | Yes |
| BBC | Headlines, summaries | Public RSS feed | No |
| CNN | Headlines, summaries | Public RSS feed | No |
| Yahoo Finance | Headlines | Public RSS / DOM | No |
| Google Finance | Headlines | Public RSS / DOM | No |

---

## Where Data Is Stored

All collected data is stored in `chrome.storage.local` (or
`browser.storage.local` on Firefox). This is:

- **Local to your browser** — not synced to any cloud.
- **Subject to your browser's storage limits** — typically 10 MB for
  extensions.
- **Automatically pruned** — TrendCast keeps a configurable number of
  history entries (default: 168 = 7 days of hourly data) and removes the
  oldest entries automatically.

You can check storage usage at any time via the popup's storage indicator.

---

## What Has Network Access

The extension's `host_permissions` in the manifest declare which domains it
can access. These are limited to:

- `polymarket.com` / `gamma-api.polymarket.com`
- `kalshi.com` / `external-api.kalshi.com`
- `reddit.com`
- `x.com` / `twitter.com`
- `tiktok.com`
- `bbc.com` / `bbc.co.uk`
- `cnn.com`
- `finance.yahoo.com`
- `google.com`

No other domains are accessed. You can verify this by inspecting the
[manifest source](https://github.com/ozkanpakdil/TrendCast/blob/main/src/manifest.config.ts).

---

## What Is NOT Collected

- ❌ No browsing history
- ❌ No passwords or form data
- ❌ No personal information
- ❌ No telemetry or usage analytics
- ❌ No IP address logging
- ❌ No fingerprinting

---

## Data Export and Deletion

- **Export** — Use the Export dropdown (CSV/JSON) in the dashboard header to
  download all collected data.
- **Delete** — Uninstall the extension to remove all stored data. You can
  also clear it via `chrome://extensions` → TrendCast → "Remove".

---

## Open Source

TrendCast is open source under the MIT license. You can audit every line of
code at [GitHub](https://github.com/ozkanpakdil/TrendCast).