---
phase: 10
slug: cross-source-consensus-alerts
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-24
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.x |
| **Config file** | vite.config.ts (test block) |
| **Quick run command** | `bun run test -- tests/unit/cross-source-alerts.test.ts` |
| **Full suite command** | `bun run test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun run test -- tests/unit/cross-source-alerts.test.ts`
- **After every plan wave:** Run `bun run test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | PHASE-10 | T-10-01 / T-10-02 | Source-type validation + safe notification title | unit | `bun run test -- tests/unit/cross-source-alerts.test.ts` | ✅ | ✅ green |
| 10-01-02 | 01 | 1 | PHASE-10 | T-10-03 | Per-topic cooldown prevents re-alert spam | unit | `bun run test -- tests/unit/cross-source-alerts.test.ts` | ✅ | ✅ green |
| 10-02-01 | 02 | 1 | PHASE-10 | T-10-04 / T-10-05 | Source-type validation + cooldown edge cases | unit | `bun run test -- tests/unit/cross-source-alerts.test.ts` | ✅ | ✅ green |
| 10-03-01 | 03 | 1 | PHASE-10 | T-10-06 / T-10-07 | Display-only strings + optional-field consumers | unit | `bun run test -- tests/unit/cross-source-alerts.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — no Wave 0 stubs needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cross-source alert card visual rendering (topic label title, indigo "Cross-source" badge, source breakdown, source links) | PHASE-10 | Visual appearance requires human confirmation; no component test exercises the rendered output | Open dashboard Alerts tab, confirm a crossSource alert renders with topicLabel title, "Cross-source" badge, sourceTypes joined with " · ", and clickable Source/Social links — **confirmed pass in UAT Test 1** |
| Watchlist alert card rendering unchanged (question as title) | PHASE-10 | Visual regression requires manual confirmation | Open dashboard Alerts tab, confirm a watchlist alert renders alert.question as title with no cross-source styling — **confirmed pass in UAT Test 2** |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-08-24
