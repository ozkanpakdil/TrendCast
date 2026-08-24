# Phase 10: Cross-source consensus alerts - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-24
**Phase:** 10-cross-source-consensus-alerts
**Areas discussed:** Consensus trigger, Alert data model, Topic clustering, Settings & empty-state UX

---

## Consensus trigger

| Option | Description | Selected |
|--------|-------------|----------|
| 3 sources, mix social+news | A topic must appear in ≥3 distinct sources, mixing at least one social + one news source. Strongest signal, fewer alerts. | ✓ |
| 3 sources, any mix | Any ≥3 distinct sources (could be all social or all news). More alerts, simpler rule. | |
| 2 sources | ≥2 distinct sources is enough. Most alerts, weakest consensus. | |

**User's choice:** 3 sources, mix social+news
**Notes:** Consensus requires ≥3 distinct source types AND at least one social + one news source.

| Option | Description | Selected |
|--------|-------------|----------|
| Distinct source types | Count distinct source TYPES (x, reddit, tiktok, bbc, cnn, yahoo, googleFinance, seekingalpha, investing). E.g. 2 X posts + 1 Seeking Alpha = 2 sources. | ✓ |
| Distinct families | Count distinct source FAMILIES (social vs news). | |

**User's choice:** Distinct source types
**Notes:** Multiple posts from the same source type count once.

| Option | Description | Selected |
|--------|-------------|----------|
| Any direction | Alert fires when consensus is reached regardless of sentiment. Direction badge shows the aggregate lean. | ✓ |
| Only clear direction | Only alert when the consensus leans clearly bullish or bearish. | |

**User's choice:** Any direction
**Notes:** No requirement for a clear directional signal.

---

## Alert data model

| Option | Description | Selected |
|--------|-------------|----------|
| Add kind discriminator | Add a `kind: 'watchlist' | 'crossSource'` discriminator to AlertRecord. Watchlist alerts keep contractId; cross-source alerts use a topic id + source breakdown. | ✓ |
| Separate type + history | Create a separate CrossSourceAlertRecord type and store cross-source alerts in their own history array. | |

**User's choice:** Add kind discriminator
**Notes:** One unified AlertRecord + one unified history array.

| Option | Description | Selected |
|--------|-------------|----------|
| Topic + source list | Store the topic label, the list of distinct source types that reached consensus, and the top signal/news text. contractId/platform/question become optional. | ✓ |
| Minimal topic only | Keep it minimal — just a topic label and the top signal/news text. | |

**User's choice:** Topic + source list
**Notes:** Cross-source alerts carry topic label + source breakdown.

---

## Topic clustering

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse newsSocialMatches | Reuse the existing correlateNewsSocial pairs (news↔social) as the seed, then group by shared entities/keywords. | ✓ |
| New clustering pass | New entity-based clustering pass over ALL signals + news. | |

**User's choice:** Reuse newsSocialMatches
**Notes:** Reuse existing `newsSocialMatches` as the seed — no new clustering pass over raw data.

| Option | Description | Selected |
|--------|-------------|----------|
| Group pairs by entities | Group newsSocialMatches by shared entities/keywords into topic clusters. A cluster reaching ≥3 distinct source types fires an alert. | ✓ |
| Each pair = topic | Each newsSocialMatch is its own topic. | |

**User's choice:** Group pairs by entities
**Notes:** Group pairs into topic clusters by shared entities/keywords.

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse cooldown by topic | Reuse the existing global + per-topic cooldown keyed by topic id. | ✓ |
| Global cooldown only | Cross-source alerts use only the global cooldown. | |

**User's choice:** Reuse cooldown by topic
**Notes:** Per-topic throttle using `perMarketCooldownMinutes` + global cooldown.

---

## Settings & empty-state UX

| Option | Description | Selected |
|--------|-------------|----------|
| Separate toggle | Add a separate `crossSourceAlertsEnabled` toggle to ExtensionSettings. | |
| No new setting | Cross-source alerts are always on when alertsEnabled is on. | ✓ |

**User's choice:** No new setting
**Notes:** Cross-source alerts gated by the existing `alertsEnabled` setting.

| Option | Description | Selected |
|--------|-------------|----------|
| Update text for both | Update the empty-state text to mention both watchlist and cross-source alerts. | ✓ |
| Keep current text | Keep the current watchlist-only text unchanged. | |

**User's choice:** Update text for both
**Notes:** Empty-state message updated to mention both alert kinds.

| Option | Description | Selected |
|--------|-------------|----------|
| Distinct cross-source card | Cross-source alert cards show the topic label, a 'Cross-source' badge, and the source breakdown. | ✓ |
| Same card layout | Cross-source alerts render in the same card layout as watchlist alerts. | |

**User's choice:** Distinct cross-source card
**Notes:** Distinct card with topic label + "Cross-source" badge + source breakdown.

---

## the agent's Discretion

- Topic label derivation (how a human-readable topic name is generated from a cluster).
- Exact source-breakdown formatting and badge styling within the existing UI-SPEC color contract.
- Whether `contractId`/`platform`/`question` are made optional vs. topic-derived on `AlertRecord`.

## Deferred Ideas

None — discussion stayed within phase scope.
