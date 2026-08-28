/**
 * CORR-06 news↔news correlation tests.
 *
 * Proves the fourth engine pass end to end:
 *   - Cross-source bridging: a thin VCP screener headline (keywords `['pen']`)
 *     matches a Seeking Alpha item about the same ticker — the canonical
 *     "better scanning" use case.
 *   - Same-source pairs NEVER match (a screener feed must not self-match).
 *   - Identical ids never match (merge dedup residue).
 *   - Entity-gated threshold: shared-ticker pairs accept below the base bar;
 *     unrelated pairs with no shared entity stay rejected.
 *   - Indexed path (≥ TINY_INPUT_THRESHOLD) and naive tiny-input path agree.
 */

import { describe, it, expect } from 'vitest';
import { correlateNewsNews } from '@/services/engine/correlation';
import { newsItem } from './fixtures';
import type { NewsItem } from '@/types';

/** VCP screener item: bare ticker keyword only (CORR-03 curation). */
const vcpPen: NewsItem = {
  ...newsItem('stockScreener2', 'PEN — VCP 2026-08-28'),
  keywords: ['pen'],
};

/** Seeking Alpha item with the ticker keyword (URL-derived, CORR-06). */
const saPen: NewsItem = {
  ...newsItem('seekingalpha', 'More On Earnings Revisions »'),
  keywords: ['earnings', 'revisions', 'pen'],
};

/** Unrelated BBC item — no shared entity or ticker with either PEN item. */
const weather: NewsItem = newsItem('bbc', 'Global weather patterns shift');

/** Second VCP item so the indexed path (≥ TINY_INPUT_THRESHOLD) runs. */
const vcpMmm: NewsItem = {
  ...newsItem('stockScreener2', 'MMM — VCP 2026-08-28'),
  keywords: ['mmm'],
};

describe('correlateNewsNews (CORR-06)', () => {
  it('bridges a VCP screener item to a Seeking Alpha item about the same ticker', () => {
    // 3 items ≥ TINY_INPUT_THRESHOLD (2) → candidate-filtered indexed path.
    const matches = correlateNewsNews([vcpPen, saPen, weather]);
    expect(matches).toHaveLength(1);
    expect(matches[0].newsA.id).toBe(vcpPen.id);
    expect(matches[0].newsB.id).toBe(saPen.id);
    expect(matches[0].matchedKeywords).toContain('pen');
    expect(matches[0].confidence).toBeGreaterThan(0);
  });

  it('never matches same-source pairs (screener self-match guard)', () => {
    // Two VCP items sharing the same shape — must produce nothing.
    const matches = correlateNewsNews([vcpPen, vcpMmm]);
    expect(matches).toEqual([]);
  });

  it('never matches identical ids', () => {
    const a: NewsItem = { ...vcpPen, source: 'bbc' };
    const b: NewsItem = { ...vcpPen, source: 'cnn' };
    const matches = correlateNewsNews([a, b]);
    expect(matches).toEqual([]);
  });

  it('rejects unrelated cross-source pairs with no shared entity', () => {
    // weather (bbc) vs both PEN items — no shared ticker, no entity overlap.
    const matches = correlateNewsNews([weather, vcpPen, vcpMmm]);
    expect(matches).toEqual([]);
  });

  it('works on the naive tiny-input path (single pair)', () => {
    // 2 items = TINY_INPUT_THRESHOLD → naive nested loop.
    const matches = correlateNewsNews([vcpPen, saPen]);
    expect(matches).toHaveLength(1);
    expect(matches[0].matchedKeywords).toContain('pen');
  });

  it('empty input produces no matches and no errors', () => {
    expect(correlateNewsNews([])).toEqual([]);
    expect(correlateNewsNews([vcpPen])).toEqual([]);
  });

  it('matches are sorted by confidence descending', () => {
    const saMmm: NewsItem = {
      ...newsItem('seekingalpha', '3M industrial outlook'),
      keywords: ['industrial', 'mmm'],
    };
    const matches = correlateNewsNews([vcpPen, saPen, vcpMmm, saMmm]);
    expect(matches.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].confidence).toBeGreaterThanOrEqual(matches[i].confidence);
    }
  });
});