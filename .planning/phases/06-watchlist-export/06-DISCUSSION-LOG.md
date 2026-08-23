# Phase 6: Watchlist & Export - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-23
**Phase:** 06-watchlist-export
**Areas discussed:** Export format, Sort & filter controls, Correlation badge, Schema migration

---

## Export Format

| Option | Description | Selected |
|--------|-------------|----------|
| Append-only sections | Keep existing CSV/JSON sections byte-identical; ADD new sections at the end | ✓ |
| Extend existing columns | Add new columns to existing sections | |
| Hybrid | Both — append new sections AND add category column | |

**User's choice:** Append-only sections

| Option | Description | Selected |
|--------|-------------|----------|
| TikTok + Market-Driven sections | Add both new sections | |
| TikTok only | Only TikTok signals section | |
| Market-Driven only | Only market-driven categories section | ✓ |

**User's choice:** Market-Driven only (TikTok collector is Phase 7, so TikTok signals don't exist yet)

| Option | Description | Selected |
|--------|-------------|----------|
| Export derived snapshot | Export marketNewsView snapshot as new section | |
| Category on news rows | Add category column to existing News section | ✓ |
| Both | Both approaches | |

**User's choice:** Category on news rows

| Option | Description | Selected |
|--------|-------------|----------|
| Append category column to News | Add category as trailing column at end of News section | ✓ |
| Separate section instead | Keep News byte-identical; separate Market-Driven section | |
| Both | Category column AND separate section | |

**User's choice:** Append category column to News (backward-compatible for positional readers)

**Notes:** User reconciled "append-only" with "category on news rows" by choosing to append category as a trailing column to the existing News section — existing columns stay in the same order/position.

---

## Sort & Filter Controls

| Option | Description | Selected |
|--------|-------------|----------|
| Sort + filter controls | Sort by addedAt/volume/price/confidence; filter by platform/has-correlation | ✓ |
| Sort only | Only sort controls | |
| Filter only | Only filter controls | |

**User's choice:** Sort + filter controls

| Option | Description | Selected |
|--------|-------------|----------|
| addedAt/volume/price/confidence + platform/has-corr | Full dimension set | |
| Minimal set | Sort by addedAt/volume only, filter by platform only | ✓ |
| You decide | Agent discretion | |

**User's choice:** Minimal set (sort by addedAt/volume, filter by platform)

**Notes:** User chose the minimal sort/filter set — no price-delta or correlation-confidence sort, no has-correlation filter in this phase.

---

## Correlation Badge

| Option | Description | Selected |
|--------|-------------|----------|
| Status + direction badge | none / has-correlation with direction bull/bear/mixed | ✓ |
| Simple has-correlation | Only a simple indicator | |
| Direction + confidence | Direction + confidence score inline | |

**User's choice:** Status + direction badge

**Notes:** Reuses alert direction logic from Phase 4.

---

## Schema Migration

| Option | Description | Selected |
|--------|-------------|----------|
| Version + backfill on read | Add version field + backfill missing fields | ✓ |
| No migration (derive at render) | New fields derived at render time | |
| You decide | Agent discretion | |

**User's choice:** Version + backfill on read

**Notes:** Old stored data loads without crashing.

---

## the agent's Discretion

The agent has discretion on: exact badge styling, sort/filter UI placement, the `WatchlistEntry` version field name/value, and the backfill logic.

## Deferred Ideas

- TikTok signals export section — deferred to Phase 7 (collector doesn't exist yet).
- Price-delta / correlation-confidence sort, has-correlation filter — deferred (minimal set chosen).
