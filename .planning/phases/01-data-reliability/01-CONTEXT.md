# Phase 1: Data Reliability - Context

**Gathered:** 2026-08-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix the silent Seeking Alpha / Investing.com news drop-out in the correlation tab, and add per-source health/staleness indicators so the user can distinguish a degraded/stale source from one that simply has no correlated items. This is a brownfield hardening phase on the existing MV3 extension — no new capabilities, no new dependencies.

The live diagnosis (from `1-RESEARCH.md`) confirmed the feeds work: all four problem/control sources return 10 items each. The real root cause is **correlation-threshold filtering** (`MIN_CONFIDENCE = 0.75`, or `0.35` with entity match) plus **display truncation** (top-15/top-30 slicing in `CorrelationPanel.tsx`), compounded by a **complete absence of per-source telemetry** (`CollectionSnapshot` stores only global `collectedAt`, no per-source `lastFetchedAt`/`itemCount`/`failures`).

</domain>

<decisions>
## Implementation Decisions

### Correlation Threshold Fix
- **D-01:** Keep the existing correlation thresholds (`MIN_CONFIDENCE = 0.75`, `MIN_CONFIDENCE_ENTITY_MATCH = 0.35`) unchanged. Do NOT lower them globally and do NOT add a per-source carve-out for seekingalpha/investing. Lowering globally risks false positives across all sources; a carve-out adds config surface without evidence. — **Reversibility:** reversible — thresholds are constants in `src/services/engine/correlation.ts`; changing them later is a one-line edit.
- **D-02:** Add a **permanent diagnostic regression test** (`tests/unit/correlation-threshold.test.ts`) that feeds Seeking Alpha / Investing.com-style headlines against sample market contracts and asserts the resulting confidence scores. This provides evidence for whether the threshold is systematically too high for these sources, and acts as a regression guard. — **Reversibility:** reversible — a test file can be removed or adjusted freely.
- **D-03:** If the diagnostic test reveals SA/Investing scores are systematically below threshold, revisit the threshold decision with that evidence (in a future decision, not pre-emptively now). The test is the evidence-gathering mechanism, not a commitment to change thresholds.

### the agent's Discretion
- The user selected only the "Correlation threshold fix" area for discussion. The other identified gray areas (health indicator behavior, staleness definition, display truncation) were NOT discussed. The agent has discretion to make reasonable, reversible choices here, grounded in `1-RESEARCH.md` and the UI-SPEC (`01-UI-SPEC.md`), which already specifies a `SourceHealthIndicator` component with 4 semantic health states (healthy/stale/degraded/no-data) rendering "fetched N · correlated M" per source.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Requirements & Research
- `.planning/REQUIREMENTS.md` — REL-01 (SA/Investing visible in correlation tab), REL-02 (per-source health/staleness indicators). Phase 1 scope.
- `.planning/phases/01-data-reliability/1-RESEARCH.md` — Live diagnosis (feeds work; root cause is threshold + truncation + no telemetry). Primary recommendation: build a `sourceHealth` telemetry layer. Architectural responsibility map, patterns, anti-patterns, pitfalls.
- `.planning/phases/01-data-reliability/1-VALIDATION.md` — Per-phase validation contract (Vitest, wave-0 gaps, security ASVS Level 1).

### UI Design Contract
- `.planning/phases/01-data-reliability/01-UI-SPEC.md` — Approved UI design contract. Specifies `SourceHealthIndicator` component, 4 semantic health states, "fetched N · correlated M" rendering, 8-point spacing scale, color semantics (bull/amber/bear/neutral for health states — never brand-500 for health badges).

### Codebase Maps
- `.planning/codebase/ARCHITECTURE.md` — Background-orchestrator + storage-as-state + React-UI architecture; component responsibilities.
- `.planning/codebase/STACK.md` — Existing stack (TypeScript 5.5, React 18, Vite 5 + @crxjs, Tailwind 3, Transformers.js 3.7, Vitest, Playwright). Do not change.
- `.planning/codebase/CONVENTIONS.md` — Code conventions.
- `.planning/codebase/INTEGRATIONS.md` — Integration points.

### Project Constraints
- `.planning/PROJECT.md` — Core value, constraints (100% client-side, Bun only, MV3 Chrome+Firefox, ~7MB storage budget, no backend/API keys).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/types/index.ts` — `NewsSource` union (line ~88), `CollectionSnapshot` (line ~270). Add `SourceHealth` type + `sourceHealth` field here.
- `src/config/index.ts` — Centralized storage keys, intervals, budgets. Add `sourceHealth` storage key + staleness threshold here.
- `src/services/collectors/news.ts` — `collectNews()` uses `Promise.allSettled`; records per-source fetch outcomes. Edit to write into `sourceHealth`.
- `src/background/index.ts` — `runCollection()` orchestrator; build + persist `sourceHealth` here.
- `src/dashboard/components/` — Existing components; add `SourceHealthIndicator.tsx` (NEW).
- `src/dashboard/hooks/useSnapshot.ts` — Reads snapshot from storage; extend to read `sourceHealth`.
- `src/utils/storage.ts` — Storage budget/pruning; include `sourceHealth` key in `BUDGET_KEYS` if separate key.

### Established Patterns
- **Storage-as-state:** All durable state in `chrome.storage.local`; UI reads snapshots + subscribes to `onChanged`. `sourceHealth` must be persisted, not held in module memory (MV3 worker is ephemeral).
- **Typed messaging:** discriminated-union `Message` type drives type-safe `sendMessage`/`onMessage`.
- **Cross-browser:** `webextension-polyfill` via `@/messaging/browser` (Firefox needs it).
- **Health indicator is read-only derived projection** over data the collector already has — do not over-engineer.

### Integration Points
- Background collector (`collectNews`) → records per-source fetch outcomes → `sourceHealth` map.
- `runCollection()` → persists `sourceHealth` alongside `CollectionSnapshot` (atomic write).
- Dashboard `useSnapshot()` → reads `sourceHealth` → renders `SourceHealthIndicator` in correlations/news tabs.
- Correlation engine (`src/services/engine/correlation.ts`) → thresholds unchanged (D-01); diagnostic test asserts scores.

</code_context>

<specifics>
## Specific Ideas

- The user's core concern: SA/Investing news silently disappears from the correlation tab. The fix must make the drop-out **visible** (fetched vs correlated decoupled) rather than force-displaying items.
- The user explicitly chose NOT to lower correlation thresholds without evidence — the diagnostic test is the evidence mechanism.
- The user's broader vision (from PROJECT.md) is to harden features and make them faster; this phase is the reliability hardening slice.

</specifics>

<deferred>
## Deferred Ideas

- **Per-source filter in the correlation tab** — surfaced during gray-area identification (display truncation crowds out SA/Investing matches). Not discussed/selected; belongs in a future phase if the user wants it.
- **Lowering `MIN_CONFIDENCE`** — explicitly deferred pending diagnostic-test evidence (D-3).
- **Per-source storage caps** — already deferred to PERF-03 in v2 requirements.

</deferred>

---

*Phase: 1-Data Reliability*
*Context gathered: 2026-08-22*
