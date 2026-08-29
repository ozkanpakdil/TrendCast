---
phase: 15-ml-run-orchestration-progress
status: executed
created: 2026-08-29
---

# Phase 15 — ML Run Orchestration & Progress

**Goal:** ML correlation progress always reaches a terminal state and reflects reality — progress is scoped per run, the worker is serialized, model downloads are visible, and no path leaves the UI stuck.

**Requirements:** MLPROG-01, MLPROG-02

## Plans

**Wave 1**

- [x] 15-01-PLAN.md — Serialized ML run queue + requestId-scoped terminal states + persisted run-state marker (MLPROG-01) — completed 2026-08-29

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 15-02-PLAN.md — Model-download progress events through the `loading-model` phase (MLPROG-02) — completed 2026-08-29

## Success Criteria (from ROADMAP.md)

1. Progress bar always settles: on success, ML error, and cancel, the loading state clears — no stuck bar even when a `precompute-*` run overlaps a `corr-*` run
2. Progress and result acceptance are scoped by `requestId` — a late/overlapping run's messages never update or settle another run's UI
3. First-run model download shows a `loading-model` progress phase driven by `progress_callback` events (per-file `initiate`/`download`/`progress`/`done`), instead of silence
4. ML runs are serialized through the background worker — overlapping requests queue rather than overwrite each other's resolver
5. A run interrupted by MV3 service-worker death leaves a persisted run-state marker any tab can use to reconstruct/clear stale progress