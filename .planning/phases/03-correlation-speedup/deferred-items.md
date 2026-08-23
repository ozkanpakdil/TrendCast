# Deferred Items — Phase 03

Out-of-scope discoveries logged during execution. These are NOT fixed by the
executor (scope boundary rule) — they are surfaced for a later plan or the
phase owner.

| Item | Found In | Description | Status |
|------|----------|-------------|--------|
| Unused `toIndexable` helper | `tests/unit/index.test.ts:28` | `toIndexable` is declared but never read → `tsc --noEmit` fails with `TS6133`. Pre-existing from plan 03-01; not in plan 03-02 scope. | open |
