---
phase: 01-data-reliability
plan: 02
subsystem: testing
tags: [correlation, thresholds, diagnostic, regression]

requires:
  - phase: 01-data-reliability
    plan: 01-01
    provides: sourceHealth telemetry layer, REL-01 fetched-vs-correlated decoupling
provides:
  - Permanent diagnostic regression test documenting SA/Investing confidence distribution
  - Evidence for D-03 (threshold root-cause analysis)
affects: [01-03, verify-work]

actuals:
  tokens: 0
  tasks: 1
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Diagnostic regression test asserting scores against unchanged thresholds"

key-files:
  created:
    - tests/unit/correlation-threshold.test.ts
  modified: []

key-decisions:
  - "Do NOT change MIN_CONFIDENCE (0.75) or MIN_CONFIDENCE_ENTITY_MATCH (0.35) — D-01 preserved."
  - "Test asserts scores against existing thresholds to document whether they systematically drop SA/Investing (D-03 evidence)."

patterns-established:
  - "Diagnostic test logs actual confidence scores for visibility in test output"

requirements-completed: [REL-01]

coverage:
  - id: D1
    description: "Diagnostic regression test documents SA/Investing confidence scores against unchanged thresholds"
    requirement: REL-01
    verification:
      - kind: unit
        ref: "tests/unit/correlation-threshold.test.ts#correlateNews threshold diagnostics"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-08-22
status: complete
---

# Phase 01: Data Reliability — Correlation Threshold Diagnostic

Added a permanent diagnostic regression test that feeds Seeking Alpha / Investing.com-style headlines against sample market contracts and asserts the resulting confidence scores against the unchanged correlation thresholds.

## Performance

- **Tasks:** 1 completed
- **Files modified:** 1 (1 created)

## Accomplishments
- Created `tests/unit/correlation-threshold.test.ts` with 4 diagnostic tests.
- **Root cause confirmed:** SA/Investing headlines sharing a named entity (e.g. "Bitcoin") clear the lower entity threshold (0.35) and DO match. Keyword-only headlines never clear the keyword threshold (0.75) — structurally dropped.
- Thresholds in `src/services/engine/correlation.ts` unchanged (D-01 preserved).

## Task Commits

Commits are handled by the user per repository git rules (no auto-commit).

**Plan metadata:** `01-02-PLAN.md`

## Files Created/Modified
- `tests/unit/correlation-threshold.test.ts` - Diagnostic regression test documenting SA/Investing confidence distribution.

## Decisions Made
- Kept thresholds unchanged (D-01); the test is the evidence mechanism for D-03.
- Fixed the Investing test to assert against the entity threshold (0.35) since "Bitcoin" is a known entity, not the keyword threshold.

## Deviations from Plan

Minor: the Investing.com test initially asserted against the keyword threshold (0.75), but "Bitcoin" is a known entity so the headline clears the entity threshold (0.35). Corrected the assertion to document the entity-match path accurately.
