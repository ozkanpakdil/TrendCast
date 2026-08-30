---
phase: 16
plan: 01
subsystem: correlation-persistence
tags: [correlations, persistence, write-policy, dashboard, freshness]
requires:
  - SettingsStorage interface (src/utils/settings.ts)
  - CONFIG.storage.correlations key (src/config/index.ts)
  - CorrelationResult type (src/types/index.ts)
provides:
  - src/utils/correlation-persistence.ts (stampCorrelationResult, persistCorrelationResult, hasFreshAnalysis, readStoredAnalysis)
  - CorrelationResult.computedAt / model / inputCounts optional fields
  - useCorrelations loaded flag
  - App.tsx correlations header freshness badge
affects:
  - 16-02 (TRIG-03 post-collection triggers depend on computedAt metadata and this helper module)
tech-stack:
  added: []
  patterns:
    - read-modify-write with error-vs-good + newer-computedAt clobber protection
    - corrupt-tolerant storage reads (try/catch → null)
    - once-per-session auto-run gate via ref + loaded flag
key-files:
  created:
    - src/utils/correlation-persistence.ts
    - tests/unit/correlation-persistence.test.ts
  modified:
    - src/types/index.ts
    - src/background/index.ts
    - src/dashboard/hooks/useCorrelations.ts
    - src/dashboard/App.tsx
    - tests/e2e/fixtures.ts
    - tests/e2e/dashboard.spec.ts
decisions:
  - "Write policy: success overwrites anything unless a non-error with strictly newer computedAt exists; error overwrites only absent/corrupt/error; error never displaces a non-error — broadcast still fires at call site."
  - "Auto-run gate: loaded && snapshot-has-data && !hasFreshAnalysis(correlations), evaluated once per session via corrInitRef; ref set before the freshness check so a mid-session manual failure cannot re-trigger."
  - "Freshness badge reads computedAt/engine/model directly off the stored result; legacy results without computedAt show 'unknown age'; results older than lastCollectionAt show '⚠ stale'."
metrics:
  duration: ~2.5h (across 12 context windows; e2e observation blocked ~40min by a hung background terminal)
  completed: 2026-08-29
status: complete
actuals:
  tokens: ~96000
  tasks: 3
  commits: 0
---

# Phase 16 Plan 01: Correlation Persistence & Cached-First Dashboard Summary

Correlation results are now durable with freshness metadata and a clobber-proof write policy: every terminal background path persists a stamped result, errors never destroy good cached results, the dashboard opens on the cache without auto-analyzing, and the header shows how fresh the results are.

## Objective

TRIG-01 (metadata + write policy on every terminal path), TRIG-02 (no auto-analyze on open; auto-run only when no stored non-error analysis exists), and TRIG-04 (visible computedAt + engine). TRIG-03 (post-collection triggers) is 16-02 and was NOT implemented here.

## What Was Built

### Task 1 (tracer): helper module + success-path persistence + cached-first dashboard

- **`src/utils/correlation-persistence.ts` (NEW)** — module docstring tagged "Phase 16, TRIG-01" with the full decision table. Exports:
  - `CorrelationInputCounts { markets; signals; news }`, `CorrelationStampMeta { engine?; model?; inputCounts? }`
  - `stampCorrelationResult(result, meta)` — pure; returns a NEW object with `computedAt: Date.now()`; applies `meta.model`/`meta.inputCounts` when provided; `meta.engine` only when `result.engine === undefined`.
  - `readStoredAnalysis(storage, key)` — try/catch → null; null when not an object or `matches` not an array (empty/corrupt/null stored value treated as absent, never thrown).
  - `hasFreshAnalysis(stored)` — `stored != null && !stored.error`.
  - `persistCorrelationResult(storage, key, result)` — read-modify-write policy: error-vs-good check first, then newer-computedAt check (`existing.computedAt > result.computedAt` → skip); whole body try/catch returning `false` on storage failure.
- **`src/types/index.ts`** — `CorrelationResult` gained optional `computedAt?: number` (epoch ms), `model?: string` (empty/omitted for heuristic), `inputCounts?: { markets; signals; news }`.
- **`src/background/index.ts`** — success path of `runCorrelationAsync` now stamps with `{ model, inputCounts }`, persists via the helper, warns (not throws) when the helper returns false, and broadcasts the stamped result. CORRELATION_RESULT broadcast always fires.
- **`src/dashboard/hooks/useCorrelations.ts`** — `loaded` state set true in the mount-load effect's `.finally()`; returned in the hook surface.
- **`src/dashboard/App.tsx`** — corrInitRef auto-run gate: `if (corrInitRef.current) return; if (!corrLoaded) return; if (!snapshot) return; if (snapshot.markets.length === 0 && snapshot.signals.length === 0) return; corrInitRef.current = true; if (hasFreshAnalysis(correlations)) return;` then auto-run. Header freshness badge before the engine selector: `⏱ computed Xm ago · engine · model · ⚠ stale` (or `⏱ computed: unknown age · engine` for legacy results).
- **`tests/unit/correlation-persistence.test.ts` (NEW)** — 18 tests: stamp behavior (no mutation, engine-only-when-undefined), persist policy (success-over-absent/error/older → true; success-over-newer → false keeps stored; error-over-absent/error → true; error-over-non-error → false AND stored unchanged; storage failure → false), hasFreshAnalysis, readStoredAnalysis corrupt-tolerance.
- **`tests/e2e/fixtures.ts`** — `MOCK_CORRELATIONS` extended with `computedAt/model/inputCounts`; `runtimeSendMessage` counts `CORRELATE_ALL` into `globalThis.__trendcastCorrelateAllCalls` (counter at TOP, before handler loop and canned-response lookup).
- **`tests/e2e/dashboard.spec.ts`** — 2 tests: `shows cached results without auto-analyze` (counter === 0, cached text renders) and `header shows computedAt and engine from cached result`.

### Task 2: route the remaining 3 write sites through the helper

All in `src/background/index.ts`:

1. **Catch-path of `runCorrelationAsync`** — error result stamped with `{ engine, model }` (inputCounts unavailable — data loads inside the try), persisted via helper, broadcast sends the stamped result.
2. **SW-death recovery** — interrupted-error result stamped with `{ model: marker.model }`, persisted via helper, `clearMlRunState` and broadcast preserved.
3. **`runCorrelationPrecompute`** — `runCorrelationWithEngine` wrapped in try/catch; a throw becomes a terminal error result (empty match arrays, `requestId: 'precompute-' + Date.now()`, error message); stamped with `{ model, inputCounts }`; persisted via helper; **new CORRELATION_RESULT broadcast added** (precompute previously never broadcast); runAlertSweep/rebuildMarketNewsView/logging preserved.

Each call site logs a single `console.warn('[TrendCast] Kept existing non-error correlation result; …')` when the helper returns false. Helper usage: 4 call sites + 1 import.

### Task 3: e2e coverage for auto-run gate and badge edge cases

3 new tests in `Dashboard — Correlations Tab`:

1. `auto-runs analysis when no stored result exists` — `openDashboard(page, { 'trendcast:correlations': null })` → counter ≥ 1.
2. `header shows unknown age for legacy results without computedAt` — stored result with `computedAt` deleted → `/unknown age/i`.
3. `header marks stale results after a newer collection` — `computedAt: Date.now() - 7_200_000` (2h ago) vs seeded last-collection 30min ago → `/stale/i`.

## Verification Results

| Check | Command | Result |
|-------|---------|--------|
| Unit (new file) | `bun run test -- --run tests/unit/correlation-persistence.test.ts` | 18/18 pass |
| Unit (full suite) | `bun run test` | 434/434 pass (35 files) |
| Typecheck | `bun run typecheck` | exit 0 |
| Lint | `bun run lint` | exit 0 (after fixing one new-test unused-var warning) |
| E2E dashboard | `bun run test:e2e -- dashboard.spec.ts` | 93 passed, 3 failed (pre-existing, see Deviations) |
| Build | `bun run build:debug:firefox` | exit 0, built in 2.78s |

All 5 new e2e tests from this plan pass (2 from Task 1 + 3 from Task 3). The 3 failures are pre-existing and identical in the pre-Task-2 baseline run.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed unused `SettingsStorage` type import from the new test file**
- **Found during:** Task 1
- **Issue:** TS6133 — `SettingsStorage` imported but never read; typecheck failed.
- **Fix:** Removed the unused import.
- **Files modified:** `tests/unit/correlation-persistence.test.ts`

**2. [Rule 1 - Bug] Fixed ESLint `no-unused-vars` warning in a new e2e test**
- **Found during:** Task 3
- **Issue:** `const { computedAt: _omitted, ...legacyCorrelations }` trips `@typescript-eslint/no-unused-vars` under `--max-warnings 0`.
- **Fix:** Spread + `delete (legacyCorrelations as { computedAt?: number }).computedAt`.
- **Files modified:** `tests/e2e/dashboard.spec.ts`

### Pre-existing failures (out of scope, logged to `deferred-items.md`)

3 e2e tests fail identically before and after this plan: `engine dropdown has all 6 engine options`, `shows correlation engine radio buttons`, `heuristic engine is selected by default`. Root cause: commit `975a7a1` removed the zero-shot engine (6 → 5 options) without updating the tests. Per the scope-boundary rule these were NOT fixed; details and recommended fix in `.planning/phases/16-correlation-persistence-analysis-triggers/deferred-items.md`.

### Process deviation

- **No git commits made.** Per explicit user override (and the project's mandatory git rules), all changes were left unstaged for the user to review and commit. Per-task commit protocol was replaced by per-task verification + this SUMMARY.
- **STATE.md / ROADMAP.md not updated** — same explicit user override; only this SUMMARY and `deferred-items.md` were written under `.planning/`.

## Known Stubs

None. All data paths are wired: the badge reads the stored result, the auto-run gate reads real storage state, and every terminal path persists through the helper.

## Threat Flags

None. No new network endpoints, auth paths, or trust-boundary surface. The write policy strictly reduces destructive writes (errors can no longer clobber good cached results).

## Self-Check: PASSED

- `src/utils/correlation-persistence.ts` — FOUND
- `tests/unit/correlation-persistence.test.ts` — FOUND
- `tests/unit/correlation-persistence.test.ts` 18/18 pass — FOUND (verification output above)
- Full unit suite 434/434 — FOUND
- Typecheck exit 0 — FOUND
- Lint exit 0 — FOUND
- E2E 93 passed incl. all 5 new tests — FOUND
- Build exit 0 — FOUND
- No commits made (per user override) — confirmed via `git status` (changes unstaged)