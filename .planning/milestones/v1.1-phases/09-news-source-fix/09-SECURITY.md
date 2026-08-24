---
phase: 09
slug: news-source-fix
status: verified
threats_open: 0
asvs_level: 1
created: 2026-08-24
---

# Phase 9 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| chrome.storage.local → settings load | Stored settings (untrusted, possibly stale/corrupted) cross into the settings merge. This phase only reads and merges; it introduces no new write path. | settings object (low sensitivity) |
| chrome.storage.local → migration write | The migration reads stored settings and writes a backfilled copy. It introduces a new write path to the settings key. | settings object (low sensitivity) |
| test fixtures → helper under test | Test inputs are developer-authored; no untrusted boundary. | test data |
| collector → health entry | `collectNews` writes `lastUnchanged` from the fetch outcome; no untrusted input crosses a boundary. | health entry |
| health entry → computeHealth | `computeHealth` is a pure projection over persisted data; no untrusted input. | health entry |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-09-01 | Tampering | chrome.storage.local settings | low | accept | chrome.storage.local is extension-scoped and not writable by web content; the deep-merge only reads stored values and merges with defaults. No new trust boundary or write surface is introduced. | closed |
| T-09-02 | Tampering | `deepMergeSettings` enabledSources spread | low | mitigate | Non-object `stored.enabledSources` (corruption) falls back to `defaults.enabledSources` instead of spreading junk keys (`src/utils/settings.ts:40-43`). | closed |
| T-09-03 | Tampering | migration write to settings key | low | mitigate | Migration only writes keys that already exist in `stored` plus missing source flags from `DEFAULT_SETTINGS`; never deletes or overwrites a present key. Pure helper returns `null` when nothing changed, so no redundant write occurs (`src/utils/settings.ts:66-72`). | closed |
| T-09-04 | Tampering | non-object `stored.enabledSources` | low | mitigate | `migrateEnabledSources` returns `null` for a non-object `enabledSources`, so corrupted data is never written back (`src/utils/settings.ts:60-63`). | closed |
| T-09-05 | Tampering | test fixtures | low | accept | Tests are developer-authored and run in a sandboxed Vitest environment; no untrusted input crosses a boundary. | closed |
| T-09-06 | Spoofing | `lastUnchanged` flag | low | accept | The flag is set only by `collectNews` from the actual 304 outcome; no user-controlled input can set it. | closed |
| T-09-07 | Tampering | persisted health entry | low | accept | `lastUnchanged` is optional and read defensively (`!entry.lastUnchanged`); a missing/undefined value degrades to the existing behavior. | closed |
| T-09-SC | Tampering | npm/pip/cargo installs | high | mitigate | No new packages are installed in this phase; the package-legitimacy gate is not triggered. | closed |

*Status: open · closed · open — below {block_on} threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-09-01 | T-09-01 | chrome.storage.local is extension-scoped and not writable by web content; deep-merge only reads stored values. | agent | 2026-08-24 |
| AR-09-02 | T-09-05 | Tests are developer-authored and run in a sandboxed Vitest environment. | agent | 2026-08-24 |
| AR-09-03 | T-09-06 | `lastUnchanged` set only by `collectNews` from the actual 304 outcome; no user-controlled input. | agent | 2026-08-24 |
| AR-09-04 | T-09-07 | `lastUnchanged` read defensively; missing value degrades to existing behavior. | agent | 2026-08-24 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-08-24 | 8 | 8 | 0 | agent |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-08-24
