# Phase 1: Data Reliability - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-22
**Phase:** 1-Data Reliability
**Areas discussed:** Correlation threshold fix

---

## Correlation Threshold Fix

| Option | Description | Selected |
|--------|-------------|----------|
| Lower globally | Lower MIN_CONFIDENCE globally so more headlines clear the bar. Risk: more false positives across ALL sources, not just SA/Investing. | |
| Per-source carve-out | Keep the global threshold but add a lower carve-out just for seekingalpha/investing sources. More surgical, but adds config surface. | |
| Keep thresholds, surface it | Don't change thresholds at all — instead surface 'fetched N, correlated 0' so you can SEE the drop-out, and decide later if a threshold change is warranted. | ✓ |

**User's choice:** Keep thresholds, surface it
**Notes:** User chose not to lower thresholds without evidence.

### Follow-up: How to surface the drop-out

| Option | Description | Selected |
|--------|-------------|----------|
| Surface via health indicator | The health indicator shows 'fetched N · correlated M' per source. If SA shows 'fetched 10 · correlated 0', you know it's a threshold/overlap issue, not a feed failure. | |
| Add diagnostic test | Add a diagnostic unit test that runs SA/Investing headlines against real market contracts to measure actual confidence scores — evidence for whether a threshold change is ever warranted. | ✓ |
| Both | Both — surface it in the UI AND add the diagnostic test so we have evidence for a future decision. | |

**User's choice:** Add diagnostic test

### Follow-up: Permanent test or one-off

| Option | Description | Selected |
|--------|-------------|----------|
| Permanent regression test | A permanent unit test (tests/unit/correlation-threshold.test.ts) that feeds SA/Investing-style headlines against sample market contracts and asserts the confidence scores — evidence and a regression guard. | |
| One-off diagnostic script | A one-off diagnostic script you run manually to measure real confidence scores, not part of the test suite. | |
| Test now, revisit threshold with evidence | Permanent test now, and if it reveals SA/Investing scores are systematically below threshold, revisit the threshold decision with evidence. | ✓ |

**User's choice:** Test now, revisit threshold with evidence
**Notes:** The diagnostic test is the evidence-gathering mechanism, not a commitment to change thresholds.

---

## the agent's Discretion

The user selected only the "Correlation threshold fix" area for discussion. The other identified gray areas (health indicator behavior, staleness definition, display truncation) were NOT discussed. The agent has discretion to make reasonable, reversible choices here, grounded in `1-RESEARCH.md` and the approved `01-UI-SPEC.md` (which already specifies the `SourceHealthIndicator` component with 4 semantic health states rendering "fetched N · correlated M").

## Deferred Ideas

- **Per-source filter in the correlation tab** — surfaced during gray-area identification (display truncation crowds out SA/Investing matches). Not discussed/selected; belongs in a future phase if the user wants it.
- **Lowering `MIN_CONFIDENCE`** — explicitly deferred pending diagnostic-test evidence.
- **Per-source storage caps** — already deferred to PERF-03 in v2 requirements.
