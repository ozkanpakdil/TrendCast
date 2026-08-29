import { describe, it, expect } from 'vitest';
import { MlRunQueue, ML_RUN_CANCELLED_MESSAGE } from '@/utils/ml-run-queue';
import {
  readMlRunState,
  writeMlRunState,
  clearMlRunState,
  isOrphanedRunState,
  type MlRunState,
} from '@/utils/ml-run-state';

/** Deferred promise helper — lets tests control when a run settles. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (err: Error) => void } {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('MlRunQueue', () => {
  it('runs a single entry immediately', async () => {
    const queue = new MlRunQueue();
    const d = deferred();
    let ran = false;
    queue.enqueue({ requestId: 'a', run: () => d.promise.then(() => { ran = true; }), reject: () => {} });
    expect(queue.activeRequestId).toBe('a');
    expect(queue.isQueued('a')).toBe(true);
    d.resolve();
    await d.promise;
    await new Promise((r) => setTimeout(r, 0));
    expect(ran).toBe(true);
    expect(queue.activeRequestId).toBe(null);
    expect(queue.isQueued('a')).toBe(false);
  });

  it('serializes overlapping runs in FIFO order', async () => {
    const queue = new MlRunQueue();
    const order: string[] = [];
    const da = deferred();
    const db = deferred();

    queue.enqueue({ requestId: 'a', run: () => da.promise.then(() => { order.push('a'); }), reject: () => {} });
    queue.enqueue({ requestId: 'b', run: () => db.promise.then(() => { order.push('b'); }), reject: () => {} });

    // Only 'a' is active; 'b' waits.
    expect(queue.activeRequestId).toBe('a');
    expect(queue.queuedRequestIds).toEqual(['b']);
    expect(queue.isQueued('b')).toBe(true);

    da.resolve();
    await da.promise;
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(['a']);
    expect(queue.activeRequestId).toBe('b');

    db.resolve();
    await db.promise;
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(['a', 'b']);
    expect(queue.activeRequestId).toBe(null);
  });

  it('advances the queue when the active run rejects', async () => {
    const queue = new MlRunQueue();
    const da = deferred();
    const started = deferred();
    queue.enqueue({ requestId: 'a', run: () => da.promise, reject: () => {} });
    queue.enqueue({ requestId: 'b', run: () => started.promise, reject: () => {} });

    da.reject(new Error('boom'));
    await new Promise((r) => setTimeout(r, 0));
    expect(queue.activeRequestId).toBe('b');
    started.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(queue.activeRequestId).toBe(null);
  });

  it('cancel on a queued entry rejects it and removes it from the queue', async () => {
    const queue = new MlRunQueue();
    const da = deferred();
    let bError: Error | undefined;
    queue.enqueue({ requestId: 'a', run: () => da.promise, reject: () => {} });
    queue.enqueue({
      requestId: 'b',
      run: () => Promise.resolve(),
      reject: (err) => { bError = err; },
    });

    const cancelled = queue.cancel('b');
    expect(cancelled).toBe(true);
    expect(bError).toBeInstanceOf(Error);
    expect(bError?.message).toBe(ML_RUN_CANCELLED_MESSAGE);
    expect(queue.queuedRequestIds).toEqual([]);
  });

  it('cancel on the active run returns false (caller owns worker termination)', async () => {
    const queue = new MlRunQueue();
    const da = deferred();
    queue.enqueue({ requestId: 'a', run: () => da.promise, reject: () => {} });
    expect(queue.cancel('a')).toBe(false);
    da.resolve();
  });

  it('cancel on an unknown id returns false', () => {
    const queue = new MlRunQueue();
    expect(queue.cancel('nope')).toBe(false);
  });

  it('a rejected queued run does not produce an unhandled rejection', async () => {
    const queue = new MlRunQueue();
    const da = deferred();
    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown) => unhandled.push(err);
    process.on('unhandledRejection', onUnhandled);

    queue.enqueue({ requestId: 'a', run: () => da.promise, reject: () => {} });
    queue.enqueue({ requestId: 'b', run: () => Promise.reject(new Error('b failed')), reject: () => {} });

    da.resolve();
    await new Promise((r) => setTimeout(r, 10));
    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toEqual([]);
    expect(queue.activeRequestId).toBe(null);
  });
});

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
    const storage = mockStorage();
    expect(await readMlRunState(storage, KEY)).toBeNull();
    await storage.set({ [KEY]: 'garbage' });
    expect(await readMlRunState(storage, KEY)).toBeNull();
    await storage.set({ [KEY]: { engine: 'embedding' } }); // no requestId
    expect(await readMlRunState(storage, KEY)).toBeNull();
  });

  it('isOrphanedRunState distinguishes present vs cleared markers', () => {
    expect(isOrphanedRunState(null)).toBe(false);
    expect(isOrphanedRunState({ requestId: 'corr-1', engine: 'llm', model: 'm', startedAt: 0 })).toBe(true);
  });
});