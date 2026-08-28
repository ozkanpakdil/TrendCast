/**
 * Bridging tests (CORR-01 / CORR-02 — Phase 14, plan 14-01 Task 2).
 *
 * Proves the ticker-form bridging end to end:
 *   - CORR-01: `$AMZN`, bare `AMZN`, and `Amazon` unify onto the single
 *     canonical entity key `amazon`; bare-caps recognition fires only under
 *     the three gates (KNOWN_TICKERS ∧ length ≥ 2 ∧ ¬STOP_WORDS).
 *   - CORR-02: `extractKeywords` emits bare cashtag forms; `keywordSimilarity`
 *     strips exactly one leading `$` so legacy stored data bridges with no
 *     migration.
 *   - Tracer proof: a stock-indicator news item (keywords `['amzn']`) matches
 *     a `$AMZN` social signal via `correlateNewsSocial` on BOTH engine paths
 *     (indexed ≥ TINY_INPUT_THRESHOLD and naive tiny-input), and
 *     `correlateNews` finds it against an Amazon contract via the unified
 *     entity key.
 */

import { describe, it, expect } from 'vitest';
import { extractKeywords, keywordSimilarity } from '@/utils/keywords';
import {
  extractEntities,
  extractEntityKeywords,
  entitySimilarity,
  isKnownTicker,
} from '@/utils/entities';
import { correlateNews, correlateNewsSocial } from '@/services/engine/correlation';
import { mockContract, mockSignal, newsItem } from './fixtures';
import type { MarketContract, NewsItem, SocialSignal } from '@/types';

// ── Fixtures ──────────────────────────────────────────────────────────

/** Stock-indicator news item: bare ticker keyword only (canonical since Phase 14). */
const amznNews: NewsItem = {
  ...newsItem('usaStocksIndicator', 'AMZN — Stock Indicator 2026-08-23'),
  keywords: ['amzn'],
};

/** Social signal using the cashtag form of the same ticker. */
const amznSignal: SocialSignal = {
  ...mockSignal,
  id: 'sig-amzn',
  platform: 'x',
  text: '$AMZN earnings beat',
  keywords: ['amzn', 'earnings', 'beat'],
  sentiment: 0.8,
  virality: 85,
};

/** Unrelated news/signal pair so the indexed path (≥ TINY_INPUT_THRESHOLD) runs. */
const weatherNews: NewsItem = newsItem('bbc', 'Global weather patterns shift');
const weatherSignal: SocialSignal = {
  ...mockSignal,
  id: 'sig-weather',
  platform: 'reddit',
  text: 'The weather is nice today',
  keywords: ['weather', 'nice', 'today'],
  sentiment: 0.1,
  virality: 40,
};

/** Amazon contract tagged with both the org and ticker forms (typical market keywords). */
const amazonContract: MarketContract = {
  ...mockContract,
  id: 'amazon-earnings',
  question: 'Will Amazon beat earnings expectations?',
  keywords: ['amazon', 'amzn'],
};

// ── Entity unification (CORR-01) ──────────────────────────────────────

describe('entity unification (CORR-01)', () => {
  it('cashtag, bare all-caps, and org-name forms share the canonical key amazon', () => {
    const cashtag = extractEntities('$AMZN earnings beat');
    const bare = extractEntities('AMZN — Stock Indicator 2026-08-23');
    const org = extractEntities('Amazon opens new warehouse');

    const cashtagEntity = cashtag.find((e) => e.normalized === 'amazon');
    expect(cashtagEntity).toBeDefined();
    expect(cashtagEntity?.type).toBe('ticker');
    expect(cashtagEntity?.confidence).toBe(0.95);

    const bareEntity = bare.find((e) => e.normalized === 'amazon');
    expect(bareEntity).toBeDefined();
    expect(bareEntity?.type).toBe('ticker');
    expect(bareEntity?.confidence).toBe(0.85);

    expect(org.some((e) => e.normalized === 'amazon')).toBe(true);
  });

  it('ticker-backed orgs are reachable through their ticker aliases', () => {
    expect(extractEntityKeywords('AAPL earnings')).toContain('apple');
    expect(extractEntityKeywords('GOOG ads')).toContain('google');
    expect(extractEntityKeywords('MSFT cloud')).toContain('microsoft');
    expect(extractEntityKeywords('NVDA chips')).toContain('nvidia');
  });

  it('entitySimilarity bridges the cashtag and org-name forms', () => {
    expect(entitySimilarity('$AMZN rally', 'Amazon rally')).toBeGreaterThan(0);
  });
});

// ── Bare-caps gates (CORR-01, Assumption A1) ──────────────────────────

describe('bare-caps gates (CORR-01, A1)', () => {
  it('single-letter V never yields a ticker entity (length gate is load-bearing)', () => {
    expect(extractEntities('V').filter((e) => e.type === 'ticker')).toEqual([]);
    expect(
      extractEntities('V wins the championship').filter((e) => e.type === 'ticker'),
    ).toEqual([]);
  });

  it('stop-word and unknown all-caps tokens yield no ticker entities', () => {
    expect(
      extractEntities('ALL CAPS ON US').filter((e) => e.type === 'ticker'),
    ).toEqual([]);
    expect(extractEntities('XPON').filter((e) => e.type === 'ticker')).toEqual([]);
    expect(extractEntities('BREAKOUT').filter((e) => e.type === 'ticker')).toEqual([]);
  });

  it('2-char boundary SQ yields a ticker entity at confidence 0.85', () => {
    const tickers = extractEntities('SQ').filter((e) => e.type === 'ticker');
    expect(tickers).toHaveLength(1);
    expect(tickers[0].normalized).toBe('sq');
    expect(tickers[0].confidence).toBe(0.85);
  });

  it('isKnownTicker gates on the curated ticker set (case-insensitive)', () => {
    expect(isKnownTicker('amzn')).toBe(true);
    expect(isKnownTicker('AMZN')).toBe(true);
    expect(isKnownTicker('xpon')).toBe(false);
    // 'v' IS in the set — the length gate lives in the bare-caps regex, not here.
    expect(isKnownTicker('v')).toBe(true);
  });
});

// ── Keyword bridging (CORR-02) ────────────────────────────────────────

describe('keyword bridging (CORR-02)', () => {
  it('extractKeywords emits the bare cashtag form and never a $-prefixed token', () => {
    const kws = extractKeywords('$AMZN earnings beat');
    expect(kws).toContain('amzn');
    expect(kws.some((k) => k.startsWith('$'))).toBe(false);
  });

  it('legacy $-prefixed keywords bridge to bare forms at compare time', () => {
    expect(keywordSimilarity(['$amzn'], ['amzn'])).toBe(1);
  });

  it('exactly one leading $ is stripped ($$btc does not bridge)', () => {
    expect(keywordSimilarity(['$$btc'], ['btc'])).toBe(0);
  });

  it('normalized dedupe collapses duplicate forms before Jaccard', () => {
    expect(keywordSimilarity(['$btc', 'btc'], ['btc'])).toBe(1);
  });
});

// ── Purity / idempotency ──────────────────────────────────────────────

describe('purity and idempotency', () => {
  it('extractEntities returns deep-equal output across repeated calls', () => {
    const a = extractEntities('$AMZN earnings beat');
    const b = extractEntities('$AMZN earnings beat');
    expect(a).toEqual(b);
  });

  it('extractKeywords returns deep-equal output across repeated calls', () => {
    const a = extractKeywords('$BTC to $100k soon');
    const b = extractKeywords('$BTC to $100k soon');
    expect(a).toEqual(b);
  });

  it('empty string input yields an empty array for both extractors', () => {
    expect(extractEntities('')).toEqual([]);
    expect(extractKeywords('')).toEqual([]);
    expect(extractEntityKeywords('')).toEqual([]);
  });
});

// ── End-to-end bridging (tracer proof) ────────────────────────────────

describe('end-to-end bridging (tracer proof)', () => {
  it('stock-indicator news matches a $AMZN signal on the indexed path', () => {
    // 2 signals ≥ TINY_INPUT_THRESHOLD (2) → candidate-filtered indexed path.
    const matches = correlateNewsSocial(
      [amznNews, weatherNews],
      [amznSignal, weatherSignal],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].news.id).toBe(amznNews.id);
    expect(matches[0].signal.id).toBe(amznSignal.id);
    expect(matches[0].matchedKeywords).toContain('amzn');
  });

  it('stock-indicator news matches a $AMZN signal on the naive tiny-input path', () => {
    // 1 signal < TINY_INPUT_THRESHOLD → naive nested loop.
    const matches = correlateNewsSocial([amznNews], [amznSignal]);
    expect(matches).toHaveLength(1);
    expect(matches[0].news.id).toBe(amznNews.id);
    expect(matches[0].signal.id).toBe(amznSignal.id);
    expect(matches[0].matchedKeywords).toContain('amzn');
  });

  it('correlateNews finds the stock-indicator item via the unified entity key', () => {
    // The contract's keywords carry the org form `amazon` while the news item
    // carries only the ticker form `amzn` — the entity-side match comes through
    // the unified key (CORR-01), and the keyword-side bridge via strip-$ /
    // bare postings. Assert the unified org key appears in matchedKeywords.
    const matches = correlateNews([amznNews], [amazonContract]);
    expect(matches).toHaveLength(1);
    expect(matches[0].news.id).toBe(amznNews.id);
    expect(matches[0].contract.id).toBe('amazon-earnings');
    expect(matches[0].matchedKeywords).toContain('amazon');
    expect(matches[0].matchedKeywords).toContain('amzn');
  });

  it('empty input arrays produce no matches and no errors', () => {
    expect(correlateNewsSocial([], [])).toEqual([]);
    expect(correlateNews([], [])).toEqual([]);
    expect(correlateNews([amznNews], [])).toEqual([]);
    expect(correlateNews([], [amazonContract])).toEqual([]);
  });
});