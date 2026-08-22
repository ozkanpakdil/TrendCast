---
phase: 2
slug: ui-responsiveness
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-22
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (unit) + Playwright (e2e) |
| **Config file** | `vitest.config.ts` / `playwright.config.ts` |
| **Quick run command** | `bun run test:unit` |
| **Full suite command** | `bun run test` (unit + e2e) |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun run test:unit`
- **After every plan wave:** Run `bun run test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | PERF-01 | — | N/A | unit | `bun run test:unit` | ✅ | ⬜ pending |
| 02-01-02 | 01 | 1 | PERF-01 | — | N/A | e2e | `bun run test:e2e` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/` — existing Vitest infra covers unit tests
- [ ] `tests/e2e/` — existing Playwright infra covers e2e tests

*Existing infrastructure covers all phase requirements.*

---

## Manual-Only Verifications

- Visual scroll smoothness of virtualized feeds (subjective jank check) — covered by e2e DOM-node-count assertion as proxy.
