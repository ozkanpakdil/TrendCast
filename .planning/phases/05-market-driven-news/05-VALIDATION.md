---
phase: 5
slug: market-driven-news
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-23
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` (project root) |
| **Quick run command** | `bun run test` |
| **Full suite command** | `bun run test:all` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun run test`
- **After every plan wave:** Run `bun run test:all`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 5-01-01 | 01 | 1 | MKT-02 | T-05-01 / — | N/A | unit | `bun run test -- tests/unit/taxonomy.test.ts` | ❌ W0 | ⬜ pending |
| 5-01-02 | 01 | 1 | MKT-02 | T-05-02 / — | N/A | unit | `bun run test -- tests/unit/taxonomy.test.ts && bun run typecheck` | ❌ W0 | ⬜ pending |
| 5-02-01 | 02 | 2 | MKT-01 | T-05-03 / — | N/A | unit | `bun run test -- tests/unit/correlation-news.test.ts` | ❌ W0 | ⬜ pending |
| 5-02-02 | 02 | 2 | MKT-01 | T-05-04 / — | N/A | unit | `bun run typecheck` | ❌ W0 | ⬜ pending |
| 5-03-01 | 03 | 3 | MKT-01 | T-05-05 / — | N/A | unit | `bun run typecheck` | ❌ W0 | ⬜ pending |
| 5-03-02 | 03 | 3 | MKT-01 | T-05-06 / — | N/A | unit | `bun run typecheck` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/taxonomy.test.ts` — stubs for MKT-02 (classifyCategory precedence + mutual exclusivity + finance fallback)
- [ ] `tests/unit/correlation-news.test.ts` — stubs for MKT-01 (notable filter, direction, category grouping, sort, cap, watchlist, backfill)
- [ ] `tests/unit/fixtures.ts` — shared `MarketContract`/`NewsItem`/`NewsCorrelationMatch` fixtures + `newsMatch()` helper

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| "📰 Market News" dashboard tab renders the grouped-by-category view with direction badges | MKT-01 | Requires a real extension context; `chrome.storage.onChanged` + React render | Load the built extension in Chrome AND Firefox; run a correlation; open the dashboard and verify the Market News tab shows notable markets grouped by category with ▲/▼/◆ direction badges |
| Snapshot rebuild after each correlation completes | MKT-01 | Requires a live MV3 service worker | Trigger a correlation, verify the `trendcast:market-news-view` storage key updates and the dashboard reflects the new snapshot without a manual refresh |
| `VirtualizedGrid` responsiveness with large per-category lists | MKT-01 | Requires a real browser with a large dataset | Seed many correlated news items; verify the Market News tab scrolls smoothly without layout jank |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** {pending / approved YYYY-MM-DD}
