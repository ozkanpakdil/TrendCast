/**
 * Settings merge + migration helpers.
 *
 * The extension's settings are stored as a partial object in
 * `chrome.storage.local`. When new fields are added to `ExtensionSettings`
 * (e.g. the `seekingalpha`/`investing`/`googleFinance` source flags), existing
 * users' saved settings lack those keys. A shallow spread
 * `{ ...DEFAULT_SETTINGS, ...stored }` replaces the whole nested
 * `enabledSources` object with the stored partial — silently dropping the newer
 * keys. These helpers deep-merge `enabledSources` so missing flags default to
 * `true` while explicit user preferences are preserved.
 *
 * Both helpers are pure (no storage I/O) so they are trivially unit-testable.
 */

import type { ExtensionSettings } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';
import { CONFIG } from '@/config';

/**
 * Minimal storage abstraction satisfied structurally by `browser.storage.local`.
 * Kept narrow so the storage I/O helpers below are directly unit-testable with
 * an in-memory mock (no `vi.mock` of the messaging layer required).
 */
export interface SettingsStorage {
  get(keys: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/**
 * Deep-merge stored settings over defaults, backfilling missing `enabledSources`
 * flags from defaults without overwriting present keys.
 *
 * - `stored === undefined` → returns `defaults` unchanged.
 * - Top-level fields merge as `{ ...defaults, ...stored }` (stored wins).
 * - `enabledSources` deep-merges as `{ ...defaults.enabledSources, ...stored.enabledSources }`
 *   so newer source flags (`seekingalpha`, `investing`, `googleFinance`) default to
 *   `true` while explicit user preferences (present keys) win.
 * - A non-object `stored.enabledSources` (corruption) falls back to
 *   `defaults.enabledSources` instead of spreading junk keys.
 */
export function deepMergeSettings(
  defaults: ExtensionSettings,
  stored: Partial<ExtensionSettings> | undefined,
): ExtensionSettings {
  if (!stored) return defaults;

  const storedEnabled = stored.enabledSources;
  const enabledSources =
    typeof storedEnabled === 'object' && storedEnabled !== null && !Array.isArray(storedEnabled)
      ? { ...defaults.enabledSources, ...storedEnabled }
      : defaults.enabledSources;

  return { ...defaults, ...stored, enabledSources };
}

/**
 * Backfill missing `enabledSources` flags into a stored settings object so the
 * deep-merge fix persists across restarts.
 *
 * Pure and idempotent. Returns `null` when there is nothing to migrate (no
 * stored settings, a non-object `enabledSources`, or no missing keys) so the
 * caller can skip the write. Present keys always win — an explicit user
 * preference is never overwritten.
 */
export function migrateEnabledSources(
  stored: Partial<ExtensionSettings> | undefined,
): Partial<ExtensionSettings> | null {
  if (!stored) return null;
  const storedEnabled = stored.enabledSources;
  if (typeof storedEnabled !== 'object' || storedEnabled === null || Array.isArray(storedEnabled)) {
    return null;
  }

  // Backfill: defaults fill missing keys, but present stored keys always win
  // (an explicit user preference is never overwritten).
  const backfilled = { ...DEFAULT_SETTINGS.enabledSources, ...storedEnabled };

  // Idempotent: if nothing was missing, return null so the caller skips the write.
  const changed = Object.keys(DEFAULT_SETTINGS.enabledSources).some(
    (key) => backfilled[key as keyof typeof backfilled] !== storedEnabled[key as keyof typeof storedEnabled],
  );
  if (!changed) return null;

  return { ...stored, enabledSources: backfilled };
}

/**
 * Migrate a stored `correlationEngine` value that no longer exists.
 *
 * The zero-shot engine was removed in v0.1.6 (benchmark: 321s per run — ~10×
 * slower than every other engine — for the lowest score). Users who had it
 * selected fall back to `heuristic` (the default) rather than keeping an
 * invalid engine value that no engine dispatch would handle.
 *
 * Pure and idempotent. Returns `null` when there is nothing to migrate so the
 * caller can skip the write.
 */
export function migrateCorrelationEngine(
  stored: Partial<ExtensionSettings> | undefined,
): Partial<ExtensionSettings> | null {
  if (!stored) return null;
  // Read as string — the stored value may be a removed engine literal
  // ('zeroshot') that no longer exists in the CorrelationEngine union.
  const engine = stored.correlationEngine as string | undefined;
  if (engine !== 'zeroshot') return null;
  return { ...stored, correlationEngine: 'heuristic' };
}

/**
 * Read stored settings from storage and deep-merge them over defaults so
 * newly-added source flags default to `true` while explicit user preferences
 * are preserved. Mirrors the background worker's `getSettings()`.
 */
export async function getSettingsFromStorage(
  storage: SettingsStorage,
): Promise<ExtensionSettings> {
  const result = await storage.get(CONFIG.storage.settings);
  const stored = result[CONFIG.storage.settings] as Partial<ExtensionSettings> | undefined;
  return deepMergeSettings(DEFAULT_SETTINGS, stored);
}

/**
 * Backfill any missing `enabledSources` flags into persisted settings so the
 * deep-merge fix survives restarts. Silent and idempotent — present keys
 * (explicit user preferences) are never overwritten. Writes back to storage
 * only when `migrateEnabledSources` returns a non-null result.
 */
export async function migrateEnabledSourcesFromStorage(
  storage: SettingsStorage,
): Promise<void> {
  const result = await storage.get(CONFIG.storage.settings);
  const stored = result[CONFIG.storage.settings] as Partial<ExtensionSettings> | undefined;
  const migrated = migrateEnabledSources(stored);
  if (!migrated) return; // nothing to backfill — skip the write
  await storage.set({ [CONFIG.storage.settings]: migrated });
}
