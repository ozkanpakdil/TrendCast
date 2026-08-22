---
phase: 1
slug: data-reliability
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-22
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.0.5 (jsdom, globals) |
| **Config file** | `vite.config.ts` `test` block (no separate vitest.config) |
| **Quick run command** | `bun run test` |
| **Full suite command** | `bun run test:all` (lint + typecheck + unit + e2e) |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun run test`
- **After every plan wave:** Run `bun run test:all`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | REL-01 | T-1-01 / — | Source string validated against `NewsSource` union before health-map key | unit | `bun run test` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | REL-01 | — | Correlation threshold does not silently drop all SA/Investing items | unit | `bun run test` | ❌ W0 | ⬜ pending |
| 1-02-01 | 02 | 1 | REL-02 | T-1-01 / — | Health map records lastFetchedAt/itemCount/consecutiveFailures | unit | `bun run test` | ❌ W0 | ⬜ pending |
| 1-02-02 | 02 | 1 | REL-02 | — | Dashboard renders per-source health indicator | e2e | `bun run test:e2e` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/news-collector.test.ts` — stubs for REL-01 (collector records health)
- [ ] `tests/unit/source-health.test.ts` — stubs for REL-02 (health map computation)
- [ ] `tests/unit/correlation-threshold.test.ts` — stubs for REL-01 (diagnose threshold drop)
- [ ] `tests/e2e/dashboard.spec.ts` — extend to assert health indicator renders

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live feed diagnosis (rss2json.com `site:` queries return items) | REL-01 | External API; not deterministic in CI | Run the collector against live feeds; confirm SA/Investing return `status: ok` with items |
| Visual health indicator rendering in the dashboard | REL-02 | Visual layout; not covered by unit tests | Load the dashboard; confirm per-source badges render with fetched/correlated counts |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
