/**
 * Unit tests for the social-source-health map (Phase 7, D-02).
 *
 * Verifies the separate `SocialSourceHealth` map (keyed by SocialPlatform,
 * NOT NewsSource), the pure `mergeSocialHealth` helper, and that the
 * existing `computeHealth` is reused unchanged for the TikTok badge.
 */

import { describe, it, expect } from 'vitest';
import { computeHealth, mergeSocialHealth } from '@/utils/source-health';
import type { SocialSourceHealth, SourceHealthEntry } from '@/types';

const STALE_MS = 2 * 60 * 60 * 1000; // 2h
const NOW = 1_000_000_000_000;

function entry(partial: Partial<SourceHealthEntry>): SourceHealthEntry {
  return {
    lastFetchedAt: NOW,
    itemCount: 5,
    consecutiveFailures: 0,
    ...partial,
  };
}

describe('SocialSourceHealth type', () => {
  it('accepts { tiktok: SourceHealthEntry } and Partial allows an empty map', () => {
    const empty: SocialSourceHealth = {};
    const withTiktok: SocialSourceHealth = { tiktok: entry({}) };
    expect(empty.tiktok).toBeUndefined();
    expect(withTiktok.tiktok?.itemCount).toBe(5);
  });
});

describe('computeHealth reused for TikTok (D-02)', () => {
  it('returns no-data for an undefined entry (TikTok never reported)', () => {
    expect(computeHealth(undefined, STALE_MS, NOW)).toBe('no-data');
  });

  it('returns degraded when consecutiveFailures > 0 (TikTok unavailable)', () => {
    expect(
      computeHealth(entry({ consecutiveFailures: 1, itemCount: 5 }), STALE_MS, NOW),
    ).toBe('degraded');
  });
});

describe('mergeSocialHealth', () => {
  it('updates only the given platform entry and preserves others', () => {
    const existing: SocialSourceHealth = {
      tiktok: entry({ itemCount: 3 }),
      reddit: entry({ itemCount: 7 }),
    };
    const updated = mergeSocialHealth(existing, 'tiktok', entry({ itemCount: 10 }));
    expect(updated.tiktok?.itemCount).toBe(10);
    expect(updated.reddit?.itemCount).toBe(7);
  });

  it('increments consecutiveFailures when the new entry reports failure and resets on success', () => {
    const existing: SocialSourceHealth = { tiktok: entry({ consecutiveFailures: 2 }) };
    const failed = mergeSocialHealth(existing, 'tiktok', entry({ consecutiveFailures: 3, itemCount: 0 }));
    expect(failed.tiktok?.consecutiveFailures).toBe(3);
    const recovered = mergeSocialHealth(failed, 'tiktok', entry({ consecutiveFailures: 0, itemCount: 12 }));
    expect(recovered.tiktok?.consecutiveFailures).toBe(0);
    expect(recovered.tiktok?.itemCount).toBe(12);
  });

  it('does not mutate the input map', () => {
    const existing: SocialSourceHealth = { tiktok: entry({ itemCount: 3 }) };
    mergeSocialHealth(existing, 'tiktok', entry({ itemCount: 99 }));
    expect(existing.tiktok?.itemCount).toBe(3);
  });
});
