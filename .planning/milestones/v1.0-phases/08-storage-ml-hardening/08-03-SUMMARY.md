---
phase: 08-storage-ml-hardening
plan: 03
status: complete
date: 2026-08-23
verification: passed
tests: 14/14
typecheck: clean
---

# Plan 08-03 Summary — ML Quantization + WebGPU Fallback

## What was done

Extended the WebGPU + WASM fallback pattern (previously LLM-only) to all five ML pipelines, added an explicit dtype fallback chain, and proved quantized results are equivalent to fp32 via golden tests (PERF-04, D-04, D-05, D-06).

- Added a shared `resolveDeviceAndDtype()` helper that detects `navigator.gpu` and picks the smallest dtype from the fallback chain `["q4", "q8", "fp16", "fp32"]` (D-04). Returns `{}` (WASM CPU, no dtype override) when WebGPU is absent or detection throws.
- Added `createPipelineWithFallback()` — a single choke point that resolves device/dtype, attempts the pipeline on WebGPU, and on failure retries once on WASM CPU.
- Refactored all five `get*Pipeline()` functions (embedding/sentiment/zero-shot/NER/LLM) to use the shared helper + fallback, replacing the LLM-only inline WebGPU logic.
- Confirmed the worker WASM path (`setWasmPath`/`deriveWasmPath`) is untouched — it configures `env.backends.onnx.wasm.wasmPaths` before any pipeline runs, so the WASM fallback still works when WebGPU is primary.
- Stayed on Transformers.js 3.7.x (no v4 upgrade, D-06).

## Files changed

- `src/services/engine/ml/transformers.ts` (shared `resolveDeviceAndDtype` + `createPipelineWithFallback`, refactored all five pipelines)
- `tests/unit/quantization-equivalence.test.ts` (new — 14 tests)

## Verification

- 14/14 unit tests pass (device/dtype resolution, all five pipelines use WebGPU, WASM fallback, WebGPU→WASM retry, quantized-vs-fp32 equivalence within tolerance).
- `bun run typecheck` clean.
- Full suite: 298/298 tests pass.

## Notes

The dtype chain picks the smallest available dtype to minimise download size and inference cost. Quantization equivalence tests (D-05) assert q8/q4 scores stay within tolerance of fp32, catching silent quality drift. All three Phase 8 plans are now complete.
