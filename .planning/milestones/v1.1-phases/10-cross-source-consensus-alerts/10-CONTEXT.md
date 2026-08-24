# Phase 10: Cross-source consensus alerts - Context

**Gathered:** 2026-08-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a new **cross-source consensus alert** kind that surfaces when the same topic gains consensus across multiple distinct sources (e.g., X/Twitter + Reddit + Seeking Alpha) — even when the user is not watching any market. This is a second alert path alongside the existing watchlist-scoped correlation alerts (Phase 4), reusing the shared notification/badge/history infrastructure.

**In scope:** A new `kind: 'crossSource'` alert evaluation path, topic clustering from existing `newsSocialMatches`, a `kind` discriminator on `AlertRecord`, and AlertsTab display + empty-state updates.

**Out of scope:** New data collection, new sources, market-linked cross-source alerts, or any new settings toggle (see D-08).

</domain>

<decisions>
## Implementation Decisions

### Consensus trigger
- **D-01:** Consensus = a topic appearing in **≥3 distinct source types**, mixing **at least one social + one news** source. — **Reversibility:** reversible — threshold is a config constant.
- **D-02:** "Distinct source" counts **distinct source types** (`x`, `reddit`, `tiktok`, `bbc`, `cnn`, `yahoo`, `googleFinance`, `seekingalpha`, `investing`). Multiple posts from the same source type count once. — **Reversibility:** reversible — pure counting rule.
- **D-03:** Cross-source alerts fire on **any direction** (bullish/bearish/mixed). The direction badge shows the aggregate lean; no requirement for a clear directional signal. — **Reversibility:** reversible — filter could be added later.

### Alert data model
- **D-04:** Add a **`kind: 'watchlist' | 'crossSource'`** discriminator to the existing `AlertRecord`. Watchlist alerts keep `contractId`/`platform`/`question`; cross-source alerts use a topic id + source breakdown. One unified history array. — **Reversibility:** costly — touches `AlertRecord`, `AlertsTab`, `dispatchAlerts`, and all alert consumers.
- **D-05:** Cross-source alerts carry the **topic label, the list of distinct source types** that reached consensus, and the top signal/news text. `contractId`/`platform`/`question` become optional (or topic-derived) for cross-source records. — **Reversibility:** reversible — additive fields.

### Topic clustering
- **D-06:** **Reuse the existing `correlateNewsSocial` output (`newsSocialMatches`)** as the seed for topic detection — no new clustering pass over raw signals/news. — **Reversibility:** costly — a broader clustering pass would be a larger rewrite.
- **D-07:** Group `newsSocialMatches` **by shared entities/keywords into topic clusters**. A cluster reaching ≥3 distinct source types (mixing social+news) fires an alert. — **Reversibility:** reversible — grouping rule is local.
- **D-08:** Cross-source alerts **reuse the existing cooldown mechanism keyed by topic id** (per-topic throttle using `perMarketCooldownMinutes`), plus the global cooldown. No new settings toggle — cross-source alerts are always on when `alertsEnabled` is on. — **Reversibility:** reversible — cooldown keying is internal.

### Settings & empty-state UX
- **D-09:** **No new settings toggle.** Cross-source alerts are gated by the existing `alertsEnabled` setting. — **Reversibility:** reversible — a toggle could be added later.
- **D-10:** Update the AlertsTab **empty-state message** to mention both watchlist and cross-source alerts (e.g., "Alerts appear here when a watchlisted market moves, or when a topic gains consensus across multiple sources."). — **Reversibility:** reversible — copy change.
- **D-11:** Cross-source alert cards render as a **distinct card** showing the topic label, a "Cross-source" badge, and the source breakdown (e.g., "X · Reddit · Seeking Alpha"). Watchlist cards stay as-is. — **Reversibility:** reversible — presentational.

### the agent's Discretion
- Topic label derivation (how a human-readable topic name is generated from a cluster) — agent picks a sensible approach (e.g., most frequent entity/keyword).
- Exact source-breakdown formatting and badge styling within the existing UI-SPEC color contract.
- Whether `contractId`/`platform`/`question` are made optional vs. topic-derived on `AlertRecord` — agent picks the least invasive option.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Alert engine (Phase 4)
- `src/background/alerts.ts` — The watchlist-scoped alert engine. `evaluateAlerts()` early-returns `[]` when the watchlist is empty (the key constraint this phase addresses). Contains `deriveDirection`, `dispatchAlerts`, `broadcastAlerts`, `updateBadge`, `clearAlerts`, `getAlertHistory`.
- `src/types/index.ts` §Alerts — `AlertRecord` (lines ~407-428), `AlertState`, `AlertDirection`. The `kind` discriminator (D-04) is added here.

### Correlation engine (Phase 3)
- `src/services/engine/correlation.ts` §`correlateNewsSocial` — Produces `newsSocialMatches` (news↔social pairs) via entity + keyword similarity. The seed for topic clustering (D-06/D-07).
- `src/types/index.ts` §`NewsSocialCorrelationMatch` — The pair type (news + signal + confidence + matchedKeywords).

### Config
- `src/config/index.ts` §`CONFIG.alerts` — `historyCap`, `globalCooldownMinutes`, `perMarketCooldownMinutes`, `sentimentBand`, `yesPriceBand`, `badgeWindowHours`. New consensus threshold constants (D-01) belong here.

### Settings
- `src/types/index.ts` §`ExtensionSettings` — `alertsEnabled`, `alertCooldownMinutes`. No new setting (D-09).

### UI
- `src/dashboard/components/AlertsTab.tsx` — Read-only alert list. Empty-state message (D-10) and card rendering (D-11) change here.
- `src/dashboard/hooks/useAlerts.ts` — Loads alert history + listens for `ALERTS_UPDATED`.

### Background orchestration
- `src/background/index.ts` §`runAlertSweep` — Calls `evaluateAlerts(result, watchlist, settings)` then `dispatchAlerts`/`broadcastAlerts`/`updateBadge`. The cross-source path hooks in here.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `correlateNewsSocial()` / `newsSocialMatches`: Already computes news↔social pairs with confidence + matchedKeywords — the seed for topic clustering (D-06).
- `deriveDirection()`: Reusable for computing the aggregate direction of a cross-source topic.
- `dispatchAlerts()` / `broadcastAlerts()` / `updateBadge()` / `clearAlerts()`: Shared notification/badge/history infrastructure — cross-source alerts reuse these unchanged.
- `EntityCache` / `extractEntities` / `extractEntityKeywords` (`src/utils/entities.ts`): Entity extraction for grouping pairs into topic clusters (D-07).
- `CONFIG.alerts` cooldown constants: Reused for per-topic throttling (D-08).

### Established Patterns
- **Storage as source of truth:** Alert state + history persist in `chrome.storage.local` (`CONFIG.storage.alertState`, `alertHistory`); the UI reads storage and subscribes to `ALERTS_UPDATED`.
- **Discriminated unions:** `Message` union in `src/types/index.ts`; the `kind` discriminator on `AlertRecord` (D-04) follows this pattern.
- **Pure, storage-backed engine:** `evaluateAlerts` is pure + storage-backed; the cross-source path should mirror this (no module-level state, MV3 worker-safe).
- **Anti-fatigue (D-01 Phase 4):** Alert only on NEW or changed signals — cross-source alerts should avoid re-alerting the same topic (D-08 cooldown).

### Integration Points
- `src/background/index.ts` §`runAlertSweep` — where the cross-source evaluation path is invoked alongside `evaluateAlerts`.
- `src/background/alerts.ts` — where the new `evaluateCrossSourceAlerts` (or similar) lives and where `AlertRecord` construction happens.
- `src/dashboard/components/AlertsTab.tsx` — where the `kind`-aware card rendering + empty-state text live.
- `src/types/index.ts` — where `AlertRecord` gains the `kind` discriminator and cross-source fields.

</code_context>

<specifics>
## Specific Ideas

The user's original framing: "what if I am not watching anything, can't we find something important from different sources? like same area mentioned in twitter and then in reddit and then seeking alpha, that could be a nice alert isn't it?"

This is the core motivation: **surface important topics even with an empty watchlist**, by detecting when the same topic appears across multiple distinct sources.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 10-cross-source-consensus-alerts*
*Context gathered: 2026-08-24*
