/**
 * Correlation result persistence with freshness metadata and a clobber-proof
 * write policy (Phase 16, TRIG-01).
 *
 * Every terminal correlation run path (success, ML error, cancel, precompute
 * success/error/throw, SW-death recovery) persists its result to
 * CONFIG.storage.correlations through persistCorrelationResult. The helper
 * enforces this decision table:
 *
 * | incoming | stored            | action                                   |
 * |----------|-------------------|------------------------------------------|
 * | success  | absent/corrupt    | write                                    |
 * | success  | error             | write                                    |
 * | success  | success (older)   | write                                    |
 * | success  | success (newer)   | skip — keep the genuinely newer result   |
 * | error    | absent/corrupt    | write                                    |
 * | error    | error             | write                                    |
 * | error    | success           | SKIP — never displace a good result      |
 *
 * An error result never overwrites a stored non-error result; the
 * CORRELATION_RESULT broadcast still happens at the call site so the active
 * run's UI settles. A persisted error result counts as "no analysis" for the
 * auto-run gate (hasFreshAnalysis), so it never suppresses future
 * auto-analysis.
 *
 * Re-analysis trigger (Phase 16, TRIG-03) — shouldTriggerReanalysis decides
 * whether a collection completion (a snapshot-key storage change) should
 * re-run correlation analysis in the open dashboard:
 *
 * | liveness       | stored result            | snapshotCollectedAt | trigger? |
 * |----------------|--------------------------|---------------------|----------|
 * | live or queued | anything                 | anything            | no — never double-run the ML engine |
 * | idle           | anything                 | missing/non-finite  | no — an empty/missing snapshot arms nothing |
 * | idle           | absent or error          | finite              | yes — new data with no good analysis |
 * | idle           | legacy (no computedAt)   | finite              | yes — a legacy result never suppresses a re-run |
 * | idle           | computedAt < collectedAt | finite              | yes — the stored result predates the collection |
 * | idle           | computedAt >= collectedAt | finite             | no — already at least as fresh as the snapshot |
 *
 * Display freshness (hasFreshAnalysis) and trigger freshness are
 * intentionally different predicates: a legacy result lacking computedAt
 * displays with an "unknown age" badge but never suppresses a re-run.
 *
 * Storage I/O is extracted behind the narrow SettingsStorage interface
 * (v0.1.5 convention) so the helpers are unit-testable with an in-memory mock.
 */

import type { SettingsStorage } from './settings';
import type { CorrelationResult, CorrelationEngine } from '@/types';

/** Per-source input sizes captured at run time for freshness display. */
export interface CorrelationInputCounts {
  markets: number;
  signals: number;
  news: number;
}

/** Optional metadata stamped onto a persisted correlation result. */
export interface CorrelationStampMeta {
  engine?: CorrelationEngine;
  model?: string;
  inputCounts?: CorrelationInputCounts;
}

/**
 * Return a NEW correlation result stamped with computedAt (epoch ms) and the
 * provided metadata. Pure — never mutates the input.
 */
export function stampCorrelationResult(
  result: CorrelationResult,
  meta: CorrelationStampMeta,
): CorrelationResult {
  const stamped: CorrelationResult = {
    ...result,
    computedAt: Date.now(),
  };
  if (meta.model !== undefined) stamped.model = meta.model;
  if (meta.inputCounts !== undefined) stamped.inputCounts = meta.inputCounts;
  if (meta.engine !== undefined && stamped.engine === undefined) {
    stamped.engine = meta.engine;
  }
  return stamped;
}

/**
 * Read the stored correlation analysis, or null when absent/corrupt.
 * Corrupt data degrades to "no analysis" — never throws.
 */
export async function readStoredAnalysis(
  storage: SettingsStorage,
  key: string,
): Promise<CorrelationResult | null> {
  try {
    const result = await storage.get(key);
    const raw = result[key] as Partial<CorrelationResult> | undefined;
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.matches)) {
      return null;
    }
    return raw as CorrelationResult;
  } catch {
    return null;
  }
}

/**
 * Freshness predicate for the auto-run gate: true iff a stored result exists
 * AND it is not an error. A persisted error result therefore counts as
 * "no analysis" and never suppresses future auto-analysis.
 */
export function hasFreshAnalysis(stored: CorrelationResult | null | undefined): boolean {
  return stored != null && !stored.error;
}

/** Liveness of a correlation run as reported by CORRELATION_RUN_STATE. */
export interface CorrelationRunLiveness {
  /** A correlation run is currently executing in the background. */
  live: boolean;
  /** A correlation run is queued behind the active one (MlRunQueue). */
  queued: boolean;
}

/**
 * Pure trigger guard for the dashboard's snapshot-key storage.onChanged
 * listener (Phase 16, TRIG-03). Decides whether a collection completion
 * should re-run correlation analysis. No browser APIs — fully unit-testable.
 *
 * - A live or queued run suppresses the trigger (no double ML runs).
 * - A missing/empty snapshot (no finite collectedAt) arms nothing.
 * - An absent or error-only stored result always re-runs on new data.
 * - A legacy stored result (no computedAt) never suppresses a re-run
 *   (research Pitfall 4).
 * - Otherwise the trigger fires only when the stored result is strictly
 *   older than the collection: equality counts as fresh, so a result
 *   stamped in the same tick as the collection does not re-run.
 */
export function shouldTriggerReanalysis(params: {
  liveness: CorrelationRunLiveness;
  stored: CorrelationResult | null | undefined;
  snapshotCollectedAt: number | null | undefined;
}): boolean {
  const { liveness, stored, snapshotCollectedAt } = params;
  if (liveness.live || liveness.queued) return false;
  if (typeof snapshotCollectedAt !== 'number' || !Number.isFinite(snapshotCollectedAt)) {
    return false;
  }
  if (!stored || !hasFreshAnalysis(stored)) return true;
  if (typeof stored.computedAt !== 'number' || !Number.isFinite(stored.computedAt)) {
    return true;
  }
  return stored.computedAt < snapshotCollectedAt;
}

/**
 * Persist a correlation result enforcing the write policy above.
 * Returns true when the result was written, false when the policy kept an
 * existing non-error result or storage failed. Never throws — a persistence
 * failure must never break the caller's terminal path.
 */
export async function persistCorrelationResult(
  storage: SettingsStorage,
  key: string,
  result: CorrelationResult,
): Promise<boolean> {
  try {
    const existing = await readStoredAnalysis(storage, key);
    if (result.error) {
      // Error results overwrite only absent/corrupt/error data.
      if (existing && !existing.error) {
        return false;
      }
    } else if (
      existing &&
      !existing.error &&
      typeof existing.computedAt === 'number' &&
      typeof result.computedAt === 'number' &&
      existing.computedAt > result.computedAt
    ) {
      // Keep a genuinely newer non-error result.
      return false;
    }
    await storage.set({ [key]: result });
    return true;
  } catch {
    return false;
  }
}