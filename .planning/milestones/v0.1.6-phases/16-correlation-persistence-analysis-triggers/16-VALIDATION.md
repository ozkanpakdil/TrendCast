---
phase: 16
slug: correlation-persistence-analysis-triggers
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-29
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.9 (via Bun) |
| **Config file** | `vite.config.ts` (test block) |
| **Quick run command** | `bun run test -- --run tests/unit/correlation-persistence.test.ts` |
| **Full suite command** | `bun run test` |
| **Estimated runtime** | ~10–15 seconds (full suite: 416 tests, 34 files) |

---

## Sampling Rate

- **After every task commit:** Run quick run command (target file's test file)
- **After every plan wave:** Run `bun run test` + `bun run typecheck` + `bun run lint`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task area | Verification | Evidence |
|-----------|--------------|----------|
| `computedAt` on CorrelationResult | Unit test: terminal paths stamp `computedAt` (number, Date.now-based) | `tests/unit/correlation-persistence.test.ts` |
| `persistCorrelationResult` helper | Unit test: error never clobbers non-error; cancel writes error-shaped result; success overwrites stale | same |
| Dashboard no-auto-analyze | Unit test: gate helper returns false when stored non-error analysis exists; true when none/error-only | pure-helper test (no hook infra — no @testing-library) |
| storage.onChanged trigger | Unit test: trigger helper fires on snapshot-key change with `computedAt >= collectedAt` freshness guard | SettingsStorage mock pattern (`tests/unit/ml-run-queue.test.ts:131-139`) |
| Header freshness badge | Source assertion: App.tsx renders `computedAt` + engine from cached result | grep + e2e fixture seed (`tests/e2e/fixtures.ts` already seeds correlations) |
| Full regression | `bun run test` (416+ tests), `bun run typecheck`, `bun run lint`, `bun run build:debug:firefox` | CI-equivalent gates |

---

## Validation Architecture

See `16-RESEARCH.md` § Validation Architecture (line 313) for the full architecture: pure-helper extraction strategy (no hook-test infra exists), SettingsStorage mock convention, and the six terminal write sites that must all be covered.

---

## Manual Verification (post-execution)

1. Reload extension → open dashboard with existing data → cached results render instantly, no auto-run
2. Run collectNow → open dashboard → re-analysis triggered, header shows fresh `computedAt`
3. Force an ML error (offline) → cached good result survives; error shown without clobbering
4. Restart browser → results still present (storage.local persistence)