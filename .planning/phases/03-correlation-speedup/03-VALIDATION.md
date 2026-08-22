---
phase: 3
slug: correlation-speedup
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-22
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.9 |
| **Config file** | none — inline in `vite.config.ts` under `test: { globals: true, environment: 'jsdom', exclude: [...] }` |
| **Quick run command** | `bun run test -- tests/unit/index.test.ts` |
| **Full suite command** | `bun run test:all` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun run test -- tests/unit/index.test.ts` (index unit tests)
- **After every plan wave:** Run `bun run test` (all unit tests)
- **Before `/gsd-verify-work`:** Full suite (`bun run test:all`) must be green
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | PERF-02 | T-3-01 / — | Index built from normalized `extractKeywords`; keyword array length capped | unit | `bun run test -- tests/unit/index.test.ts` | ❌ W0 | ⬜ pending |
| 3-01-02 | 01 | 1 | PERF-02 | T-3-01 / — | Candidate set is superset of naive matches | unit | `bun run test -- tests/unit/index.test.ts` | ❌ W0 | ⬜ pending |
| 3-01-03 | 01 | 1 | PERF-02 | — | Tiny-input fallback to naive loop | unit | `bun run test -- tests/unit/index.test.ts` | ❌ W0 | ⬜ pending |
| 3-02-01 | 02 | 1 | PERF-02 | — | Heuristic indexed path == naive loop (same matches, confidence, order) | unit (equivalence) | `bun run test -- tests/unit/correlation-equivalence.test.ts` | ❌ W0 | ⬜ pending |
| 3-02-02 | 02 | 1 | PERF-02 | — | Edge cases (empty keywords, single contract/signal, dup keywords, cashtag/hashtag-only, tiny-input fallback) | unit | `bun run test -- tests/unit/correlation-equivalence.test.ts` | ❌ W0 | ⬜ pending |
| 3-03-01 | 03 | 2 | PERF-02 | — | Zeroshot indexed path == naive loop | unit (equivalence) | `bun run test -- tests/unit/zeroshot-equivalence.test.ts` | ❌ W0 | ⬜ pending |
| 3-03-02 | 03 | 2 | PERF-02 | — | Embedding indexed path == naive loop | unit (equivalence) | `bun run test -- tests/unit/embedding-equivalence.test.ts` | ❌ W0 | ⬜ pending |
| 3-03-03 | 03 | 2 | PERF-02 | — | Sentiment indexed path == naive loop | unit (equivalence) | `bun run test -- tests/unit/sentiment-equivalence.test.ts` | ❌ W0 | ⬜ pending |
| 3-03-04 | 03 | 2 | PERF-02 | — | NER indexed path == naive loop | unit (equivalence) | `bun run test -- tests/unit/ner-equivalence.test.ts` | ❌ W0 | ⬜ pending |
| 3-03-05 | 03 | 2 | PERF-02 | — | LLM indexed path == naive loop | unit (equivalence) | `bun run test -- tests/unit/llm-equivalence.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/index.test.ts` — inverted index build/candidates/fallback unit tests
- [ ] `tests/unit/correlation-equivalence.test.ts` — heuristic equivalence (reuse fixtures from `tests/unit/correlation.test.ts`)
- [ ] `tests/unit/zeroshot-equivalence.test.ts` — zeroshot equivalence
- [ ] `tests/unit/embedding-equivalence.test.ts` — embedding equivalence
- [ ] `tests/unit/sentiment-equivalence.test.ts` — sentiment equivalence
- [ ] `tests/unit/ner-equivalence.test.ts` — NER equivalence
- [ ] `tests/unit/llm-equivalence.test.ts` — LLM equivalence
- [ ] `tests/unit/fixtures.ts` — shared contracts/signals/news fixtures used by all equivalence tests

*Existing infrastructure (Vitest, `tests/unit/correlation.test.ts`, `tests/unit/correlation-threshold.test.ts`) covers the framework; only the new equivalence/index test files are Wave 0 gaps.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end latency improvement in the running extension | PERF-02 | Latency is a runtime UX property; automated tests assert equivalence, not wall-clock speed | Load the built extension, open the dashboard with a populated snapshot, and confirm correlation results render without perceptible delay vs. the previous build |

*All other phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
