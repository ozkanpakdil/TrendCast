/**
 * Unit tests for the correlation persistence write-policy helpers
 * (Phase 16, TRIG-01).
 *
 * Verified behaviors:
 * - stampCorrelationResult adds computedAt/model/inputCounts without mutating its input.
 * - persistCorrelationResult enforces the write policy:
 *     success overwrites anything unless a non-error with strictly newer computedAt exists;
 *     error overwrites only absent/corrupt/error; error NEVER displaces a non-error.
 * - hasFreshAnalysis treats error results as "no analysis" (never suppresses auto-run).
 * - readStoredAnalysis degrades corrupt/absent/wrong-shaped data to null, never throws.
 * - shouldTriggerReanalysis (Phase 16, TRIG-03) guards the snapshot-trigger:
 *     live/queued runs suppress; missing snapshots arm nothing; absent/error/
 *     legacy stored results always re-run; a good result suppresses only when
 *     its computedAt is at least the snapshot's collectedAt.
 */

import { describe, it, expect } from 'vitest';
import type { CorrelationResult } from '@/types';
import {
  stampCorrelationResult,
  persistCorrelationResult,
  hasFreshAnalysis,
  readStoredAnalysis,
  shouldTriggerReanalysis,
} from '@/utils/correlation-persistence';

/** In-memory SettingsStorage mock (copied from tests/unit/ml-run-queue.test.ts). */
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

const KEY = 'trendcast:correlations';

/** A minimal non-error correlation result. */
function goodResult(overrides: Partial<CorrelationResult> = {}): CorrelationResult {
  return {
    matches: [],
    newsMatches: [],
    newsSocialMatches: [],
    newsNewsMatches: [],
    engine: 'heuristic',
    ...overrides,
  };
}

/** A minimal error correlation result. */
function errorResult(overrides: Partial<CorrelationResult> = {}): CorrelationResult {
  return {
    matches: [],
    newsMatches: [],
    newsSocialMatches: [],
    newsNewsMatches: [],
    engine: 'heuristic',
    error: 'engine failed',
    ...overrides,
  };
}

describe('stampCorrelationResult', () => {
  it('adds a numeric computedAt plus model plus inputCounts and does not mutate its input', () => {
    const input = goodResult();
    const snapshot = JSON.stringify(input);
    const stamped = stampCorrelationResult(input, {
      engine: 'embedding',
      model: 'all-MiniLM-L6-v2',
      inputCounts: { markets: 2, signals: 3, news: 2 },
    });
    expect(typeof stamped.computedAt).toBe('number');
    expect(stamped.model).toBe('all-MiniLM-L6-v2');
    expect(stamped.inputCounts).toEqual({ markets: 2, signals: 3, news: 2 });
    // engine meta applies only when result.engine is undefined
    expect(stamped.engine).toBe('heuristic');
    // input untouched
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('applies meta.engine only when result.engine is undefined', () => {
    const stamped = stampCorrelationResult(goodResult(), { engine: 'embedding' });
    expect(stamped.engine).toBe('heuristic');
    const bare = stampCorrelationResult({ ...goodResult(), engine: undefined }, { engine: 'embedding' });
    expect(bare.engine).toBe('embedding');
  });
});

describe('persistCorrelationResult write policy', () => {
  it('success over absent returns true and stores', async () => {
    const storage = mockStorage();
    const ok = await persistCorrelationResult(storage, KEY, goodResult());
    expect(ok).toBe(true);
    const stored = await readStoredAnalysis(storage, KEY);
    expect(stored).not.toBeNull();
    expect(stored?.error).toBeUndefined();
  });

  it('success over stored error returns true', async () => {
    const storage = mockStorage();
    await persistCorrelationResult(storage, KEY, errorResult());
    const ok = await persistCorrelationResult(storage, KEY, goodResult());
    expect(ok).toBe(true);
    expect((await readStoredAnalysis(storage, KEY))?.error).toBeUndefined();
  });

  it('success over stored success with older computedAt returns true', async () => {
    const storage = mockStorage();
    await persistCorrelationResult(storage, KEY, goodResult({ computedAt: 1000 }));
    const ok = await persistCorrelationResult(storage, KEY, goodResult({ computedAt: 2000 }));
    expect(ok).toBe(true);
    expect((await readStoredAnalysis(storage, KEY))?.computedAt).toBe(2000);
  });

  it('success over stored success with strictly newer computedAt returns false and keeps the stored value', async () => {
    const storage = mockStorage();
    await persistCorrelationResult(storage, KEY, goodResult({ computedAt: 5000 }));
    const ok = await persistCorrelationResult(storage, KEY, goodResult({ computedAt: 2000 }));
    expect(ok).toBe(false);
    expect((await readStoredAnalysis(storage, KEY))?.computedAt).toBe(5000);
  });

  it('error over absent returns true', async () => {
    const storage = mockStorage();
    const ok = await persistCorrelationResult(storage, KEY, errorResult());
    expect(ok).toBe(true);
    expect((await readStoredAnalysis(storage, KEY))?.error).toBe('engine failed');
  });

  it('error over stored error returns true', async () => {
    const storage = mockStorage();
    await persistCorrelationResult(storage, KEY, errorResult({ error: 'first' }));
    const ok = await persistCorrelationResult(storage, KEY, errorResult({ error: 'second' }));
    expect(ok).toBe(true);
    expect((await readStoredAnalysis(storage, KEY))?.error).toBe('second');
  });

  it('error over stored non-error returns false AND the stored value is unchanged', async () => {
    const storage = mockStorage();
    const storedGood = goodResult({ computedAt: 1000 });
    await persistCorrelationResult(storage, KEY, storedGood);
    const ok = await persistCorrelationResult(storage, KEY, errorResult({ error: 'boom' }));
    expect(ok).toBe(false);
    const stored = await readStoredAnalysis(storage, KEY);
    expect(stored?.error).toBeUndefined();
    expect(stored?.computedAt).toBe(1000);
  });

  it('a storage failure returns false instead of throwing', async () => {
    const failingStorage = {
      get: async () => ({}),
      set: async () => {
        throw new Error('storage blew up');
      },
    };
    const ok = await persistCorrelationResult(failingStorage, KEY, goodResult());
    expect(ok).toBe(false);
  });
});

describe('hasFreshAnalysis', () => {
  it('returns false for null and undefined', () => {
    expect(hasFreshAnalysis(null)).toBe(false);
    expect(hasFreshAnalysis(undefined)).toBe(false);
  });

  it('returns false for an error result', () => {
    expect(hasFreshAnalysis(errorResult())).toBe(false);
  });

  it('returns true for a good result', () => {
    expect(hasFreshAnalysis(goodResult({ computedAt: Date.now() }))).toBe(true);
  });

  it('returns true for a legacy good result lacking computedAt', () => {
    expect(hasFreshAnalysis(goodResult())).toBe(true);
  });
});

describe('readStoredAnalysis corrupt tolerance', () => {
  it('returns null for absent data', async () => {
    const storage = mockStorage();
    expect(await readStoredAnalysis(storage, KEY)).toBeNull();
  });

  it('returns null for a string', async () => {
    const storage = mockStorage();
    await storage.set({ [KEY]: 'garbage' });
    expect(await readStoredAnalysis(storage, KEY)).toBeNull();
  });

  it('returns null for an object whose matches is not an array', async () => {
    const storage = mockStorage();
    await storage.set({ [KEY]: { matches: 'nope' } });
    expect(await readStoredAnalysis(storage, KEY)).toBeNull();
  });

  it('returns the object for valid data', async () => {
    const storage = mockStorage();
    const valid = goodResult({ computedAt: 1234 });
    await storage.set({ [KEY]: valid });
    expect(await readStoredAnalysis(storage, KEY)).toEqual(valid);
  });
});

describe('shouldTriggerReanalysis', () => {
  const COLLECTED_AT = 10_000;
  const idle = { live: false, queued: false };

  it('returns false when a run is live', () => {
    expect(
      shouldTriggerReanalysis({
        liveness: { live: true, queued: false },
        stored: null,
        snapshotCollectedAt: COLLECTED_AT,
      }),
    ).toBe(false);
  });

  it('returns false when a run is queued', () => {
    expect(
      shouldTriggerReanalysis({
        liveness: { live: false, queued: true },
        stored: null,
        snapshotCollectedAt: COLLECTED_AT,
      }),
    ).toBe(false);
  });

  it('returns false when snapshotCollectedAt is null', () => {
    expect(shouldTriggerReanalysis({ liveness: idle, stored: null, snapshotCollectedAt: null })).toBe(false);
  });

  it('returns false when snapshotCollectedAt is undefined', () => {
    expect(shouldTriggerReanalysis({ liveness: idle, stored: null, snapshotCollectedAt: undefined })).toBe(false);
  });

  it('returns false when snapshotCollectedAt is not a finite number', () => {
    expect(shouldTriggerReanalysis({ liveness: idle, stored: null, snapshotCollectedAt: Number.NaN })).toBe(false);
  });

  it('returns true when no stored result exists and the snapshot is fresh', () => {
    expect(shouldTriggerReanalysis({ liveness: idle, stored: null, snapshotCollectedAt: COLLECTED_AT })).toBe(true);
    expect(shouldTriggerReanalysis({ liveness: idle, stored: undefined, snapshotCollectedAt: COLLECTED_AT })).toBe(true);
  });

  it('returns true when the stored result is an error and the snapshot is fresh', () => {
    expect(
      shouldTriggerReanalysis({
        liveness: idle,
        stored: errorResult({ computedAt: 5_000 }),
        snapshotCollectedAt: COLLECTED_AT,
      }),
    ).toBe(true);
  });

  it('returns true for a legacy stored result without computedAt', () => {
    expect(
      shouldTriggerReanalysis({ liveness: idle, stored: goodResult(), snapshotCollectedAt: COLLECTED_AT }),
    ).toBe(true);
  });

  it('returns true when stored computedAt is strictly older than collectedAt', () => {
    expect(
      shouldTriggerReanalysis({
        liveness: idle,
        stored: goodResult({ computedAt: 9_999 }),
        snapshotCollectedAt: COLLECTED_AT,
      }),
    ).toBe(true);
  });

  it('returns false when stored computedAt equals collectedAt', () => {
    expect(
      shouldTriggerReanalysis({
        liveness: idle,
        stored: goodResult({ computedAt: COLLECTED_AT }),
        snapshotCollectedAt: COLLECTED_AT,
      }),
    ).toBe(false);
  });

  it('returns false when stored computedAt is newer than collectedAt', () => {
    expect(
      shouldTriggerReanalysis({
        liveness: idle,
        stored: goodResult({ computedAt: 10_001 }),
        snapshotCollectedAt: COLLECTED_AT,
      }),
    ).toBe(false);
  });
});