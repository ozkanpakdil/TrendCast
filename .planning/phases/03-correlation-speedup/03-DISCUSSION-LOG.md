# Phase 3: Correlation Speedup - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-22
**Phase:** 3-Correlation Speedup
**Areas discussed:** Golden-Test Equivalence Strategy

---

## Golden-Test Equivalence Strategy

### Q1: Golden-test scope

| Option | Description | Selected |
|--------|-------------|----------|
| All engines, full equivalence | Run both the indexed and naive paths on the same fixtures and assert identical results. Covers heuristic + all ML engines. Most thorough but most test code. | ✓ |
| Heuristic path only | Golden-test only the heuristic path (correlate/correlateNews/correlateNewsSocial) since that's the primary O(n×m) bottleneck. ML engines already have their own pre-filters. | |
| Index layer + one E2E | Golden-test the shared index + tokenizer layer in isolation (unit-level), plus one end-to-end heuristic equivalence test. Lighter, focuses on the shared machinery. | |

**User's choice:** All engines, full equivalence
**Notes:** Full equivalence across heuristic + all 5 ML engines.

### Q2: Equivalence oracle

| Option | Description | Selected |
|--------|-------------|----------|
| Naive loop is the oracle | The naive O(n×m) loop is the reference. The indexed path must produce byte-identical results (same matches, same confidence, same order). Indexed path is 'wrong' if it differs. | |
| Hand-verified golden fixtures | Both paths must match a hand-verified golden fixture set (curated inputs with known expected outputs). Guards against both paths sharing the same bug. | |
| Hybrid: naive oracle + hand fixtures | Naive loop as oracle for most cases, plus a small set of hand-verified fixtures for edge cases (empty keywords, tiny inputs, single contract). | ✓ |

**User's choice:** Hybrid: naive oracle + hand fixtures
**Notes:** The hand fixtures specifically guard against both paths sharing the same bug.

### Q3: Edge-case coverage

| Option | Description | Selected |
|--------|-------------|----------|
| Comprehensive edge cases | Include empty keyword arrays, single contract, single signal, duplicate keywords, cashtag/hashtag-only texts, and the tiny-input fallback path (index not built). | ✓ |
| Common + fallback only | Cover the common cases (normal signals × contracts) plus the tiny-input fallback. Skip exotic edge cases to keep the test suite lean. | |
| Planner's discretion | Let the planner decide the exact edge-case list based on the code paths touched. | |

**User's choice:** Comprehensive edge cases
**Notes:** Includes the tiny-input fallback path (index not built).

### Q4: Test structure

| Option | Description | Selected |
|--------|-------------|----------|
| Per-engine equivalence files | A dedicated equivalence test file per engine (e.g., correlation-equivalence.test.ts) that runs both paths over shared fixtures and asserts identical results. Clear failure isolation. | ✓ |
| Single table-driven file | One shared equivalence test file that iterates over all engines with a table-driven approach. Less duplication, single place to add fixtures. | |
| Fold into existing test files | Equivalence tests live alongside existing unit tests (correlation.test.ts, etc.) rather than in new files. | |

**User's choice:** Per-engine equivalence files
**Notes:** Clear failure isolation per engine.

---

## the agent's Discretion

The user selected only the Golden-test equivalence area. The following areas were identified but NOT discussed — the agent has discretion, guided by research SUMMARY.md:
- **Index scope across engines** — research mandates shared index across heuristic AND ML paths.
- **Canonical tokenization source** — one tokenizer shared by index + matcher.
- **Incremental index caching** — cache by data version; planner decides in-memory vs persisted.

## Deferred Ideas

None — discussion stayed within phase scope.
