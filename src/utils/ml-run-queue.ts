/**
 * Serialized ML run queue (Phase 15, MLPROG-01).
 *
 * The background's ML worker previously kept a single module-level resolver
 * pair (`mlWorkerResolvers` / `mlWorkerRequestId`). Two overlapping runs —
 * e.g. a dashboard `corr-*` request and a post-collection `precompute-*`
 * request — overwrote each other's resolvers, so the first worker message
 * settled the wrong promise and one run's UI never reached a terminal state.
 *
 * This queue serializes runs: FIFO, exactly one active run, queued entries
 * start when the active one settles. It is framework-free (no browser APIs)
 * so it is directly unit-testable.
 */

export interface MlRunEntry {
  /** Unique id shared with the UI (`corr-*` / `precompute-*`). */
  requestId: string;
  /** Starts the run. The queue awaits this promise before dequeuing the next entry. */
  run: () => Promise<void>;
  /** Rejects the caller's promise when a queued entry is cancelled. */
  reject: (err: Error) => void;
}

/** Error message used when a queued run is cancelled before starting. */
export const ML_RUN_CANCELLED_MESSAGE = 'Correlation cancelled by user.';

export class MlRunQueue {
  private queue: MlRunEntry[] = [];
  private active: MlRunEntry | null = null;

  /** requestId of the currently running entry, or null when idle. */
  get activeRequestId(): string | null {
    return this.active?.requestId ?? null;
  }

  /** Queued (waiting) requestIds — excludes the active run. */
  get queuedRequestIds(): string[] {
    return this.queue.map((e) => e.requestId);
  }

  /** True when the id is the active run or is waiting in the queue. */
  isQueued(requestId: string): boolean {
    return this.active?.requestId === requestId || this.queue.some((e) => e.requestId === requestId);
  }

  /**
   * Add a run. Starts immediately when the queue is idle; otherwise waits
   * its turn. The entry's `run()` is always awaited — its rejection is
   * swallowed by the queue (the entry's own caller already handles it via
   * the returned promise) so an unhandled rejection never escapes.
   */
  enqueue(entry: MlRunEntry): void {
    this.queue.push(entry);
    this.pump();
  }

  /**
   * Cancel a run.
   *
   * - Queued entry → removed and rejected with the cancelled error; returns true.
   * - Active run → returns false; cancellation is the caller's job (worker
   *   termination), the queue only advances when the run settles.
   * - Unknown id → returns false.
   */
  cancel(requestId: string): boolean {
    if (this.active?.requestId === requestId) {
      return false; // caller terminates the worker; queue advances on settle
    }
    const idx = this.queue.findIndex((e) => e.requestId === requestId);
    if (idx === -1) return false;
    const [entry] = this.queue.splice(idx, 1);
    entry.reject(new Error(ML_RUN_CANCELLED_MESSAGE));
    return true;
  }

  /** Start the next run if idle and something is waiting. */
  private pump(): void {
    if (this.active || this.queue.length === 0) return;
    const entry = this.queue.shift()!;
    this.active = entry;
    void entry.run()
      .catch(() => {
        // The entry's caller owns error handling (its promise already
        // rejected). Swallow here so the queue never produces an
        // unhandled rejection while advancing.
      })
      .finally(() => {
        this.active = null;
        this.pump();
      });
  }
}