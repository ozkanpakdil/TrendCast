---
phase: 1
slug: data-reliability
status: secured
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-08-22
---

# Phase 1 — Data Reliability Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| background collector → storage | The collector writes `sourceHealth` into `chrome.storage.local`; the dashboard reads it read-only. | `SourceHealth` map (per-source fetch outcomes) |
| storage → dashboard | `sourceHealth` is read by the dashboard; it must be treated as untrusted data (validated against the `NewsSource` union). | `SourceHealth` map |
| test fixtures → correlateNews / dashboard | Sample headlines/contracts and `MOCK_SNAPSHOT.sourceHealth` are injected into tests; no external input. | Test-only data |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-1-01 | Tampering | `SourceHealth` map keying | high | mitigate | Health-map key typed as `NewsSource` union (`src/types/index.ts:109`); `SourceHealthIndicator` iterates only `SOURCE_ORDER: NewsSource[]` and indexes `health[source]` with a typed key (`SourceHealthIndicator.tsx:36,116`); `computeCorrelatedCounts` groups by typed `m.news.source` (`source-health.ts`). Never indexed with an unvalidated string (ASVS V5). | closed |
| T-1-02 | Tampering | `sourceHealth` in storage | low | accept | Health is written only by the background collector; the dashboard reads it read-only. No user-writable path exists. | closed |
| T-1-03 | Tampering | `correlation-threshold.test.ts` | low | accept | Test-only file; no production code path. Thresholds unchanged (D-01). | closed |
| T-1-04 | Tampering | `SourceHealthIndicator` rendering | low | accept | Read-only projection; no user-writable path. Health-map keys validated against `NewsSource` union. | closed |
| T-1-05 | Tampering | `MOCK_SNAPSHOT.sourceHealth` | low | accept | Test-only fixture; no production code path. | closed |
| T-1-SC | Tampering | npm/pip/cargo installs | low | accept | No new packages installed in this phase. No legitimacy gate required. | closed |

*Status: open · closed · open — below {block_on} threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-1-02 | T-1-02 | `sourceHealth` written only by background collector; dashboard read-only; no user-writable path | Phase 1 | 2026-08-22 |
| AR-1-03 | T-1-03 | Test-only file; no production code path | Phase 1 | 2026-08-22 |
| AR-1-04 | T-1-04 | Read-only projection; keys validated against `NewsSource` union | Phase 1 | 2026-08-22 |
| AR-1-05 | T-1-05 | Test-only fixture; no production code path | Phase 1 | 2026-08-22 |
| AR-1-SC | T-1-SC | No new packages installed in this phase | Phase 1 | 2026-08-22 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-08-22 | 6 | 6 | 0 | the agent (gsd-security-auditor) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
