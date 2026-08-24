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
- Model mix: adaptive (opus/sonnet/haiku mix)
- Sessions: 1 long autonomous session
- Notable: sequential inline execution kept context manageable; subagents (verifier, integration-checker) offloaded heavy verification.

---

## Milestone: v1.1 — News Source Fix

**Shipped:** 2026-08-24
**Phases:** 2 | **Plans:** 7 | **Tasks:** 4

### What Was Built
- News source fix: deep-merge `enabledSources` so newer source flags (seekingalpha/investing/googleFinance) default to `true` for existing users, plus a settings migration to backfill missing flags on load — preserving explicit user preferences (NEWS-01/02/03).
- Health quirk fix: a healthy-but-quiet news source (304 Not Modified) no longer shows "Degraded · fetched 0" when its stored news is present and correlated (G-09-1).
- Cross-source consensus alerts: surface important topics even with an empty watchlist by detecting when the same topic appears across >=3 distinct source types (mixing social + news), reusing the existing `newsSocialMatches` correlation output and the shared alert infrastructure (PHASE-10).
- Cross-source alert engine: union-find clustering of correlation matches by shared entity keyword, distinct source-type counting, any-direction firing, per-topic cooldown, and `alertsEnabled` gating (D-01..D-10).
- Kind-aware AlertsTab UI: cross-source cards with topic label, indigo "Cross-source" badge, source breakdown, and clickable Source/Social links; watchlist cards unchanged.

### What Worked
- Reusing the existing `newsSocialMatches` correlation output and the shared alert infrastructure meant the consensus engine needed no new collectors or storage — a thin, pure clustering layer on top of proven data.
- Union-find clustering by shared entity keyword cleanly grouped correlation matches into topics without a heavyweight NLP dependency.
- The settings deep-merge + migration pair was small, unit-testable, and regression-covered — the same pure-helper pattern that worked in v1.0.

### What Was Inefficient
- The `milestone.complete` CLI archived Phase 9 but missed Phase 10 because it was a standalone `### Phase 10` section in ROADMAP.md rather than grouped under the v1.1 `<details>` block — required a manual `mv` and a MILESTONES.md count correction. Grouping phases under milestone blocks from the start avoids this.
- The pre-close artifact audit surfaced 2 UAT gap items that were already `passed` — acknowledging them was mechanical but added a manual step.

### Patterns Established
- Cross-source consensus reuses the shared `alertHistory` and alert infrastructure rather than introducing a parallel alert path.
- Consensus requires >=3 distinct source types with a social+news mix — a deliberate threshold to avoid noise from a single source family.
- Per-topic cooldown prevents alert spam when a topic stays hot across multiple collection cycles.

### Key Lessons
1. Keep every phase of a milestone grouped under its `<details>` block in ROADMAP.md so `milestone.complete` archives all of them automatically.
2. A healthy-but-quiet source (304) must be distinguished from a genuinely degraded source when reporting health — status is not the same as fetch count.
3. Reusing shared infrastructure (correlation output, alert history, alert UI) is the fastest path to a new alerting feature.

### Cost Observations
- Model mix: adaptive profile (opus/sonnet/haiku mix)
- Sessions: 1 long autonomous session
- Notable: sequential inline execution kept context manageable; the milestone close required manual correction for the standalone Phase 10 section.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | 1 | 6 | Autonomous execution with subagent verification + integration checking |
| v1.1 | 1 | 2 | Focused bug-fix + new alerting feature; milestone close needed manual Phase 10 archival |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | 298 | unit + e2e | 0 new runtime deps |
| v1.1 | 340 | unit + e2e | 0 new runtime deps |

### Top Lessons (Verified Across Milestones)

1. Pure helper modules extracted from orchestrators are far easier to unit-test and reuse.
2. Golden-test equivalence is the safest way to prove performance refactors preserve behavior.
3. Reusing shared infrastructure (correlation output, alert history) is the fastest path to a new alerting feature.
