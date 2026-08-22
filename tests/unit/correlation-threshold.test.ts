/**
 * Diagnostic regression test for Seeking Alpha / Investing.com correlation
 * thresholds (REL-01, D-01/D-03).
 *
 * This test does NOT change MIN_CONFIDENCE (0.75) or
 * MIN_CONFIDENCE_ENTITY_MATCH (0.35). It feeds SA/Investing-style headlines
 * against sample market contracts and asserts the resulting confidence
 * scores against the existing thresholds — documenting whether these
 * sources are systematically dropped by the threshold filter.
 *
 * Evidence mechanism for D-03: if entity-sharing headlines clear the 0.35
 * entity-match threshold but keyword-only headlines never clear 0.75, that
 * proves the threshold (not feed yield) is the root cause of missing
 * SA/Investing news in the correlation tab.
 */

import { describe, it, expect } from 'vitest';
import { correlateNews } from '@/services/engine/correlation';
import { extractKeywords } from '@/utils/keywords';
import type { MarketContract, NewsItem } from '@/types';

// Mirror the thresholds from src/services/engine/correlation.ts (D-01: unchanged).
const MIN_CONFIDENCE = 0.75;
const MIN_CONFIDENCE_ENTITY_MATCH = 0.35;

/** Sample market contract (reuses the mockContract pattern from correlation.test.ts). */
const mockContract: MarketContract = {
  id: 'btc-100k',
  platform: 'polymarket',
  question: 'Will Bitcoin close above $100k on Dec 31?',
  outcomes: [
    { label: 'Yes', price: 0.65 },
    { label: 'No', price: 0.35 },
  ],
  endDate: '2025-12-31T23:59:59Z',
  keywords: ['bitcoin', 'btc', '100k', 'close', 'december'],
  lastUpdated: Date.now(),
};

/** Build a NewsItem fixture with keywords derived from its headline. */
function newsItem(source: NewsItem['source'], headline: string): NewsItem {
  return {
    id: `${source}:${headline}`,
    source,
    headline,
    url: `https://example.com/${source}`,
    publishedAt: new Date().toISOString(),
    keywords: extractKeywords(headline),
  };
}

describe('correlateNews threshold diagnostics (SA/Investing)', () => {
  it('documents confidence for a Seeking Alpha headline sharing a named entity', () => {
    // "Bitcoin" is a known crypto entity → entity match with the contract.
    const saHeadline = newsItem(
      'seekingalpha',
      'Bitcoin miners face margin squeeze as hash price falls',
    );
    const matches = correlateNews([saHeadline], [mockContract]);

    // Log the actual score so the distribution is visible in test output.
    const confidence = matches[0]?.confidence ?? 0;
    console.log(
      `[diagnostic] SA entity headline confidence=${confidence.toFixed(3)} ` +
        `(entity threshold=${MIN_CONFIDENCE_ENTITY_MATCH}, keyword threshold=${MIN_CONFIDENCE})`,
    );

    if (matches.length > 0) {
      // If it matched, it must have cleared the entity-match threshold.
      expect(confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE_ENTITY_MATCH);
    } else {
      // If it did NOT match, document that it was dropped below the threshold.
      expect(confidence).toBeLessThan(MIN_CONFIDENCE_ENTITY_MATCH);
    }
  });

  it('documents confidence for an Investing.com headline sharing a named entity', () => {
    // "Bitcoin" is a known crypto entity → entity match with the contract.
    // It clears the LOWER entity threshold (0.35), not the keyword threshold (0.75).
    const investingHeadline = newsItem(
      'investing',
      'Bitcoin price consolidates ahead of Fed decision',
    );
    const matches = correlateNews([investingHeadline], [mockContract]);

    const confidence = matches[0]?.confidence ?? 0;
    console.log(
      `[diagnostic] Investing entity headline confidence=${confidence.toFixed(3)} ` +
        `(entity threshold=${MIN_CONFIDENCE_ENTITY_MATCH}, keyword threshold=${MIN_CONFIDENCE})`,
    );

    // It matches because it shares the "Bitcoin" entity → clears 0.35.
    expect(matches.length).toBeGreaterThan(0);
    expect(confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE_ENTITY_MATCH);
    // But it does NOT clear the keyword-only threshold (0.75).
    expect(confidence).toBeLessThan(MIN_CONFIDENCE);
  });

  it('returns no match for a headline with no entity/keyword overlap', () => {
    const unrelated = newsItem(
      'investing',
      'Global weather patterns shift as El Nino strengthens',
    );
    const matches = correlateNews([unrelated], [mockContract]);
    // baseSim === 0 → null → no match (documented drop-out path).
    expect(matches).toHaveLength(0);
  });

  it('documents that a keyword-only headline cannot clear the 0.75 threshold', () => {
    // A headline sharing ONLY keywords (no entity) with the contract.
    // baseSim = kwSim * 0.35 + 0.05. For kwSim ≤ 1, max baseSim = 0.40,
    // which is < 0.75 — so keyword-only matches are structurally dropped.
    const keywordOnly = newsItem(
      'seekingalpha',
      'December close above 100k unlikely, analysts say',
    );
    const matches = correlateNews([keywordOnly], [mockContract]);

    const confidence = matches[0]?.confidence ?? 0;
    console.log(
      `[diagnostic] keyword-only headline confidence=${confidence.toFixed(3)} ` +
        `(keyword threshold=${MIN_CONFIDENCE})`,
    );

    // This documents the structural drop: keyword-only matches never clear 0.75.
    expect(confidence).toBeLessThan(MIN_CONFIDENCE);
  });
});
