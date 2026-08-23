/**
 * Unit tests for the alert direction derivation (D-04, D-05).
 *
 * Verifies `deriveDirection` combines aggregate signal sentiment with the
 * Yes-price delta vs a prior snapshot to produce bullish/bearish/mixed.
 */

import { describe, it, expect, vi } from 'vitest';
import { deriveDirection } from '@/background/alerts';
import type { MarketContract, NewsItem, SocialSignal } from '@/types';

// `@/background/alerts` imports the webextension polyfill at module load,
// which throws outside a browser extension. Mock it so the pure
// `deriveDirection` can be tested in isolation.
vi.mock('@/messaging/browser', () => ({
  browser: { storage: { local: { get: vi.fn(), set: vi.fn() } } },
}));

const NOW = 1_000_000_000_000;

function contract(partial: Partial<MarketContract> = {}): MarketContract {
  return {
    id: 'btc-100k',
    platform: 'polymarket',
    question: 'Will Bitcoin close above $100k on Dec 31?',
    outcomes: [
      { label: 'Yes', price: 0.65 },
      { label: 'No', price: 0.35 },
    ],
    endDate: '2025-12-31T23:59:59Z',
    keywords: ['bitcoin', 'btc'],
    lastUpdated: NOW,
    ...partial,
  };
}

function signal(sentiment: number, text = 'Bitcoin is going up'): SocialSignal {
  return {
    id: `sig-${sentiment}`,
    platform: 'reddit',
    text,
    author: 'r/crypto',
    metrics: { likes: 10, shares: 2, comments: 1 },
    timestamp: new Date(NOW).toISOString(),
    keywords: ['bitcoin'],
    sentiment,
    virality: 50,
  };
}

const noNews: NewsItem[] = [];

describe('deriveDirection', () => {
  it('returns bullish for positive sentiment AND rising Yes price', () => {
    const c = contract({ outcomes: [{ label: 'Yes', price: 0.7 }, { label: 'No', price: 0.3 }] });
    expect(deriveDirection(c, [signal(0.8)], noNews, 0.6)).toBe('bullish');
  });

  it('returns bearish for negative sentiment AND falling Yes price', () => {
    const c = contract({ outcomes: [{ label: 'Yes', price: 0.5 }, { label: 'No', price: 0.5 }] });
    expect(deriveDirection(c, [signal(-0.8)], noNews, 0.6)).toBe('bearish');
  });

  it('returns mixed when sentiment is positive but price is falling', () => {
    const c = contract({ outcomes: [{ label: 'Yes', price: 0.5 }, { label: 'No', price: 0.5 }] });
    expect(deriveDirection(c, [signal(0.8)], noNews, 0.6)).toBe('mixed');
  });

  it('returns mixed when sentiment is negative but price is rising', () => {
    const c = contract({ outcomes: [{ label: 'Yes', price: 0.7 }, { label: 'No', price: 0.3 }] });
    expect(deriveDirection(c, [signal(-0.8)], noNews, 0.6)).toBe('mixed');
  });

  it('returns mixed when there is no prior Yes price (no delta)', () => {
    expect(deriveDirection(contract(), [signal(0.8)], noNews, undefined)).toBe('mixed');
  });

  it('aggregates sentiment across multiple signals (mean)', () => {
    const c = contract({ outcomes: [{ label: 'Yes', price: 0.7 }, { label: 'No', price: 0.3 }] });
    // mean = (0.8 + -0.4) / 2 = 0.2 > 0 → bullish sentiment + rising price
    expect(deriveDirection(c, [signal(0.8), signal(-0.4)], noNews, 0.6)).toBe('bullish');
  });

  it('uses the Yes outcome price regardless of outcome order', () => {
    const c = contract({ outcomes: [{ label: 'No', price: 0.3 }, { label: 'Yes', price: 0.7 }] });
    expect(deriveDirection(c, [signal(0.8)], noNews, 0.6)).toBe('bullish');
  });
});
