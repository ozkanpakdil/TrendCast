# Phase 16 — Deferred Items

## Pre-existing e2e failures (out of scope for 16-01)

**Discovered during:** Task 1 e2e verification (present in the baseline run before any Task 2/3 changes; identical 3 failed / 90 passed in both the Task 1 and Task 3 runs).

**Root cause:** Commit `975a7a1` ("refactor: remove zero-shot classification engine and related code") removed the zero-shot engine from the correlation engine selector (6 → 5 options) but did not update the corresponding e2e tests.

**Affected tests (all in `tests/e2e/dashboard.spec.ts`):**

1. `Dashboard — Correlations Tab › engine dropdown has all 6 engine options` (line 552) — expects 6 `<option>` elements in `main select[title="Correlation engine"]`, receives 5 (heuristic, embedding, sentiment, ner, llm).
2. `Dashboard — Settings Tab › shows correlation engine radio buttons` (line 1083) — same 6-vs-5 mismatch for the Settings radio group.
3. `Dashboard — Settings Tab › heuristic engine is selected by default` (line 1091) — same root cause (radio set no longer contains the removed engine).

**Recommended fix:** Update the three tests to expect 5 engines (or assert the exact remaining set: heuristic, embedding, sentiment, ner, llm). Alternatively, if the zero-shot engine removal was unintentional, restore it in `src/dashboard/App.tsx` (engine selector ~line 522) and the Settings radio group.

**Not fixed here because:** The scope-boundary rule forbids fixing pre-existing failures unrelated to the current task's changes, and touching the engine-selector surface is outside 16-01's file list.