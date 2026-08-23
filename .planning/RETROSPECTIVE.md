# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — Speed, Alerts & New Data

**Shipped:** 2026-08-23
**Phases:** 6 | **Plans:** 19 | **Tasks:** 10

### What Was Built
- Inverted keyword→contract index collapsing O(n×m) correlation to candidate filtering across heuristic + ML paths, with equivalence tests proving no result drift (PERF-02).
- Correlation alerts: pure `evaluateAlerts()` + `deriveDirection()` engine — deduped, throttled, watchlist-scoped, direction-aware notifications surviving the MV3 service worker via alarms (ALERT-01/02).
- Market-driven news: read-only derived view surfacing important markets → correlated news → directional implication, organized by a consistent category taxonomy (MKT-01/02).
- Watchlist & export: sort/filter/correlation-status badges + export coverage for new sources (DASH-01/02).
- TikTok collector: best-effort content-script-driven TikTok sentiment with hard timeout + graceful degradation + manual URL-paste fallback (SRC-01/02).
- Storage & ML hardening: per-key caps (1000/1000/1000) + `getBytesInUse()`-authoritative budget; ML quantization (q8/q4) + WebGPU with WASM fallback (PERF-03/04).

### What Worked
- Pure, unit-testable helper modules (merge helpers, alert engine, storage tracking) extracted from the background orchestrator — easy to test in isolation and reuse across phases.
- Golden-test equivalence approach (quantized vs fp32, index vs naive loop) gave high confidence that performance changes introduced no result drift.
- Mocking `@huggingface/transformers` directly (rather than the loader wrapper) made pipeline fallback tests reliable.
- Distinct valid model names per test avoided pipeline-cache collisions in ML tests.

### What Was Inefficient
- E2E suite lagged behind the app: asserts 9 tabs but the app grew to 11 (Alerts, Market News) — no e2e coverage for the two new tabs.
- Export test lacked an explicit TikTok-in-export assertion (coverage was implicit via the generic platform field).
- Live-browser confirmations (storage budget under sustained collection, ML WASM fallback, TikTok live fetch) were deferred — unit-tested in isolation but not exercised in a real browser.

### Patterns Established
- Per-key storage caps enforced at write time via a shared `capByOldest` helper, with `getBytesInUse()` as the authoritative budget source.
- ML pipeline creation centralized in a shared `createPipelineWithFallback` helper with a dtype fallback chain (q4 → q8 → fp16 → fp32) and WebGPU→WASM retry.
- Alerts and derived views cascade from both correlation hook points (`runCorrelationAsync` and `runCorrelationPrecompute`).

### Key Lessons
1. Import `browser` from `@/messaging/browser` AFTER `vi.mock` when a test body references it directly — the mock replaces the module.
2. Capture gsd-tools JSON output to a file with `2>/dev/null` to avoid warning-line stdout pollution breaking JSON parsing.
3. `capByOldest` must handle both ISO-string dates and numeric epoch-ms dates (different data shapes across markets/signals/news).
4. Model type unions are strict — always use valid model names in tests.
5. The pre-close artifact audit surfaces stale deferred items; verify against current state (typecheck) before acknowledging.

### Cost Observations
- Model mix: adaptive profile (opus/sonnet/haiku mix)
- Sessions: 1 long autonomous session
- Notable: sequential inline execution kept context manageable; subagents (verifier, integration-checker) offloaded heavy verification.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | 1 | 6 | Autonomous execution with subagent verification + integration checking |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | 298 | unit + e2e | 0 new runtime deps |

### Top Lessons (Verified Across Milestones)

1. Pure helper modules extracted from orchestrators are far easier to unit-test and reuse.
2. Golden-test equivalence is the safest way to prove performance refactors preserve behavior.
