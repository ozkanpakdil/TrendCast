/**
 * Shared fixtures for the correlation engine tests.
 *
 * Reused by the index unit tests and the per-engine equivalence tests in later
 * plans. Includes hand-verified golden fixtures (D-02) for edge cases.
 */

import { extractKeywords } from '@/utils/keywords';
import type { MarketContract, NewsCorrelationMatch, NewsItem, SocialSignal } from '@/types';

/** A sample market contract (mirrors the mockContract pattern in correlation.test.ts). */
export const mockContract: MarketContract = {
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

/** A sample social signal. */
export const mockSignal: SocialSignal = {
  id: 'sig-1',
  platform: 'reddit',
  text: 'Bitcoin $BTC is going to the moon! #bitcoin',
  author: 'r/cryptocurrency',
  metrics: { likes: 5000, shares: 200, comments: 800 },
  timestamp: new Date().toISOString(),
  keywords: ['bitcoin', 'btc', 'moon'],
  sentiment: 0.8,
  virality: 85,
};

/** Build a NewsItem fixture with keywords derived from its headline. */
export function newsItem(source: NewsItem['source'], headline: string): NewsItem {
  return {
    id: `${source}:${headline}`,
    source,
    headline,
    url: `https://example.com/${source}`,
    publishedAt: new Date().toISOString(),
    keywords: extractKeywords(headline),
  };
}

/** Build a NewsCorrelationMatch fixture for a contract + news item. */
export function newsMatch(
  contract: MarketContract,
  news: NewsItem,
  confidence = 0.8,
): NewsCorrelationMatch {
  return {
    contract,
    news,
    confidence,
    matchedKeywords: news.keywords.filter((k) => contract.keywords.includes(k)),
    correlatedAt: Date.now(),
  };
}

// ── Golden fixtures (D-02) ────────────────────────────────────────

/** Cashtag-only contract: its only keyword is the bare ticker form `btc` (canonical since Phase 14). */
export const cashtagOnlyContract: MarketContract = {
  id: 'cashtag-btc',
  platform: 'polymarket',
  question: 'Will $BTC hit $100k?',
  outcomes: [
    { label: 'Yes', price: 0.6 },
    { label: 'No', price: 0.4 },
  ],
  endDate: '2025-12-31T23:59:59Z',
  keywords: ['btc'],
  lastUpdated: Date.now(),
};

/** Cashtag-only signal: its only keyword is the bare ticker form `btc` (canonical since Phase 14). */
export const cashtagOnlySignal: SocialSignal = {
  ...mockSignal,
  id: 'sig-cashtag',
  text: '$BTC to the moon',
  keywords: ['btc'],
};

/** Hashtag-only contract: its only keyword is `bitcoin` (from `#bitcoin`). */
export const hashtagOnlyContract: MarketContract = {
  ...mockContract,
  id: 'hashtag-bitcoin',
  question: 'Will Bitcoin stay above $90k?',
  keywords: ['bitcoin'],
};

/** Hashtag-only signal: its only keyword is `bitcoin` (from `#bitcoin`). */
export const hashtagOnlySignal: SocialSignal = {
  ...mockSignal,
  id: 'sig-hashtag',
  text: '#bitcoin is trending',
  keywords: ['bitcoin'],
};
