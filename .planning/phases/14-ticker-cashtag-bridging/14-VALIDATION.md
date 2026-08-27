---
phase: 14
slug: ticker-cashtag-bridging
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-27
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.0.5 |
| **Config file** | `vite.config.ts` (test block) |
| **Quick run command** | `bun run test -- --run` |
| **Full suite command** | `bun run test` |
| **Estimated runtime** | ~30 seconds (360 tests baseline, all green) |

---

## Sampling Rate

- **After every task commit:** Run `bun run test -- --run`
- **After every plan wave:** Run `bun run test` (full suite incl. equivalence)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 14-01 Task 1 (tracer: bare cashtag emission + strip-$ bridge) | 14-01 | 1 | CORR-02 | T-14-03 | N/A | unit + fixtures | `bun run test` | ✅ | ⬜ pending |
| 14-01 Task 2 (entity unification + bare-caps gates + boost rework) | 14-01 | 1 | CORR-01 | T-14-01, T-14-02 | No feed-derived pattern sources (ReDoS gate) | unit + equivalence + golden gates | `bun run test` | ✅ | ⬜ pending |
| 14-02 Task 1 (stock-indicator keyword curation) | 14-02 | 2 | CORR-03 | T-14-05 | Symbol-bounded keyword emission | unit | `bun run test` | ✅ | ⬜ pending |
| 14-02 Task 2 (computeBridgingCoverage + tooltip display) | 14-02 | 2 | CORR-04 | T-14-04, T-14-06 | Pure projection, no storage growth | unit | `bun run test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Extend `tests/unit/correlation-equivalence.test.ts` oracles with bridged-match fixtures ($AMZN ↔ amzn ↔ Amazon)
- [ ] Add bare-caps ticker recognition tests (KNOWN_TICKERS match, STOP_WORDS/English-word exclusion, `V`/`ALL`/`ON` never match)
- [ ] Add screener noise-token exclusion tests (`vcp`, `2026`, `breakout` absent from indicator keywords)

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live stock-indicator item correlates with live social signal in dashboard | CORR-01 | Requires live RSS + social fetch | Open dashboard after collection; check Correlations tab for a bridged match |
| Source health bridging coverage renders correctly | CORR-04 | Visual rendering check | Open source health indicators; verify canonical-ticker hit rate displays |

*All other phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending