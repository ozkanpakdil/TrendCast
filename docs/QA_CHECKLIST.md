# Cross-Browser QA Checklist

Manual testing checklist for TrendCast across Chrome, Edge, Firefox,
and Brave. Run through this before each store submission.

**Build commands:**
```bash
bun run build          # Chrome/Edge/Brave (MV3)
bun run build:firefox  # Firefox (MV3 event page)
```

---

## 1. Installation

| # | Test | Chrome | Edge | Firefox | Brave |
|---|------|--------|------|--------|-------|
| 1.1 | Load unpacked from `dist/` — no errors on install | ☐ | ☐ | ☐ | ☐ |
| 1.2 | Toolbar icon appears with TrendCast logo | ☐ | ☐ | ☐ | ☐ |
| 1.3 | Default settings seeded on first install | ☐ | ☐ | ☐ | ☐ |
| 1.4 | `chrome.alarms` registered on install (check `chrome.alarms.getAll()`) | ☐ | ☐ | ☐ | ☐ |
| 1.5 | New tab override shows dashboard (if enabled) | ☐ | ☐ | ☐ | ☐ |

## 2. Popup

| # | Test | Chrome | Edge | Firefox | Brave |
|---|------|--------|------|--------|-------|
| 2.1 | Popup opens on toolbar icon click | ☐ | ☐ | ☐ | ☐ |
| 2.2 | "Open Dashboard" button opens new tab dashboard | ☐ | ☐ | ☐ | ☐ |
| 2.3 | "Collect Now" triggers collection (spinner shows) | ☐ | ☐ | ☐ | ☐ |
| 2.4 | Stats (markets/signals/news counts) display correctly | ☐ | ☐ | ☐ | ☐ |
| 2.5 | Storage usage indicator shows MB used | ☐ | ☐ | ☐ | ☐ |
| 2.6 | Source toggles persist after popup close | ☐ | ☐ | ☐ | ☐ |
| 2.7 | Collection interval change persists | ☐ | ☐ | ☐ | ☐ |
| 2.8 | Theme toggle works (dark/light) | ☐ | ☐ | ☐ | ☐ |

## 3. Dashboard (New Tab)

| # | Test | Chrome | Edge | Firefox | Brave |
|---|------|--------|------|--------|-------|
| 3.1 | Dashboard loads with no console errors | ☐ | ☐ | ☐ | ☐ |
| 3.2 | Hype Feed tab — treemap renders signals | ☐ | ☐ | ☐ | ☐ |
| 3.3 | Hype Feed — grid view toggle works | ☐ | ☐ | ☐ | ☐ |
| 3.4 | Markets tab — treemap renders market odds | ☐ | ☐ | ☐ | ☐ |
| 3.5 | Markets tab — star toggle adds to watchlist | ☐ | ☐ | ☐ | ☐ |
| 3.6 | News tab — headlines with source badges | ☐ | ☐ | ☐ | ☐ |
| 3.7 | Correlations tab — network graph renders | ☐ | ☐ | ☐ | ☐ |
| 3.8 | Correlations — "Re-analyze" button works | ☐ | ☐ | ☐ | ☐ |
| 3.9 | Watchlist tab — shows starred markets | ☐ | ☐ | ☐ | ☐ |
| 3.10 | History tab — line chart renders with hover tooltip | ☐ | ☐ | ☐ | ☐ |
| 3.11 | Export CSV downloads file | ☐ | ☐ | ☐ | ☐ |
| 3.12 | Export JSON downloads file | ☐ | ☐ | ☐ | ☐ |
| 3.13 | Theme toggle persists across new tabs | ☐ | ☐ | ☐ | ☐ |
| 3.14 | Build version stamp shows in header | ☐ | ☐ | ☐ | ☐ |

## 4. Background Collection

| # | Test | Chrome | Edge | Firefox | Brave |
|---|------|--------|------|--------|-------|
| 4.1 | Manual "Collect Now" fetches all enabled sources | ☐ | ☐ | ☐ | ☐ |
| 4.2 | Polymarket markets appear after collection | ☐ | ☐ | ☐ | ☐ |
| 4.3 | Kalshi markets appear after collection | ☐ | ☐ | ☐ | ☐ |
| 4.4 | Reddit signals appear after collection | ☐ | ☐ | ☐ | ☐ |
| 4.5 | X/Twitter trends appear after collection | ☐ | ☐ | ☐ | ☐ |
| 4.6 | BBC/CNN/Yahoo/Google news appear after collection | ☐ | ☐ | ☐ | ☐ |
| 4.7 | `chrome.alarms` fires hourly (check console log) | ☐ | ☐ | ☐ | ☐ |
| 4.8 | Service worker survives termination (alarm re-registers) | ☐ | ☐ | ☐ | ☐ |
| 4.9 | Conditional fetch: 304 responses skip processing (check logs) | ☐ | ☐ | ☐ | ☐ |
| 4.10 | Storage pruning triggers when over 7 MB budget | ☐ | ☐ | ☐ | ☐ |

## 5. Content Scripts

| # | Test | Chrome | Edge | Firefox | Brave |
|---|------|--------|------|--------|-------|
| 5.1 | Visit polymarket.com — market data scraped (console log) | ☐ | ☐ | ☐ | ☐ |
| 5.2 | Visit kalshi.com — market data scraped | ☐ | ☐ | ☐ | ☐ |
| 5.3 | Visit x.com — trending topics scraped | ☐ | ☐ | ☐ | ☐ |
| 5.4 | Visit reddit.com — post titles scraped | ☐ | ☐ | ☐ | ☐ |
| 5.5 | Visit bbc.com — headlines scraped | ☐ | ☐ | ☐ | ☐ |
| 5.6 | Visit cnn.com — headlines scraped | ☐ | ☐ | ☐ | ☐ |
| 5.7 | Odds overlay appears on social platforms | ☐ | ☐ | ☐ | ☐ |
| 5.8 | Overlay close button works | ☐ | ☐ | ☐ | ☐ |
| 5.9 | SPA navigation re-triggers scrape (MutationObserver) | ☐ | ☐ | ☐ | ☐ |

## 6. Cross-Browser Specifics

### Chrome
- [ ] MV3 service worker — no `setInterval` warnings
- [ ] `chrome_url_overrides.newtab` works
- [ ] No `use_dynamic_url` in web_accessible_resources

### Edge
- [ ] Same as Chrome (Chromium-based MV3)
- [ ] No Edge-specific issues

### Firefox (121+)
- [ ] Background uses `scripts` (event page), not `service_worker`
- [ ] `browser_specific_settings.gecko.id` present
- [ ] `use_dynamic_url` stripped from web_accessible_resources
- [ ] `chrome.storage.local` works via polyfill
- [ ] `chrome.alarms` works via polyfill
- [ ] No CSP violations in console
- [ ] RSS fetch via rss2json works (Firefox enforces CORS in MV3 workers)

### Brave
- [ ] Same as Chrome (Chromium-based)
- [ ] Shields Down may be needed for rss2json proxy
- [ ] Verify fetch works with Brave Shields at default level

## 7. Performance

| # | Test | Pass |
|---|------|------|
| 7.1 | Dashboard first paint < 500ms with 100 markets | ☐ |
| 7.2 | Collection cycle completes < 30s with all sources | ☐ |
| 7.3 | Storage usage stays under 7 MB after 24h of hourly collection | ☐ |
| 7.4 | No memory leaks in dashboard (leave open 1h, check DevTools) | ☐ |
| 7.5 | Service worker terminates cleanly (no orphaned timers) | ☐ |
| 7.6 | Correlation engine completes < 5s with 100 markets × 50 signals | ☐ |

## 8. Error Handling

| # | Test | Pass |
|---|------|------|
| 8.1 | Network failure on one source doesn't block others | ☐ |
| 8.2 | Malformed API response doesn't crash collection | ☐ |
| 8.3 | Empty storage (fresh install) — dashboard shows empty states | ☐ |
| 8.4 | Export with no data produces valid (empty) CSV/JSON | ☐ |
| 8.5 | Fetch timeout (15s) aborts and logs error | ☐ |

## 9. Store Submission

### Chrome Web Store
- [ ] Replace placeholder icons in `public/icons/`
- [ ] Take 5 screenshots (1280×800)
- [ ] Prepare promotional tile (440×280)
- [ ] Fill listing from `docs/STORE_LISTING.md`
- [ ] Upload privacy policy URL
- [ ] Pay $5 developer fee (one-time)
- [ ] Submit for review

### Firefox AMO
- [ ] Build with `bun run build:firefox`
- [ ] Zip the `dist/` folder
- [ ] Upload to https://addons.mozilla.org/developers/
- [ ] Fill listing from `docs/STORE_LISTING.md`
- [ ] Submit for review (free, no fee)
- [ ] Optional: request AMO signing for permanent installation