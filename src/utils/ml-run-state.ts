/**
 * Persisted ML run-state marker (Phase 15, MLPROG-01).
 *
 * MV3 service workers can be killed at any time. If that happens mid-run,
 * the in-memory queue dies with it and no tab can tell whether a run was in
 * flight — the dashboard would spin forever. This module persists a small
 * marker for the active run so:
 *
 * - any tab can reconstruct/clear stale progress, and
 * - on background startup an orphaned marker (SW died mid-run) is detected,
 *   cleared, and an interrupted error result is broadcast for that requestId.
 *
 * Storage I/O is extracted behind a narrow interface (v0.1.5 convention) so
 * the helpers are unit-testable with an in-memory mock.
 */

import type { SettingsStorage } from './settings';

export interface MlRunState {
  requestId: string;
  engine: string;
  model: string;
  /** Epoch ms when the run started. */
  startedAt: number;
}

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

/**
 * Detect an orphaned marker: one written by a previous service-worker life
 * that never reached a terminal path. A marker is orphaned when it is still
 * present at background startup (the terminal paths always clear it in the
 * same SW life that wrote it).
 */
export function isOrphanedRunState(state: MlRunState | null): state is MlRunState {
  return state !== null && typeof state.requestId === 'string' && state.requestId.length > 0;
}