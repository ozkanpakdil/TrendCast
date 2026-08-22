# Feature Research

**Domain:** Prediction-market / market-intelligence browser extension (correlating social sentiment, news, and market odds)
**Researched:** 2026-08-22
**Confidence:** HIGH
**Scope:** New milestone — correlation alerts, market-driven news view, TikTok collector, inverted-index speedup, watchlist/export improvements. Existing features are NOT re-researched.

## Feature Landscape

### Table Stakes (Users Expect These)

For a daily decision aid, the table stakes are **trust and non-intrusiveness**: alerts must not spam, the market-driven view must be correct, and new data must not break the existing collection cycle.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Correlation alerts that don't spam** | The core value is "surface strong signals fast." But a user who gets 20 notifications/hour disables them entirely. Dedupe + throttle + watchlist-scoping are the *minimum* for the feature to be usable, not polish. | MEDIUM | MV3 `chrome.notifications` + `chrome.alarms`. Alert payload = market + direction (bullish/bearish) + top correlated signal/news + confidence. Dedupe by market+signal hash; throttle per market; scope to watchlist by default. |
| **Watchlist-scoped alerting** | Users track the markets they care about; alerting on *everything* is noise. Watchlist-scoped is the highest-value, lowest-fatigue alert model. | LOW | Reuse existing `WatchlistEntry` (contractId + platform). Alert only when a watchlisted market crosses a strong-correlation threshold. |
| **Direction-aware alerts (bullish/bearish)** | "Market X is moving" is useless without "and it's moving up/down." Direction is what makes the alert actionable. | MEDIUM | Derive direction from the correlated signal's `sentiment` (already computed, -1..+1) and/or the market's Yes-price delta vs. prior snapshot. Bullish = positive sentiment + rising Yes price; bearish = inverse. |
| **Watchlist sort/filter/correlation status** | Users expect to organize their tracked markets and see at a glance which are moving. Current `Watchlist.tsx` only sorts by `addedAt` and shows odds. | LOW | Add sort (addedAt / volume / price delta / correlation confidence), filter (platform / category / has-correlation), and an inline correlation-status badge per entry. |
| **Export coverage for new sources** | Users expect export to stay complete as sources grow. `export.ts` already covers markets/signals/news/correlations; must add TikTok signals + any new market-driven-news data. | LOW | Extend `ExportData` + CSV/JSON sections. Verify TikTok signals flow through the existing `signals` export path (they're `SocialSignal`s). |

### Differentiators (Competitive Advantage)

These set the product apart and align with the Core Value: *surface the strongest, most reliable signal of what prediction markets are moving and why.*

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **"Market-driven news" view** (user's stated vision) | Flip the correlation: instead of "here's news → which markets," show "here are the important markets → what news/direction do they imply." Surfaces *why* a market is moving across finance, politics, tech, and other categories. This is the flagship differentiator. | HIGH | New dashboard view. Requires: category taxonomy on markets, volume/price-movement ranking, and a news→market→direction aggregation. Reuse the existing `redditCategories` taxonomy (finance/crypto/economics/sports/entertainment/technology/politics) as the shared category model. |
| **Correlation alerts with direction** | Not just "a correlation appeared" but "market X is moving up and the news/sentiment is bullish." | MEDIUM | Alert payload = market + direction + top correlated signal/news + confidence. Dedupe by market+signal hash. |
| **TikTok collector** | Novel social signal — TikTok trends are a leading indicator for consumer/culture markets that X/Reddit miss. | HIGH | No public API; TikTok is hostile to scraping. Use discover-page DOM scraping + trend keywords. High fragility — needs defensive selectors + graceful degradation. |
| **Inverted-index correlation speedup** | Collapses the O(n×m) quadratic loop into near-linear candidate filtering. Enables faster alerts + faster market-driven view. | MEDIUM | Hand-rolled `Map`-based keyword→contract index (the zero-shot engine already does this via `findCandidateContracts`). Dependency-free, trivially testable. |
| **Category coverage (finance / politics / tech / other)** | Organize the market-driven news view by category so users can focus. | MEDIUM | Reuse `redditCategories` as a shared category model across markets + news. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Alert on every correlation** | "Notify me of everything." | Alert fatigue → user disables notifications entirely. | Threshold + dedupe + throttle + per-market opt-in (watchlist-scoped default). |
| **Real-time / sub-minute polling** | "I want to catch moves instantly." | MV3 `chrome.alarms` min is 30s; constant polling burns CPU, storage, and rss2json rate limits. | Keep hourly default; add a manual "collect now" button + optional 15-min interval. |
| **TikTok as a core dependency** | "TikTok is a big signal." | TikTok actively blocks scrapers; making it a core dependency means the whole collection cycle breaks when TikTok changes. | Best-effort collector with graceful degradation: fail soft (log + skip), never block other sources. |
| **Full-text scraping of paywalled sources** | "I want the full Seeking Alpha article." | Legal/ToS risk; Seeking Alpha is paywalled. | Use headlines + summaries only (already the model). |
| **Cloud sync / backend / accounts** | "I want my watchlist on all devices." | Violates the hard 100% client-side + no-backend constraint. | Local storage only. Document the tradeoff. |
| **Auto-trading / order execution** | "If the signal is strong, place the trade." | Dangerous, out of scope, legal/regulatory risk. | Keep it a decision aid; export + alerts only. |
| **Push notifications to phone / cross-device** | "Alert me on my phone." | MV3 extensions can't do cross-device push without a backend. | In-browser `chrome.notifications` only. |
| **Over-engineered ML (huge LLMs by default)** | "Bigger model = better." | 1.5 GB downloads + slow WASM CPU inference regress the "fast enough to trust daily" value. | Default to small models; gate large LLMs behind explicit opt-in; surface WebGPU. |

## Feature Dependencies

```
Correlation alerts
    └──requires──> Correlation engine (existing)
    └──requires──> Notification infra (chrome.notifications + alarms + notifications permission)
    └──requires──> Dedupe + throttle (anti-fatigue)
    └──requires──> Direction derivation (sentiment + price delta)
    └──enhances──> Watchlist (alert on watchlisted markets only)

Market-driven news view
    └──requires──> Category taxonomy (reuse redditCategories)
    └──requires──> Volume/price-movement ranking
    └──requires──> News→market→direction aggregation
    └──enhances──> Correlation alerts (alerts point into the view)

TikTok collector
    └──requires──> Collector + manifest permission (tiktok.com already in host_permissions)
    └──requires──> Graceful degradation (TikTok is hostile to scrape)
    └──enhances──> Cross-source correlation

Inverted index speedup
    └──requires──> Nothing new — pure optimization
    └──enables──> Faster correlation → better alerts + market-driven view

Watchlist improvements
    └──enhances──> Correlation alerts (alert on watchlisted markets only)

Export coverage
    └──requires──> New sources (TikTok) + new view data (market-driven news)
```

### Dependency Notes

- **Correlation alerts require dedupe + throttle:** Without it, alerts become spam and get disabled. This is a hard dependency, not a nice-to-have.
- **Correlation alerts require the `notifications` permission:** `chrome.notifications` is the ONLY notification API that works from an MV3 background service worker. Must add `'notifications'` to `manifest.config.ts` permissions.
- **Market-driven news view requires category taxonomy + volume/price ranking:** The view is only as good as the sources feeding it. The category model should be shared (reuse `redditCategories`) so finance/politics/tech are consistent across the app.
- **TikTok requires graceful degradation:** TikTok actively blocks scrapers. The collector must fail soft (log + skip) rather than break the whole collection cycle.
- **Inverted index enables alerts + market-driven view:** Faster correlation means alerts fire promptly and the market-driven view renders quickly. Do the index first.
- **Watchlist improvements enhance alerts:** Alerting on watchlisted markets only is the highest-value, lowest-fatigue alert model.

## MVP Definition

### Launch With (this milestone's core)

- [ ] **Inverted-index correlation speedup** — the "make it faster" ask; enables everything else.
- [ ] **Correlation alerts (deduped + throttled, watchlist-scoped, direction-aware)** — the core "surface what's moving" value.
- [ ] **"Market-driven news" view (v1: finance + politics + tech)** — the flagship differentiator, scoped to 3 categories.
- [ ] **Watchlist improvements (sort/filter/correlation status)** — enhances alerts and daily use.

### Add After Validation (v1.x)

- [ ] **TikTok collector** — high value but high fragility; ship after the core is stable.
- [ ] **Export coverage for new sources** — keep export complete once TikTok + market-driven data exist.
- [ ] **More data sources** — only after per-key storage caps are in place.

### Future Consideration (v2+)

- [ ] **Full category taxonomy (sports, entertainment, crypto, economics)** — expand the market-driven view beyond 3 categories.
- [ ] **WebGPU-accelerated ML** — only when the user opts into large models.
- [ ] **Manual "refresh now" + configurable interval** — nice-to-have control.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Inverted-index correlation speedup | HIGH | MEDIUM | P1 |
| Correlation alerts (deduped, watchlist-scoped, direction) | HIGH | MEDIUM | P1 |
| Market-driven news view (3 categories) | HIGH | HIGH | P1 |
| Watchlist improvements (sort/filter/correlation) | MEDIUM | LOW | P2 |
| TikTok collector | MEDIUM | HIGH | P2 |
| Export coverage for new sources | LOW | LOW | P2 |
| Full category taxonomy | MEDIUM | MEDIUM | P3 |
| WebGPU ML acceleration | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for this milestone (speed + the two flagship features)
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Polymarket | Kalshi | Manifold | Bloomberg/Reuters | Our Approach |
|---------|-----------|--------|----------|-------------------|--------------|
| "What's moving" surfacing | Volume/price lists | Volume/price lists | "Hot" markets | Market movers + news | Volume/price ranking + correlated signals/news |
| News correlation | No (separate news page) | "Kalshi News" (manual) | No | Editorial news + data | **Automated cross-source correlation** |
| Social sentiment | No | No | Comments only | No | **X + Reddit + TikTok sentiment** |
| Alerts | No | No | No | Bloomberg terminal alerts | **Correlation alerts with direction** |
| Watchlist | Yes | Yes | Yes | Yes | Yes (existing) + correlation-aware |
| Privacy / client-side | Server | Server | Server | Server | **100% client-side, no API keys** |
| Category coverage | Markets by category | Markets by category | Markets by category | News by sector | **Market-driven news by category** |

## Sources

- **Competitor products analyzed:** Polymarket, Kalshi, Manifold Markets, Metaculus, Bloomberg Terminal, Reuters, TradingView, Benzinga, Seeking Alpha (feature patterns for "what's moving and why," alerts, watchlists, news feeds).
- **User research:** PROJECT.md requirements + Key Decisions (user explicitly chose: prioritize performance, add correlation alerts, add market-driven news view, add TikTok, add dashboard enhancements).
- **Codebase analysis:** `.planning/codebase/CONCERNS.md` (O(n×m) correlation loops, uncapped news accumulation, empty social content script, TikTok gap, storage budget); `src/services/engine/ml/zeroshot.ts` (existing `findCandidateContracts` inverted-index pattern); `src/dashboard/components/Watchlist.tsx` (current sort-by-addedAt-only); `src/utils/export.ts` (current export coverage); `src/manifest.config.ts` (permissions — `notifications` missing).
- **Industry standards:** MV3 `chrome.alarms`/`chrome.notifications` constraints; prediction-market data (volume/price/odds) as the canonical "what's moving" signal.

---
*Feature research for: TrendCast new milestone (alerts, market-driven news, TikTok, speedup, watchlist)*
*Researched: 2026-08-22*
