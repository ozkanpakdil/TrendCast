---
title: "Installation"
description: "How to install TrendCast on Chrome, Firefox, Edge, and Brave."
---

## Prerequisites

- **Chrome** ≥ 114, **Firefox** ≥ 121, **Edge** ≥ 114, or **Brave** ≥ 114
- No API keys or accounts needed — the extension is 100% client-side

---

## Option 1: From the Chrome Web Store

> *Pending review — link will appear here once published.*

1. Visit the TrendCast listing on the
   [Chrome Web Store](https://chrome.google.com/webstore).
2. Click **Add to Chrome**.
3. Confirm the permission prompt.
4. The 📊 TrendCast icon appears in your toolbar.

This also works for **Edge** and **Brave** (both are Chromium-based and can
install from the Chrome Web Store).

---

## Option 2: From Firefox Add-ons (AMO)

> *Pending review — link will appear here once published.*

1. Visit the TrendCast listing on
   [Firefox Add-ons](https://addons.mozilla.org).
2. Click **Add to Firefox**.
3. Confirm the permission prompt.
4. The 📊 TrendCast icon appears in your toolbar.

---

## Option 3: From GitHub Releases (manual load)

### Chrome / Edge / Brave

1. Go to the [Releases page](https://github.com/ozkanpakdil/TrendCast/releases).
2. Download `trendcast-chrome-vX.Y.Z.zip` from the latest release.
3. Unzip the file.
4. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
5. Enable **Developer mode** (top-right toggle).
6. Click **Load unpacked** and select the unzipped folder.
7. The 📊 TrendCast icon appears in your toolbar.

### Firefox

1. Go to the [Releases page](https://github.com/ozkanpakdil/TrendCast/releases).
2. Download `trendcast-firefox-vX.Y.Z.xpi`.
3. Open `about:addons`.
4. Click the gear icon → **Install Add-on From File**.
5. Select the `.xpi` file.
6. Confirm the installation.

---

## Option 4: Build from source

```bash
git clone https://github.com/ozkanpakdil/TrendCast.git
cd TrendCast
bun install

# Build for Chrome
bun run build

# Build for Firefox
bun run build:firefox
```

The built extension is in `dist/`. Load it as an unpacked extension (Chrome)
or via `about:debugging` → "This Firefox" → "Load Temporary Add-on"
(Firefox).

---

## First Run

After installation:

1. **Open a new tab** — the TrendCast dashboard appears (if new tab override
   is enabled). You'll see an empty state initially.
2. **Click "Collect Now"** — in the header or popup to trigger the first
   data collection cycle.
3. **Browse social platforms** — visit X, Reddit, or TikTok to see the odds
   overlay appear.
4. **Customise settings** — click ⚙️ Settings to toggle sources, change the
   collection interval, or switch the correlation engine.

<div class="callout">
  <strong>Note:</strong> Social signal scraping (X, Reddit, TikTok) uses
  your active login session. You need to be logged in to those platforms
  for the content scripts to scrape trending posts. News and market data
  (BBC, CNN, Polymarket, Kalshi) require no login.
</div>