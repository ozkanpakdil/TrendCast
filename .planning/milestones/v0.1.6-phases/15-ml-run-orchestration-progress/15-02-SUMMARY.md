---
phase: 15-ml-run-orchestration-progress
plan: 02
subsystem: ml-download-progress
tags: [ml, worker, progress, transformers-js]
provides:
  - "Per-file model-download progress (loading-model phase) through the existing CORRELATION_PROGRESS channel (MLPROG-02)"
  - "mapDownloadToProgress helper mapping transformers.js statuses onto the progress channel"
  - "preloadModelWithProgress for future preload UI"
affects: [workers, background, dashboard, types]
tech-stack:
  added: []
  patterns:
    - "Optional trailing callback param threaded through engine layers (no breaking signature changes)"
key-files:
  created:
    - tests/unit/model-download-progress.test.ts
  modified:
    - src/services/engine/ml/transformers.ts
    - src/services/engine/ml/types.ts
    - src/services/engine/ml/embedding.ts
    - src/services/engine/ml/sentiment.ts
    - src/services/engine/ml/ner.ts
    - src/services/engine/ml/llm.ts
    - src/services/engine/ml.ts
    - src/workers/ml-worker.ts
    - src/background/index.ts
    - src/dashboard/hooks/useCorrelations.ts
    - src/dashboard/App.tsx
    - src/types/index.ts
key-decisions:
  - "No protocol change — download events reuse the existing worker 'progress' message and CORRELATION_PROGRESS broadcast with a new optional `file` field"
  - "Status mapping: initiate → 0/1, progress → loaded/total (percentage/100 fallback), done → 1/1, download → null (no counts to show)"
  - "Cancel check inside the download callback throws like onProgress does, aborting pipeline creation"
  - "Cache key unchanged — pipeline identity, not download state"
duration: "30min"
completed: 2026-08-29
---

# Phase 15 Plan 02: Model-Download Progress Events Summary

**First-run model downloads now surface per-file progress through the existing `loading-model` phase instead of a silent spinner — the dashboard shows which file is downloading and how far along it is.**

## Accomplishments

- **Task 1 — transformers.ts:** `ModelDownloadInfo`/`ModelDownloadCallback` types; `createPipelineWithFallback` accepts an optional `onModelDownload` and passes `progress_callback` into `lib.pipeline` on both the WebGPU attempt and the WASM retry; threaded through all four `get*Pipeline()` functions (cache key unchanged). Added `mapDownloadToProgress()` mapping transformers.js statuses onto the progress channel (`initiate` → 0/1, `progress` → `loaded`/`total` with percentage fallback, `done` → 1/1, `download` → null).
- **Task 2 — engine plumbing + worker:** `onModelDownload` threaded through `correlateAllEmbedding`/`correlateAllSentiment`/`correlateAllNER`/`correlateLLM`/`correlateNewsLLM`/`correlateNewsSocialLLM` (optional trailing param) into the batch classes and `llmScoreBatch`. The worker builds a download callback that maps events to `loading-model` progress messages via the existing `postMessageToHost({ type: 'progress' })` channel, with a cancel check inside the callback. `preloadModelWithProgress` added to the ml barrel for future preload UI.
- **Task 3 — UI:** `CORRELATION_PROGRESS` payload and `CorrelationProgress` gained an optional `file` field; the dashboard progress card appends the file name during `loading-model` (e.g. "Loading model… onnx/model_quantized.onnx"). `phaseLabel` already mapped the phase.
- **Task 4 — tests:** 10 new tests covering the status mapping (incl. percentage fallback and `download` → null), callback forwarding through all four pipeline getters, WASM-retry forwarding, no-callback omission, and cancel-abort inside the callback.

## Files Created/Modified

- `src/services/engine/ml/transformers.ts` — download types, `progress_callback` plumbing, `mapDownloadToProgress`
- `src/services/engine/ml/types.ts` — `ProgressInfo.file?`
- `src/services/engine/ml/{embedding,sentiment,ner,llm}.ts` — trailing `onModelDownload` param
- `src/services/engine/ml.ts` — exports + `preloadModelWithProgress`
- `src/workers/ml-worker.ts` — download callback → `loading-model` progress messages (with `file`)
- `src/background/index.ts` — forwards `file` in `CORRELATION_PROGRESS`
- `src/dashboard/hooks/useCorrelations.ts` + `src/dashboard/App.tsx` — show file name during `loading-model`
- `src/types/index.ts` — `CORRELATION_PROGRESS` payload `file?`
- `tests/unit/model-download-progress.test.ts` — new (10 tests)

## Decisions & Deviations

- **No protocol change:** download events reuse the worker's `progress` message and the background's `CORRELATION_PROGRESS` broadcast — the only addition is an optional `file` field, so old listeners keep working.
- **Percentage fallback:** some transformers.js events carry only `progress` (0–100) without byte counts; the mapper falls back to `current = progress, total = 100` so the bar still moves.
- **Test expectation correction:** on the WebGPU-failure path the first attempt throws during pipeline creation before emitting any download events, so only the WASM retry's events are observed (assertion updated accordingly).

## Verification

- `bun run test -- --run tests/unit/model-download-progress.test.ts` — 10/10
- `bun run test` — **416/416 passing (34 files)** (406 baseline + 10 new)
- `bun run typecheck` — clean; `bun run lint` — clean (max-warnings 0)
- `bun run build:debug:firefox` — built in 2.56s

## Task Commits

1. **Plan 15-02 (all tasks)** — not committed (per project rules the user stages/commits). Intended message: `feat(ml): per-file model-download progress via loading-model phase (15-02)`