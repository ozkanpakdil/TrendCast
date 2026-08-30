# Phase 16: Correlation Persistence & Analysis Triggers - Pattern Map

**Mapped:** 2026-08-29
**Files analyzed:** 8 (2 new, 6 modified)
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/utils/correlation-persistence.ts` (NEW) | utility | CRUD (storage read-modify-write) | `src/utils/ml-run-state.ts` | exact |
| `src/types/index.ts` (MODIFY) | model (types) | transform (optional-field extension) | same-file `CorrelationRunStats` (timestamp/engine/model fields) | exact |
| `src/background/index.ts` (MODIFY — 6 write sites + precompute try/catch) | service (MV3 SW controller) | event-driven + CRUD | Phase 15 marker wiring in the same file (`writeMlRunState`/`clearMlRunState` call sites) | exact |
| `src/dashboard/hooks/useCorrelations.ts` (MODIFY — add onChanged listeners) | hook (React) | event-driven (storage.onChanged) | `src/dashboard/hooks/useSnapshot.ts` | exact |
| `src/dashboard/App.tsx` (MODIFY — gate corrInitRef effect + header badge) | controller (React page) | request-response + event-driven | same-file socialHealth listener effect (lines 180-190) + `CorrelationPanel.tsx` `timeAgo` | exact |
| `tests/unit/correlation-persistence.test.ts` (NEW) | test (unit) | CRUD | `tests/unit/ml-run-queue.test.ts` "ml-run-state marker" describe block | exact |
| `tests/e2e/fixtures.ts` (MODIFY — seed `computedAt` in MOCK_CORRELATIONS) | test fixture | transform | existing `MOCK_CORRELATIONS` shape (same file) | exact |
| `tests/e2e/dashboard.spec.ts` (MODIFY — extend Correlations Tab block) | test (e2e) | request-response | existing "Dashboard — Correlations Tab" describe (same file, lines 532-580) | exact |

## Pattern Assignments

### `src/utils/correlation-persistence.ts` (utility, CRUD) — NEW

**Analog:** `src/utils/ml-run-state.ts` (Phase 15 — the established SettingsStorage-convention persistence helper; header comment even states the convention: "Storage I/O is extracted behind a narrow interface (v0.1.5 convention) so the helpers are unit-testable with an in-memory mock.")

**Module shape pattern** (`src/utils/ml-run-state.ts` lines 1-24):
```ts
/**
 * Persisted ML run-state marker (Phase 15, MLPROG-01).
 * ... [docstring explaining WHY + MV3 rationale] ...
 */

import type { SettingsStorage } from './settings';

export interface MlRunState {
  requestId: string;
  engine: string;
  model: string;
  /** Epoch ms when the run started. */
  startedAt: number;
}
```

**Read-with-corrupt-tolerance pattern** (`src/utils/ml-run-state.ts` lines 27-45) — copy this defensive shape for `readStoredAnalysis`:
```ts
/** Read the persisted run-state marker, or null when absent/corrupt. */
export async function readMlRunState(
  storage: SettingsStorage,
  key: string,
): Promise<MlRunState | null> {
  try {
    const result = await storage.get(key);
    const raw = result[key] as Partial<MlRunState> | undefined;
    if (!raw || typeof raw !== 'object' || typeof raw.requestId !== 'string' || !raw.requestId) {
      return null;
    }
    return {
      requestId: raw.requestId,
      engine: typeof raw.engine === 'string' ? raw.engine : 'unknown',
      model: typeof raw.model === 'string' ? raw.model : '',
      startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : 0,
    };
  } catch {
    return null;
  }
}
```

**Write/clear helper pattern** (`src/utils/ml-run-state.ts` lines 48-56):
```ts
/** Persist the run-state marker for an active run. */
export async function writeMlRunState(
  storage: SettingsStorage,
  key: string,
  state: MlRunState,
): Promise<void> {
  await storage.set({ [key]: state });
}

/** Clear the run-state marker (terminal path reached). */
export async function clearMlRunState(storage: SettingsStorage, key: string): Promise<void> {
  await storage.set({ [key]: null });
}
```

**The narrow storage interface to accept** (`src/utils/settings.ts` lines 19-25):
```ts
/**
 * Minimal storage abstraction satisfied structurally by `browser.storage.local`.
 * Kept narrow so the storage I/O helpers below are directly unit-testable with
 * an in-memory mock (no `vi.mock` of the messaging layer required).
 */
export interface SettingsStorage {
  get(keys: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}
```

**New-file guidance:** mirror ml-run-state.ts exactly — module docstring with phase tag + rationale, `import type { SettingsStorage } from './settings'`, exported pure-ish async helpers taking `(storage, key, ...)`. Proposed exports per RESEARCH R1: `stampCorrelationResult(result, meta)`, `persistCorrelationResult(storage, key, result)` (read-modify-write enforcing "error never displaces non-error"), `hasFreshAnalysis(stored)` (`!!stored && !stored.error`). Keep the write-policy decision table from RESEARCH Q5 in the docstring.

---

### `src/types/index.ts` (model, transform) — MODIFY

**Analog:** the interface being extended itself, plus the sibling `CorrelationRunStats` which already uses the exact field names/conventions to add.

**Type to extend** (`src/types/index.ts` lines 262-283, verbatim):
```ts
/** All correlation results from the engine. */
export interface CorrelationResult {
  requestId?: string;
  matches: CorrelationMatch[];
  newsMatches: NewsCorrelationMatch[];
  newsSocialMatches: NewsSocialCorrelationMatch[];
  /** CORR-06: news↔news matches (cross-source only). */
  newsNewsMatches: NewsNewsCorrelationMatch[];
  /**
   * Engine that produced these results.
   * If the requested engine failed, this will be the fallback engine used
   * (or 'heuristic' if no results were produced) and `error` will be set.
   */
  engine?: CorrelationEngine;
  /**
   * Error message if the requested correlation engine failed.
   * When set, the UI should show an error banner telling the user the
   * ML engine didn't work and suggesting they try a different engine
   * or switch to the heuristic engine.
   */
  error?: string;
}
```

**Field-naming convention to copy** (`src/types/index.ts` lines 286-296, `CorrelationRunStats` — note `timestamp: number` epoch-ms and `model: string` "empty for heuristic" doc phrasing):
```ts
export interface CorrelationRunStats {
  /** Epoch ms when the run completed. */
  timestamp: number;
  /** Engine that produced the results. */
  engine: CorrelationEngine;
  /** Model ID used (empty for heuristic). */
  model: string;
```

**Addition guidance:** append optional fields to `CorrelationResult` in the same doc-comment style — `computedAt?: number` ("Epoch ms when the result was persisted"), `model?: string` ("Model ID used (empty/omitted for heuristic)"), `inputCounts?: { markets: number; signals: number; news: number }`. All optional → old stored results stay valid (RESEARCH Pitfall 4). `CorrelationEngine` is already defined at line 167.

---

### `src/background/index.ts` (service, event-driven + CRUD) — MODIFY

**Analog:** the Phase 15 marker wiring already in this file — it shows exactly how a storage-helper module gets wired into terminal paths, including the non-fatal warn pattern.

**Site 1+2 — success & catch-path writes in `runCorrelationAsync`** (write at line 1056; catch-path construction + write at lines 1089-1100):
```ts
    const result = await runCorrelationWithEngine(markets, signals, news, engine, model, requestId);

    // Ensure requestId is preserved in the result for the UI
    if (result && !result.requestId) {
      result.requestId = requestId;
    }

    await browser.storage.local.set({ [CONFIG.storage.correlations]: result });
```
```ts
  } catch (err) {
    console.error(`[TrendCast] runCorrelationAsync FAILED:`, err);
    const errorResult: CorrelationResult = {
      matches: [],
      newsMatches: [],
      newsSocialMatches: [],
      newsNewsMatches: [],
      engine,
      requestId, // Phase 15: stamp the id so the UI can scope this terminal state
      error: err instanceof Error ? err.message : String(err),
    };
    await browser.storage.local.set({ [CONFIG.storage.correlations]: errorResult });
```
**Change:** replace both `browser.storage.local.set({ [CONFIG.storage.correlations]: … })` calls with `persistCorrelationResult(browser.storage.local, CONFIG.storage.correlations, stampedResult)`. Note the surrounding broadcast (`CORRELATION_RESULT` sendMessage) stays — the write-policy must not suppress the broadcast (RESEARCH Q5).

**Site 3 — ML-error return inside `runCorrelationWithEngine`** (lines ~1174-1176; persisted by site 1, so it inherits the helper automatically once site 1 routes through it):
```ts
      return { matches: [], newsMatches: [], newsSocialMatches: [], newsNewsMatches: [], engine, requestId, error: errorMsg };
```

**Site 4+5 — precompute write with NO local error handling** (`runCorrelationPrecompute`, def at line 1227, write at line 1241; the fire-and-forget call is at line 1000):
```ts
  const result = await runCorrelationWithEngine(markets, signals, news, engine, model, `precompute-${Date.now()}`);

  await browser.storage.local.set({ [CONFIG.storage.correlations]: result });
```
**Change:** wrap the body in try/catch (mirroring the `runCorrelationAsync` catch shape above) so a cancelled/thrown precompute also produces a terminal error-result write (RESEARCH Q1 site 5 — currently writes nothing), and route the write through the helper.

**Site 6 — SW-death recovery write that clobbers** (lines 340-362):
```ts
      const interruptedResult: CorrelationResult = {
        matches: [],
        newsMatches: [],
        newsSocialMatches: [],
        newsNewsMatches: [],
        engine: (marker.engine as CorrelationResult['engine']) ?? 'heuristic',
        requestId: marker.requestId,
        error: 'Correlation run was interrupted (browser stopped the background worker). Please run the analysis again.',
      };
      await browser.storage.local.set({ [CONFIG.storage.correlations]: interruptedResult });
      browser.runtime.sendMessage({
        type: 'CORRELATION_RESULT',
        payload: interruptedResult,
      }).catch(() => {});
```
**Change:** route the write through the helper (its error-vs-good policy fixes the clobber); keep the broadcast.

**Non-fatal storage I/O pattern to copy** (marker write in `runCorrelationAsync`, lines ~1032-1035):
```ts
  try {
    await writeMlRunState(browser.storage.local, CONFIG.storage.mlRunState, runState);
  } catch (err) {
    console.warn('[TrendCast] Failed to write ML run-state marker (non-fatal):', err);
  }
```

**Snapshot keys the TRIG-03 listener watches** (written at lines 981-982, verbatim):
```ts
  await browser.storage.local.set({
    [CONFIG.storage.latestSnapshot]: snapshot,
    [CONFIG.storage.lastCollectionAt]: snapshot.collectedAt,
  });
```

**Liveness source for the trigger guard** (`CORRELATION_RUN_STATE` handler, lines ~761-768):
```ts
  onMessage('CORRELATION_RUN_STATE', async (payload) => {
    const marker = await readMlRunState(browser.storage.local, CONFIG.storage.mlRunState);
    return {
      live: marker !== null,
      requestId: marker?.requestId ?? null,
      queued: payload.requestId ? mlRunQueue.isQueued(payload.requestId) : false,
      activeRequestId: mlRunQueue.activeRequestId,
    };
  });
```

**Input counts available at the choke point** (already logged in `runCorrelationAsync`, lines ~1043-1048):
```ts
    console.log('[TrendCast] runCorrelationAsync data:', {
      markets: markets.length,
      signals: signals.length,
      news: news.length,
    });
```

---

### `src/dashboard/hooks/useCorrelations.ts` (hook, event-driven) — MODIFY

**Analog:** `src/dashboard/hooks/useSnapshot.ts` — the canonical `storage.onChanged` listener (six in-repo precedents use this exact shape).

**Listener pattern to mirror verbatim** (`src/dashboard/hooks/useSnapshot.ts` lines 56-67):
```tsx
    // Listen for storage changes (background updates snapshot after collection).
    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      if (changes[CONFIG.storage.latestSnapshot]?.newValue) {
        setSnapshot(changes[CONFIG.storage.latestSnapshot].newValue as CollectionSnapshot);
      }
      if (changes[CONFIG.storage.lastCollectionAt]?.newValue) {
        setLastCollectionAt(changes[CONFIG.storage.lastCollectionAt].newValue as number);
      }
    };

    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
```

**Mount-load effect the `loaded` flag extends** (`src/dashboard/hooks/useCorrelations.ts` lines 109-124):
```ts
  // Load pre-computed correlations + run history from storage on mount.
  useEffect(() => {
    browser.storage.local
      .get([CONFIG.storage.correlations, CONFIG.storage.correlationRunHistory])
      .then((result) => {
        const cached = result[CONFIG.storage.correlations] as CorrelationResultType | undefined;
        if (cached && typeof cached === 'object' && 'matches' in cached) {
          setCorrelations(cached);
          setError(cached.error ?? null);
        }
        const history = result[CONFIG.storage.correlationRunHistory] as CorrelationRunStats[] | undefined;
        if (Array.isArray(history)) {
          setRunHistory(history);
        }
      })
      .catch((err) => console.error('[TrendCast] Failed to load cached correlations:', err));
  }, []);
```
**Change:** add a `loaded` state set in a `.finally()` (and expose it in the return object) so App.tsx can gate the auto-run on mount-read completion.

**The requestId guard the new listener MUST route through** (`applyResult`, lines 149-163 — RESEARCH Pitfall 5):
```ts
  const applyResult = useCallback((corrResult: CorrelationResultType): boolean => {
    if (!corrResult || typeof corrResult !== 'object' || !('matches' in corrResult)) {
      return false;
    }
    // Only apply if this result matches the current active request.
    // If the result carries a requestId and we have an active one, they
    // must match. A result without a requestId is accepted as a fallback.
    if (corrResult.requestId && requestIdRef.current && corrResult.requestId !== requestIdRef.current) {
      console.log('[TrendCast] [Dashboard] Ignoring stale result (requestId mismatch)');
      return false;
    }
```

**Existing poll fallback (do not duplicate its job — keep untouched)** (lines 231-243):
```ts
    const pollId = setInterval(async () => {
      try {
        const stored = await browser.storage.local.get(CONFIG.storage.correlations);
        const cached = stored[CONFIG.storage.correlations] as CorrelationResultType | undefined;
        if (cached && typeof cached === 'object' && 'matches' in cached) {
          // Only apply if it corresponds to the active request. Phase 15:
          // results without a requestId are only accepted when no run is
          // active — with an active id, an unstamped result belongs to some
          // other (older) run and must not settle this one.
          const activeId = requestIdRef.current;
          if (!activeId || (cached.requestId && cached.requestId === activeId)) {
            applyResultRef.current(cached);
          }
        }
```

**Liveness-check shape for the trigger guard** (lines 258-289 — shows how to call + unwrap `CORRELATION_RUN_STATE`):
```ts
        const resp = await sendMessage('CORRELATION_RUN_STATE', { requestId: activeId });
        if (cancelled) return;
        const unwrapped =
          resp && typeof resp === 'object' && 'ok' in resp
            ? (resp as { ok: boolean; data: { live: boolean; requestId: string | null; queued: boolean } }).data
            : (resp as { live: boolean; requestId: string | null; queued: boolean });
        const live = unwrapped?.live === true || unwrapped?.queued === true;
```

---

### `src/dashboard/App.tsx` (controller, request-response + event-driven) — MODIFY

**Analog:** two in-file precedents — the socialHealth storage listener (the App-local onChanged pattern) and the corrInitRef effect being modified.

**In-file onChanged precedent** (lines 180-190):
```tsx
    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      if (changes[key]?.newValue) {
        setSocialHealth(changes[key].newValue as SocialSourceHealth);
      }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
```

**The effect to gut/gate (TRIG-02 target)** (lines 199-215, verbatim):
```tsx
  const corrInitRef = useRef(false);
  useEffect(() => {
    // Only run once per dashboard session, and only if we have data
    if (corrInitRef.current) return;
    if (!snapshot) return;
    if (snapshot.markets.length === 0 && snapshot.signals.length === 0) return;
    corrInitRef.current = true;
    // Fire and forget — the hook loads cached results from storage first,
    // and this ensures a fresh computation in the background.
    const initModel =
      settings.correlationEngine === 'embedding' ? settings.embeddingModel
      : settings.correlationEngine === 'sentiment' ? settings.sentimentModel
      : settings.correlationEngine === 'ner' ? settings.nerModel
      : settings.correlationEngine === 'llm' ? settings.llmModel
      : settings.embeddingModel;
    runCorrelation(settings.correlationEngine, initModel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);
```
**Change:** keep the once-per-session ref + data guards, add the gate `loaded && !hasFreshAnalysis(correlations)` before `corrInitRef.current = true` / `runCorrelation(...)`. The `initModel` derivation chain above is the pattern to reuse for the gated run.

**Header row the TRIG-04 badge extends** (lines 468-476):
```tsx
              <section>
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h2 className={`text-sm font-bold uppercase tracking-wider ${sectionTitle}`}>
                    🔗 Correlated Signals & News
                  </h2>
                  <div className="flex items-center gap-2">
                    {/* Engine selector */}
                    <select
```
**Badge data source:** read `correlations.computedAt` / `correlations.engine` / `correlations.model` directly (NOT `runStats` — it stays null on cache-load; `CorrelationStatsBar` returns null when stats is null).

**Relative-time formatter to copy for the badge** (`src/dashboard/components/CorrelationPanel.tsx` lines 136-144 — do not invent a new one; same pattern also in `AlertsTab.tsx:31-32`):
```ts
/** Format relative time (e.g., "2h ago", "3d ago"). */
function timeAgo(epochMs: number): string {
  if (!epochMs) return '';
  const diff = Date.now() - epochMs;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
```
(Existing time-formatting precedents: `App.tsx:256` `toLocaleTimeString` for lastCollection, `CorrelationRunHistory.tsx:35` `formatTime`, `NewsFeed.tsx:55`.)

---

### `tests/unit/correlation-persistence.test.ts` (test, CRUD) — NEW

**Analog:** the "ml-run-state marker" describe in `tests/unit/ml-run-queue.test.ts` — plain in-memory `SettingsStorage` mock, no `vi.mock` needed (RESEARCH Q7 calls this "best fit for the persist helper").

**Mock + round-trip test pattern** (`tests/unit/ml-run-queue.test.ts` lines 130-152):
```ts
describe('ml-run-state marker', () => {
  /** In-memory SettingsStorage mock. */
  function mockStorage() {
    const map = new Map<string, unknown>();
    return {
      get: async (key: string) => (map.has(key) ? { [key]: map.get(key) } : {}),
      set: async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) map.set(k, v);
      },
      peek: (key: string) => map.get(key),
    };
  }
  const KEY = 'trendcast:ml-run-state';

  it('round-trips write → read → clear', async () => {
    const storage = mockStorage();
    const state: MlRunState = { requestId: 'corr-123', engine: 'embedding', model: 'm', startedAt: 1000 };
    await writeMlRunState(storage, KEY, state);
    expect(await readMlRunState(storage, KEY)).toEqual(state);
    await clearMlRunState(storage, KEY);
    expect(await readMlRunState(storage, KEY)).toBeNull();
  });

  it('returns null for absent or corrupt markers', async () => {
```

**Handler-level alternative (if precompute-persist needs the messaging layer)** — `tests/unit/alerts.test.ts` lines 24-58 mock `@/messaging/browser` with an in-memory `store` Map:
```ts
vi.mock('@/messaging/browser', () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const out: Record<string, unknown> = {};
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) out[k] = store.get(k);
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        }),
      },
    },
    ...
    runtime: {
      sendMessage: vi.fn(async (msg: unknown) => {
        sentMessages.push(msg);
      }),
```
**Test-file header convention** (alerts.test.ts lines 1-9): block comment listing verified behaviors, then `import { describe, it, expect, beforeEach, vi } from 'vitest'`. Run via `bun run test -- --run tests/unit/correlation-persistence.test.ts` (Bun only — never npm/npx).

---

### `tests/e2e/fixtures.ts` + `tests/e2e/dashboard.spec.ts` (test fixtures/e2e) — MODIFY

**Analog:** the existing `MOCK_CORRELATIONS` fixture and Correlations Tab describe block in the same files.

**Fixture to extend** (`tests/e2e/fixtures.ts` lines 212-247, `MOCK_CORRELATIONS` — currently has NO `computedAt`; add `computedAt: Date.now()`, `engine`, `model`, `inputCounts` at the top level of the object):
```ts
export const MOCK_CORRELATIONS = {
  matches: [
    {
      contract: MOCK_SNAPSHOT.markets[0],
      signal: MOCK_SNAPSHOT.signals[0],
      confidence: 0.82,
      matchedKeywords: ['btc', 'bitcoin'],
      correlatedAt: Date.now(),
    },
    ...
```
It is already seeded into storage at `fixtures.ts:273` (`'trendcast:correlations': MOCK_CORRELATIONS`), `storage.onChanged` is already mocked (`fixtures.ts:357-360, 436`), and `CORRELATE_ALL` is already canned (`fixtures.ts:378`).

**Spec block to extend** (`tests/e2e/dashboard.spec.ts` lines 532-580, "Dashboard — Correlations Tab" — follow its openDashboard → click Correlations → waitForTimeout(500) → expect rhythm):
```ts
test.describe('Dashboard — Correlations Tab', () => {
  test('displays correlation section heading', async ({ page }) => {
    await openDashboard(page);
    await page.locator('nav button', { hasText: 'Correlations' }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('main')).toContainText(/Correlated Signals/i);
  });
```
New tests per RESEARCH test map: "shows cached results without auto-analyze" (assert no `CORRELATE_ALL` sent on load with seeded cache) and "header shows computedAt + engine".

---

## Shared Patterns

### Narrow SettingsStorage interface (v0.1.5 convention)
**Source:** `src/utils/settings.ts` lines 19-25 (interface), proven by `src/utils/ml-run-state.ts`
**Apply to:** `src/utils/correlation-persistence.ts` (NEW) and its unit test
```ts
export interface SettingsStorage {
  get(keys: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}
```
Helpers take `storage: SettingsStorage` as first param; call sites pass `browser.storage.local` (structurally satisfied).

### Corrupt-tolerant storage reads
**Source:** `src/utils/ml-run-state.ts` lines 27-45 (`readMlRunState`)
**Apply to:** `readStoredAnalysis` in the new persistence helper; any new reader of the correlations key
```ts
  try {
    const result = await storage.get(key);
    const raw = result[key] as Partial<MlRunState> | undefined;
    if (!raw || typeof raw !== 'object' || typeof raw.requestId !== 'string' || !raw.requestId) {
      return null;
    }
    ...
  } catch {
    return null;
  }
```
Corrupt data degrades to "no analysis" — never throws into the UI.

### storage.onChanged listener (add + cleanup in one effect)
**Source:** `src/dashboard/hooks/useSnapshot.ts` lines 56-67 (canonical; also `App.tsx:180-190`, `useMarketNews.ts:31-42`, `HistoryChart.tsx:102`, `MarketOdds.tsx:122`, `Watchlist.tsx:91`)
**Apply to:** `useCorrelations.ts` — one listener handling `CONFIG.storage.correlations` (display refresh via `applyResultRef.current`, preserving the requestId guard) and the snapshot keys (`latestSnapshot`/`lastCollectionAt`, guarded trigger)
```tsx
    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      if (changes[CONFIG.storage.latestSnapshot]?.newValue) { /* ... */ }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
```
Note: every existing usage ignores the `areaName` argument (all writes are to `local`).

### Non-fatal storage I/O error handling
**Source:** `src/background/index.ts` lines 1032-1035 (marker write) and 364-366 (recovery catch)
**Apply to:** all six rerouted write sites + the new precompute try/catch
```ts
  try {
    await writeMlRunState(browser.storage.local, CONFIG.storage.mlRunState, runState);
  } catch (err) {
    console.warn('[TrendCast] Failed to write ML run-state marker (non-fatal):', err);
  }
```
Convention: `console.warn` + `[TrendCast]` prefix for non-fatal; `console.error` for terminal failures. A persistence failure must never break the run's terminal path (broadcast still fires).

### requestId-scoped result application
**Source:** `src/dashboard/hooks/useCorrelations.ts` lines 149-163 (`applyResult` guard) + poll guard at 238-243
**Apply to:** the new correlations-key onChanged listener — route through `applyResultRef.current(...)`; never `setCorrelations` directly from the listener (would resurrect cross-run clobbering, RESEARCH Pitfall 5).

### Unit-test storage mocking (two tiers)
**Source:** plain mock — `tests/unit/ml-run-queue.test.ts` lines 131-139; full runtime mock — `tests/unit/alerts.test.ts` lines 24-58
**Apply to:** `tests/unit/correlation-persistence.test.ts` (plain mock, preferred — no `vi.mock` needed for SettingsStorage-convention helpers); escalate to the `vi.mock('@/messaging/browser')` pattern only if a test must exercise background handler code paths.
```ts
  function mockStorage() {
    const map = new Map<string, unknown>();
    return {
      get: async (key: string) => (map.has(key) ? { [key]: map.get(key) } : {}),
      set: async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) map.set(k, v);
      },
      peek: (key: string) => map.get(key),
    };
  }
```

### Relative-time formatting (TRIG-04 badge)
**Source:** `src/dashboard/components/CorrelationPanel.tsx` lines 136-144 (`timeAgo`); sibling `AlertsTab.tsx:31-32` (`relativeTime`)
**Apply to:** the App.tsx correlations header badge. Both are private per-component functions today — either copy the 9-line helper into App.tsx (consistent with current per-component style) or lift it; do not add a dependency.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none — all files have analogs) | | | |

**Partial-analog note:** the TRIG-03 trigger *guard decision* (skip when `CORRELATION_RUN_STATE` reports live/queued; skip when `computedAt >= snapshot.collectedAt`) has no single-file analog — it is new pure logic. Build it as an extracted pure function in `src/utils/correlation-persistence.ts` (testable with the ml-run-queue mock pattern), composing the liveness shape from the `CORRELATION_RUN_STATE` handler (`src/background/index.ts:761-768`) and the freshness predicate `hasFreshAnalysis`. Do not inline it in the hook effect (hook tests don't exist — no `@testing-library/react`; RESEARCH Q7).

## Metadata

**Analog search scope:** `src/utils/`, `src/background/`, `src/dashboard/hooks/`, `src/dashboard/components/`, `src/dashboard/App.tsx`, `src/types/`, `src/config/`, `tests/unit/`, `tests/e2e/`
**Files read this session:** 12 (`16-RESEARCH.md`, `ml-run-state.ts`, `settings.ts`, `useSnapshot.ts`, `background/index.ts` ×2 ranges, `useCorrelations.ts`, `types/index.ts`, `App.tsx` ×2 ranges, `ml-run-queue.test.ts`, `alerts.test.ts`, `fixtures.ts`, `dashboard.spec.ts`, `CorrelationPanel.tsx`) + grep sweeps for write sites, onChanged precedents, and time formatters
**Pattern extraction date:** 2026-08-29
**Conventions respected:** TypeScript 5.9.3 strict, React 18, Vitest 2.1.9 via Bun (never npm/npx), no git commits (user handles), `[TrendCast]` log prefix, phase-tagged comments (`// Phase 15 (MLPROG-01): …` style → use `// Phase 16 …`)