# Requirements: TrendCast — v0.1.6 fix correlation

**Defined:** 2026-08-27
**Core Value:** Surface the strongest, most reliable signal of what prediction markets are moving and why — by correlating social hype, news, and market odds — fast enough that the user trusts it as a daily decision aid.

## v0.1.6 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Correlation Correctness

- [ ] **CORR-01**: User sees stock-indicator news correlate with social/news/markets — cashtag `$AMZN`, bare ticker `AMZN`, and org name `Amazon` resolve to one canonical entity (unified ticker-canonical alias space in `entities.ts`/`keywords.ts`)
- [ ] **CORR-02**: User's keyword-level correlation bridges forms — `extractKeywords` emits bare form for cashtags (or correlation normalizes both sides) so keyword Jaccard intersects between stock-indicator news and social signals
- [ ] **CORR-03**: User's correlations stay clean — screener template tokens (`vcp`, `2026`, `breakout`, source labels/dates) are filtered from stock-indicator item keywords so they never create false bridges
- [ ] **CORR-04**: User can observe bridging health — source health shows count of stock-indicator items that produced a canonical ticker entity vs total (extends `SourceHealth` projection)

### ML Progress UX

- [ ] **MLPROG-01**: User sees progress that always reaches a terminal state — progress is scoped by requestId, result acceptance no longer deadlocks on `precompute-*` vs `corr-*` mismatch, and progress clears on success, error, and cancel paths
- [ ] **MLPROG-02**: User sees model-download progress — `progress_callback` wired into `createPipelineWithFallback`, surfaced through the existing `CORRELATION_PROGRESS` channel as a `loading-model` phase (per-file `initiate`/`download`/`progress`/`done` events)

### Analysis Triggers & Persistence

- [ ] **TRIG-01**: User's correlation results carry freshness metadata — every terminal path (success, ML error, cancel) writes `CONFIG.storage.correlations` including `computedAt` (+ input metadata); error results never clobber fresh good cached results
- [ ] **TRIG-02**: User sees cached results instantly on tab open — no auto-analyze on dashboard load; analysis runs only when no stored analysis exists
- [ ] **TRIG-03**: User gets fresh correlations after collecting — re-analyze triggers when collectNow/collection completes (via `storage.onChanged` on snapshot keys, mirroring the `useSnapshot` pattern)
- [ ] **TRIG-04**: User can tell live from cached results — Correlations header shows `computedAt` + engine (stale-result badge)

## v0.1.7+ Requirements

Deferred to future release. Tracked but not in current roadmap.

### Correlation Correctness

- **CORR-05**: Per-file download progress aggregation polish (aggregate `loaded`/`total` across files into one labeled bar) — trigger: first-run download UX still unclear after MLPROG-02

### ML Progress UX

- **MLPROG-03**: Full ticker universe beyond `KNOWN_TICKERS` (embedded NASDAQ/NYSE symbol list) — defer: curated set covers the user's actual watchlist; a 10k-symbol list adds bundle weight for marginal recall

### Analysis Triggers & Persistence

- **TRIG-05**: Cross-run embedding cache persistence (vectors to storage) — defer: in-memory cache already spans the three passes; storage cost/benefit unproven

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Fuzzy/substring ticker matching (`amz` → `AMZN`, `V` → any "v") | Bare 1–2 letter tickers are English words/initials; produces the exact false-positive class the entity-confidence system exists to prevent. Exact match against curated `KNOWN_TICKERS` only |
| Auto-analyze on every tab open | Re-runs multi-minute ML job on every new-tab; duplicates background precompute; caused the stuck-progress confusion. Cached-until-recollect with visible `computedAt` instead |
| Persisting intermediate progress states to storage | Progress is ephemeral UI state; burns the ~7 MB storage budget and creates stale-progress-on-reload bugs. Persist only terminal results |
| Threshold tweaks (`MIN_CONFIDENCE` broadening) to force matches | Masks the canonicalization bug with false positives; v1.0's REL-01 proved diagnose-the-root-cause beats force-display |
| Backend/API-key-based entity resolution | Hard constraint: 100% client-side, no API keys |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CORR-01 | Phase 14 | Pending |
| CORR-02 | Phase 14 | Pending |
| CORR-03 | Phase 14 | Pending |
| CORR-04 | Phase 14 | Pending |
| MLPROG-01 | Phase 15 | Pending |
| MLPROG-02 | Phase 15 | Pending |
| TRIG-01 | Phase 16 | Pending |
| TRIG-02 | Phase 16 | Pending |
| TRIG-03 | Phase 16 | Pending |
| TRIG-04 | Phase 16 | Pending |

**Coverage:**
- v0.1.6 requirements: 10 total
- Mapped to phases: 10
- Unmapped: 0 ✓

---
*Requirements defined: 2026-08-27*
*Last updated: 2026-08-27 at milestone start*