---
phase: 10
slug: cross-source-consensus-alerts
status: verified
threats_open: 0
asvs_level: 1
created: 2026-08-24
---

# Phase 10 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| stored correlation result -> alert engine | `result.newsSocialMatches` is read from `chrome.storage.local`; source-type strings are validated against the typed unions before counting. | non-sensitive source-type identifiers (x/reddit/bbc/etc.) |
| alert history -> AlertsTab | `AlertRecord` fields rendered in the UI; `topicLabel`/`sourceTypes` are display-only strings. | non-sensitive public identifiers |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-10-01 | Tampering | `evaluateCrossSourceAlerts` source-type counting | medium | mitigate | `SOCIAL_PLATFORMS.has(platform)` / `NEWS_SOURCES.has(source)` gates before counting; unknown values ignored (ASVS V5 input validation) | closed |
| T-10-02 | Spoofing | `dispatchAlerts` notification title | low | mitigate | Title falls back `question ?? topicLabel ?? 'Cross-source alert'` so crossSource notifications never show "undefined" | closed |
| T-10-03 | DoS | per-topic cooldown keyed by `topicId` | low | mitigate | Reuses `state.lastNotified[topicId]` + `perMarketCooldownMinutes` so a hot topic cannot re-alert within the cooldown window (D-08) | closed |
| T-10-04 | Tampering | source-type validation in `evaluateCrossSourceAlerts` | medium | mitigate | Reject unknown `platform`/`source` values before counting (ASVS V5 input validation) | closed |
| T-10-05 | DoS | per-topic cooldown | low | mitigate | Cooldown keyed by `topicId` prevents hot-topic re-alert spam (D-08) | closed |
| T-10-06 | Information Disclosure | AlertsTab rendering of `sourceTypes` | low | accept | Source-type names are non-sensitive public identifiers (x/reddit/bbc/etc.); no user data exposed | closed |
| T-10-07 | Tampering | `AlertRecord` optional-field consumers | medium | mitigate | Fix any consumer type error from the optional `contractId`/`question` change rather than reverting the type (D-05) | closed |
| T-10-SC | Tampering | npm/pip/cargo installs | high | mitigate | No new packages introduced in this phase; existing devDependencies only | closed |

*Status: open · closed · open — below {block_on} threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-10-01 | T-10-06 | Source-type names (x/reddit/bbc/etc.) are non-sensitive public identifiers; no user data exposed | Phase 10 planning | 2026-08-24 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-08-24 | 8 | 8 | 0 | gsd-secure-phase (orchestrator) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-08-24
