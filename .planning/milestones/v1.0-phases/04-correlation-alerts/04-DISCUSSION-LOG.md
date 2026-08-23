# Phase 4: Correlation Alerts - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-22
**Phase:** 4-correlation-alerts
**Areas discussed:** Alert trigger & threshold, Permission fallback UI

---

## Alert Trigger & Threshold

| Option | Description | Selected |
|--------|-------------|----------|
| New/direction-changed only | Alert only when a watchlisted market's correlation is NEW or its direction CHANGED (e.g. sentiment flipped bullish→bearish). Lowest fatigue. | ✓ |
| Threshold-crossing + dedupe | Alert whenever a watchlisted market crosses the confidence threshold, deduped within cooldown. | |
| Escalation-aware | Alert on threshold-crossing AND re-alert when confidence rises meaningfully or direction flips. | |

**User's choice:** New/direction-changed only
**Notes:** Anti-fatigue is the top priority.

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse MIN_CONFIDENCE | Reuse existing 0.75/0.35 threshold; no new setting. | |
| New stricter setting | Dedicated alertThreshold (default ~0.8) in settings. | |
| No threshold (any new match) | Alert on any new/direction-changed correlation for a watchlisted market, relying on dedupe+cooldown. | ✓ |

**User's choice:** No threshold (any new match)
**Notes:** Fatigue controlled by dedupe + cooldown, not a threshold.

| Option | Description | Selected |
|--------|-------------|----------|
| New = unseen contract+signal pair | Precise per-pair dedup; alerted-pair set grows (needs pruning). | |
| New = market not alerted in cooldown | Coarser — one alert per market per cooldown. | |
| Market-level direction flip | Alert when the contract's overall direction flips or a brand-new signal appears. | ✓ |

**User's choice:** Market-level direction flip
**Notes:** Market-level view rather than per-signal.

| Option | Description | Selected |
|--------|-------------|----------|
| Weighted sentiment mean | Average sentiment of correlated signals, weighted. | |
| Sentiment + Yes-price delta | Combine signal sentiment with Yes-price delta vs prior snapshot. | ✓ |
| Top signal only | Use single highest-confidence signal's sentiment. | |

**User's choice:** Sentiment + Yes-price delta
**Notes:** Bullish = positive sentiment AND rising Yes price; bearish = inverse; mixed otherwise.

| Option | Description | Selected |
|--------|-------------|----------|
| Store prior yesPrice in alertState | Self-contained; no dependency on history. | ✓ |
| Reuse existing history | Couples alert engine to history retention. | |

**User's choice:** Store prior yesPrice in alertState

| Option | Description | Selected |
|--------|-------------|----------|
| Any sign change | Sensitive; catches every flip, may alert on noise. | |
| Cross a meaningful band | Only alert when direction flips across a band (sentiment ±0.2, yesPrice >2pts). | ✓ |
| Sign change OR magnitude jump | Catches strengthening trends too. | |

**User's choice:** Cross a meaningful band
**Notes:** Filters out minor wobbles and noise.

---

## Permission Fallback UI

| Option | Description | Selected |
|--------|-------------|----------|
| Badge count + dashboard panel | Toolbar badge + alerts panel in watchlist tab. | ✓ |
| Dashboard panel only | No toolbar badge. | |
| Toolbar badge only | Minimal; user must open dashboard for details. | |

**User's choice:** Badge count + dashboard panel

| Option | Description | Selected |
|--------|-------------|----------|
| Top of watchlist tab | Alerts section at top of existing watchlist tab. | |
| New Alerts tab | Dedicated tab alongside feed/markets/news/etc. | ✓ |

**User's choice:** New Alerts tab

| Option | Description | Selected |
|--------|-------------|----------|
| Clear on opening Alerts tab | Standard notification pattern. | |
| Time-based auto-clear | Badge shows total alerts in last N hours, auto-clears on timer. | ✓ |

**User's choice:** Time-based auto-clear

| Option | Description | Selected |
|--------|-------------|----------|
| Read-only list | Lists alert history records, nothing else. | |
| List + clear action | Read-only list plus "Clear all" that removes records and resets badge. | ✓ |

**User's choice:** List + clear action

---

## the agent's Discretion

The user selected only the Alert trigger & threshold and Permission fallback UI areas. The following areas were identified but NOT discussed — the agent has discretion, guided by research (FEATURES.md, PITFALLS.md, ARCHITECTURE.md):
- Dedup & throttle policy (stable key, global max + per-market cooldown, MV3 30s floor)
- Alert history cap (~100, `slice(-N)` pattern)
- Settings toggle (`alertsEnabled` + cooldown in ExtensionSettings)
- Notification click handler (open dashboard)
- `iconUrl` (packaged icon, never remote) + `getPermissionLevel()` check

## Deferred Ideas

None — discussion stayed within phase scope.
