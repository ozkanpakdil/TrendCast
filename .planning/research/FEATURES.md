# Feature Research

**Domain:** Prediction-market / market-intelligence browser extension (correlating social sentiment, news, and market odds)
**Researched:** 2026-08-22
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete. For a market-intelligence tool, the #1 table stake is **data reliability** — a correlation tool that silently drops sources (the current Seeking Alpha / Investing.com bug) is broken, not "missing a feature."

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Reliable data sources** (fix Seeking Alpha / Investing) | A correlation tool is worthless if sources silently fail. Users trust the feed as a daily decision aid. | MEDIUM | Root cause is likely Google News RSS `site:` queries returning few items (paywalled/poorly indexed) + correlation threshold filtering + display truncation. Fix at the source, not by force-displaying. |
| **Source health / staleness indicators** | Users need to know when a source is down or stale so they don't act on incomplete data. | LOW | Show per-source "last updated" + error state in the dashboard. Directly addresses the "why is Seeking Alpha missing" confusion. |
| **Watchlist** (star markets, persist, view) | Core expectation for any market tool — track the markets you care about. | LOW | Already exists (`Watchlist.tsx`). Improvements = sort/filter, show correlation status inline, dedupe. |
| **"What's moving" surfacing** | Users expect to see which markets are moving (by volume / price change) and why. | MEDIUM | Polymarket/Kalshi already expose volume/price. Rank markets by 24h volume + price delta; pair with top correlated signals/news. |
| **Data export** | Users expect to take their data out (CSV/JSON). | LOW | Already exists (`export.ts`). Verify it covers all new sources (TikTok, new outlets) once added. |
| **Correlation alerts / notifications** | The core value is "surface strong signals fast." A user who must open the dashboard to see a strong correlation will miss it. | MEDIUM | MV3 `chrome.notifications` + `chrome.alarms`. Must dedupe + throttle to avoid alert fatigue. See Differentiators for the "why" framing. |
| **Freshness / last-updated timestamps** | Users need to know data is current. | LOW | Show per-source and per-market "updated X ago." Cheap, high trust value. |

### Differentiators (Competitive Advantage)

These set the product apart and align with the Core Value: *surface the strongest, most reliable signal of what prediction markets are moving and why.*

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **"Market-driven news" view** (user's stated vision) | Flip the correlation: instead of "here's news → which markets," show "here are the important markets → what news/direction do they imply." Surfaces *why* a market is moving across finance, politics, tech, and other categories. | HIGH | New dashboard view. Requires: category taxonomy on markets, volume/price-movement ranking, and a news→market→direction aggregation. This is the flagship differentiator. |
| **Cross-source correlation (social + news + odds)** | The core value — no other mainstream tool correlates X/Reddit/TikTok sentiment with Polymarket/Kalshi odds. | MEDIUM | Already exists. Differentiator is *reliability + speed* (inverted index) + *coverage* (TikTok, more sources). |
| **TikTok collector** | Novel social signal — TikTok trends are a leading indicator for consumer/culture markets that X/Reddit miss. | HIGH | No public API; TikTok is hostile to scraping. Use discover-page DOM scraping + trend keywords. High fragility — needs defensive selectors + graceful degradation. |
| **Correlation alerts with direction** | Not just "a correlation appeared" but "market X is moving up and the news/sentiment is bullish." | MEDIUM | Alert payload = market + direction (bullish/bearish) + top correlated signal/news + confidence. Dedupe by market+signal hash. |
| **Category coverage (finance / politics / tech / other)** | Organize the market-driven news view by category so users can focus. | MEDIUM | Reuse the existing Reddit category taxonomy (`redditCategories` in config) as a shared category model across markets + news. |
| **Client-side ML (privacy)** | All correlation runs in-browser, no data leaves the machine. | MEDIUM | Already exists. Differentiator = privacy + no API keys. Keep as a selling point; gate large LLM models behind opt-in. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Real-time / sub-minute polling** | "I want to catch moves instantly." | MV3 `chrome.alarms` min is 30s; constant polling burns CPU, storage, and rss2json rate limits. Hourly is fine for daily decision aid. | Keep hourly default; add a manual "collect now" button + optional 15-min interval. |
| **Cloud sync / backend / accounts** | "I want my watchlist on all devices." | Violates the hard 100% client-side + no-backend constraint. Adds infra, API keys, privacy surface. | Local storage only. Document the tradeoff. |
| **Auto-trading / order execution** | "If the signal is strong, place the trade." | Dangerous, out of scope, legal/regulatory risk, and the correlation is a decision aid, not a guarantee. | Keep it a decision aid; export + alerts only. |
| **Paywall bypass / full-text scraping** | "I want the full Seeking Alpha article." | Legal/ToS risk; Seeking Alpha is paywalled. | Use headlines + summaries only (already the model). |
| **Push notifications to phone / cross-device** | "Alert me on my phone." | MV3 extensions can't do cross-device push without a backend. | In-browser `chrome.notifications` only. |
| **Alert on every correlation** | "Notify me of everything." | Alert fatigue → user disables notifications entirely. | Threshold + dedupe + throttle + per-market opt-in. |
| **Build own prediction market** | "We have the data, let's make markets." | Completely out of scope, huge legal/regulatory surface. | Stay a signal tool. |
| **Monetization / ads** | "Make money from the data." | Out of scope (internal tool), and ads degrade trust. | None — keep it a personal tool. |
| **Over-engineered ML (huge LLMs by default)** | "Bigger model = better." | 1.5 GB downloads + slow WASM CPU inference regress the "fast enough to trust daily" value. | Default to small models; gate large LLMs behind explicit opt-in; surface WebGPU. |

## Feature Dependencies

```
Fix Seeking Alpha/Investing (reliability)
    └──requires──> Source health/staleness indicators
                       └──enhances──> Market-driven news view

Market-driven news view
    └──requires──> Reliable sources (fix SA/Investing)
    └──requires──> Category taxonomy (reuse Reddit categories)
    └──requires──> Volume/price-movement ranking
    └──enhances──> Correlation alerts (alerts point into the view)

Correlation alerts
    └──requires──> Correlation engine (existing)
    └──requires──> Notification infra (chrome.notifications + alarms)
    └──requires──> Dedupe + throttle (anti-fatigue)

TikTok collector
    └──requires──> Collector + manifest permission
    └──requires──> Graceful degradation (TikTok is hostile to scrape)
    └──enhances──> Cross-source correlation

More data sources
    └──requires──> Collector + config + manifest permission
    └──requires──> Per-key storage caps (uncapped news is a bottleneck)

Performance (inverted index)
    └──requires──> Nothing new — pure optimization
    └──enables──> Faster correlation → better alerts + market-driven view

Watchlist improvements
    └──enhances──> Correlation alerts (alert on watchlisted markets only)
```

### Dependency Notes

- **Fix Seeking Alpha/Investing requires source-health indicators:** You can't trust a source you can't see the health of. Fix the root cause *and* surface per-source freshness so the user knows when a source is degraded.
- **Market-driven news view requires reliable sources + category taxonomy:** The view is only as good as the sources feeding it. The category model should be shared (reuse `redditCategories`) so finance/politics/tech are consistent across the app.
- **Correlation alerts require dedupe + throttle:** Without it, alerts become spam and get disabled. This is a hard dependency, not a nice-to-have.
- **TikTok requires graceful degradation:** TikTok actively blocks scrapers. The collector must fail soft (log + skip) rather than break the whole collection cycle.
- **More data sources requires per-key storage caps:** The codebase already flags uncapped news accumulation as a bottleneck. Adding sources without caps will blow the 7 MB budget.
- **Watchlist improvements enhance alerts:** Alerting on watchlisted markets only is the highest-value, lowest-fatigue alert model.

## MVP Definition

### Launch With (v1 — this milestone's hardening core)

- [ ] **Fix Seeking Alpha / Investing root cause** — the immediate concern; nothing else matters if sources silently fail.
- [ ] **Source health / staleness indicators** — makes reliability visible and trustworthy.
- [ ] **Correlation speed (inverted index)** — the "make it faster" ask; enables everything else.
- [ ] **Correlation alerts (deduped + throttled, watchlist-scoped)** — the core "surface what's moving" value.
- [ ] **"Market-driven news" view (v1: finance + politics + tech)** — the flagship differentiator, scoped to 3 categories.

### Add After Validation (v1.x)

- [ ] **TikTok collector** — high value but high fragility; ship after the core is stable.
- [ ] **More data sources** — only after per-key storage caps are in place.
- [ ] **Watchlist improvements** (sort/filter/correlation) — enhances alerts.
- [ ] **Export coverage for new sources** — keep export complete.

### Future Consideration (v2+)

- [ ] **Full category taxonomy (sports, entertainment, crypto, economics)** — expand the market-driven view beyond 3 categories.
- [ ] **WebGPU-accelerated ML** — only when the user opts into large models.
- [ ] **Manual "refresh now" + configurable interval** — nice-to-have control.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Fix Seeking Alpha / Investing reliability | HIGH | MEDIUM | P1 |
| Source health / staleness indicators | HIGH | LOW | P1 |
| Correlation speed (inverted index) | HIGH | MEDIUM | P1 |
| Correlation alerts (deduped, watchlist-scoped) | HIGH | MEDIUM | P1 |
| Market-driven news view (3 categories) | HIGH | HIGH | P1 |
| TikTok collector | MEDIUM | HIGH | P2 |
| More data sources | MEDIUM | MEDIUM | P2 |
| Watchlist improvements | MEDIUM | LOW | P2 |
| Export coverage for new sources | LOW | LOW | P2 |
| Full category taxonomy | MEDIUM | MEDIUM | P3 |
| WebGPU ML acceleration | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for this milestone (reliability + speed + the two flagship features)
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
- **User research:** PROJECT.md requirements + Key Decisions (user explicitly chose: diagnose & fix root cause, prioritize performance, add new capabilities including market-driven news view and correlation alerts).
- **Codebase analysis:** `.planning/codebase/CONCERNS.md` (Seeking Alpha/Investing root-cause candidates, uncapped news accumulation, O(n×m) correlation loops, empty social content script, TikTok gap, storage budget).
- **Industry standards:** MV3 `chrome.alarms`/`chrome.notifications` constraints; prediction-market data (volume/price/odds) as the canonical "what's moving" signal.

---
*Feature research for: prediction-market correlation browser extension*
*Researched: 2026-08-22*
