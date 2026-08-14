# TrendCast — Privacy Policy

**Last updated: 2026-08-14**

TrendCast is a 100% client-side browser extension. Your privacy is the
core design principle — this document explains exactly what data is
collected, where it is stored, and who can see it.

## TL;DR

- **No servers.** TrendCast has no backend. All data stays in your browser.
- **No accounts.** No sign-up, no login, no API keys.
- **No telemetry.** We do not collect analytics, crash reports, or usage stats.
- **No third-party tracking.** No ads, no trackers, no beacons.
- **Your data never leaves your browser.** Everything is stored locally in
  `chrome.storage.local` (or the Firefox equivalent).

## What Data TrendCast Collects

TrendCast fetches **public** data from the following sources using your
browser's existing sessions:

| Source | Data collected | How |
|--------|---------------|-----|
| **Polymarket** | Active market questions, odds, volume | Public Gamma API (`gamma-api.polymarket.com`) |
| **Kalshi** | Active market questions, odds, volume | Public Kalshi v2 API (`external-api.kalshi.com`) |
| **Reddit** | Popular/hot post titles, scores, comments | Public `.json` endpoints (`reddit.com/r/popular/hot.json`) |
| **X / Twitter trends** | Trending topic names | Google Trends RSS (via `api.rss2json.com` proxy) |
| **BBC News** | Headlines, links, publish dates | BBC RSS feed (via `api.rss2json.com` proxy) |
| **CNN** | Headlines, links, publish dates | Google News RSS filtered to CNN (via `api.rss2json.com` proxy) |
| **Yahoo Finance** | Financial news headlines | Yahoo Finance RSS (via `api.rss2json.com` proxy) |
| **Google News** | Finance/politics headlines | Google News RSS (via `api.rss2json.com` proxy) |

When you visit **X (Twitter)**, **Reddit**, **TikTok**, **BBC**, **CNN**,
**Polymarket**, or **Kalshi** in your browser, TrendCast's content scripts
also read the **publicly visible DOM** of those pages (headlines, post
titles, market cards) to supplement the hourly background collection.

### What TrendCast does NOT collect

- ❌ Your login credentials or passwords
- ❌ Your private messages or DMs
- ❌ Your browsing history
- ❌ Personally identifiable information (PII)
- ❌ Your IP address (no server to log it)
- ❌ Cookies (the browser sends them automatically to sites you're logged into;
  TrendCast never reads or stores cookie values)

## Where Data Is Stored

All collected data is stored **locally** in your browser's extension storage
(`chrome.storage.local` on Chrome/Edge/Brave, `browser.storage.local` on
Firefox). This data:

- Never leaves your device.
- Is not transmitted to any server (TrendCast has no server).
- Is not shared with any third party.
- Can be cleared at any time by uninstalling the extension or via the
  dashboard's export + clear options.

### Storage budget

TrendCast targets a **7 MB soft budget** within the ~10 MB
`chrome.storage.local` quota. When the budget is exceeded, the oldest
collected data is automatically pruned to stay within limits.

## What TrendCast Does With the Data

1. **Correlation analysis** — The extension matches social signals and news
   headlines to prediction market contracts using keyword/entity similarity.
   This runs entirely in your browser.
2. **Display** — The new tab dashboard shows aggregated hypes, news, market
   odds, and correlations.
3. **Export** — You can export collected data as CSV or JSON for your own
   analysis. This is a manual action you initiate.

## Permissions and Why They're Needed

| Permission | Why it's needed |
|-----------|-----------------|
| `storage` | Store collected data and settings locally |
| `alarms` | Schedule hourly background collection (MV3-compliant) |
| `tabs` | Open the dashboard in a new tab; detect active tab URL for overlay |
| `scripting` | Inject content scripts for DOM scraping on supported sites |
| `host_permissions` (various) | Allow `fetch()` to public APIs and content scripts on supported sites |

No permission is used to collect, transmit, or store your personal data.

## Third-Party Services

TrendCast uses **`api.rss2json.com`** as a CORS proxy to convert RSS feeds
(BBC, CNN, Yahoo Finance, Google News, Google Trends) into JSON. This is
necessary because browsers block direct RSS fetches from extension
background workers due to CORS. The proxy receives the RSS feed URL you
configure — it does not receive any data from your browser, your sessions,
or your TrendCast storage.

No other third-party services are used.

## Data Retention

- **Collected data** (markets, signals, news): Retained until pruned by the
  storage budget or until you uninstall the extension.
- **History entries**: Up to 168 hourly snapshots (7 days) by default,
  configurable in Settings.
- **Settings**: Retained until you uninstall the extension.

## Your Rights

Since all data is local, you have full control:

- **View**: Open the dashboard to see all collected data.
- **Export**: Use the Export button (CSV/JSON) to download your data.
- **Delete**: Uninstall the extension to delete all data immediately.
  You can also clear extension storage via your browser's extension
  management page.

## Open Source

TrendCast is open source under the MIT license. You can audit every line
of code at: https://github.com/your-org/TrendCast

## Changes to This Policy

Any changes to this privacy policy will be updated in this file and
noted in the extension's release notes. Since TrendCast has no server,
no notification is sent to anyone when the policy changes.

## Contact

This is an open-source project with no commercial entity. For questions
about privacy, please open an issue on the GitHub repository.