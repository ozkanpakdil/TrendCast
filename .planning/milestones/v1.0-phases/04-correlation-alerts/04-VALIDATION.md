---
phase: 4
slug: correlation-alerts
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-23
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` (project root) |
| **Quick run command** | `bun run test` |
| **Full suite command** | `bun run test:all` |
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
| 4-01-01 | 01 | 1 | ALERT-01, ALERT-02 | T-4-02 / T-4-06 | N/A | unit | `bun run test tests/unit/alerts.test.ts tests/unit/alert-direction.test.ts` | ❌ W0 | ⬜ pending |
| 4-01-02 | 01 | 1 | ALERT-01 | T-4-02 / — | N/A | unit | `bun run test tests/unit/alerts.test.ts` | ❌ W0 | ⬜ pending |
| 4-02-01 | 02 | 2 | ALERT-01 | T-4-SC / — | N/A | unit | `bun run test tests/unit/alerts.test.ts` | ❌ W0 | ⬜ pending |
| 4-02-02 | 02 | 2 | ALERT-01 | T-4-SC / — | N/A | unit | `bun run test tests/unit/alerts.test.ts` | ❌ W0 | ⬜ pending |
| 4-03-01 | 03 | 3 | ALERT-02 | T-4-07 / T-4-08 | N/A | unit | `bun run test` | ❌ W0 | ⬜ pending |
| 4-03-02 | 03 | 3 | ALERT-02 | T-4-07 / — | N/A | unit | `bun run test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/alerts.test.ts` — stubs for ALERT-01 (dedup/throttle/direction/history-cap)
- [ ] `tests/unit/alert-direction.test.ts` — stubs for ALERT-02 (direction derivation + band thresholds)
- [ ] `tests/unit/fixtures.ts` — shared alert fixtures (synthetic `CorrelationResult` + `alertState`)

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `chrome.notifications.create()` + `getPermissionLevel()` | ALERT-01 | Requires a real extension context; browser API | Load the built extension in Chrome AND Firefox; verify a notification appears for a watchlisted market and falls back to the badge when permission is denied |
| `chrome.alarms` alert-sweep survival across worker restarts | ALERT-01 | Requires a live MV3 service worker | Trigger a correlation, kill the worker, verify the alert still fires on the next alarm sweep |
| Badge fallback (`chrome.action.setBadgeText`) + time-based auto-clear | ALERT-01 | Requires a real toolbar | Deny notification permission; verify the badge shows the alert count and auto-clears on the timer |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** {pending / approved YYYY-MM-DD}
