# 06-03 SUMMARY — Export coverage (D-01, D-02, D-03)

**Status:** Complete
**Plan:** 06-03 (wave 2, depends 06-01)
**Requirement:** DASH-02

## What was done

Added `category` as a trailing column on the existing `# News` CSV section and as a field on news objects in the JSON export, keeping the export backward-compatible (append-only).

### Files changed
- `src/utils/export.ts` — `# News` section now maps `category: n.category ?? ''` and appends `'category'` as the last header column. JSON export already carries `category` via `ExportData.news` (`NewsItem[]`).
- `tests/unit/export.test.ts` — **new**: 9 tests (trailing column, category value, missing-category empty string, backward-compat headers for all 5 sections, JSON category, no market-driven section).

## Verification
- `bun run test -- tests/unit/export.test.ts` — **9/9 pass**
- Full suite: **233/233 pass** (19 files)
- `bun run typecheck` — **clean**

## Decisions honored
- **D-01**: backward-compatible export — existing sections/columns unchanged, append-only.
- **D-02**: `category` trailing column on `# News` CSV + JSON field.
- **D-03**: no separate `# Market-Driven News` section; TikTok export deferred to Phase 7.

## Reversibility
- Task 1 (export change): costly — adds a trailing column to `# News` (header-aware readers see a new column; positional readers unaffected).
- Task 2 (regression test): reversible — test-only.
