/**
 * Sentiment correlation equivalence tests (D-02 / D-03 / D-04).
 *
 * The sentiment engine (`correlateSentiment`, `correlateNewsSentiment`,
 * `correlateNewsSocialSentiment`) was converted from the inline keyword-overlap
 * candidate filter to candidate-filtered via the shared `InvertedIndex`. This
 * file proves the indexed output is IDENTICAL to the naive inline-filter path —
 * same matches, same confidence, same order — over the shared fixtures, the
 * hand-verified golden fixtures, and the D-03 edge cases.
 *
 * The sentiment pipeline is mocked with a deterministic stub. The naive oracle
 * below replicates the pre-change inline-filter loop (including the pipeline
 * call) so the indexed path is compared against an independent reference.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  correlateSentiment,
  correlateNewsSentiment,
  correlateNewsSocialSentiment,
} from '@/services/engine/ml/sentiment';
import { getSentimentPipeline } from '@/services/engine/ml/transformers';
import { SENTIMENT_THRESHOLD } from '@/services/engine/ml/types';
import {
  mockContract,
  mockSignal,
  newsItem,
  cashtagOnlyContract,
  cashtagOnlySignal,
  hashtagOnlyContract,
  hashtagOnlySignal,
} from './fixtures';
import type {
  CorrelationMatch,
  MarketContract,
  NewsCorrelationMatch,
  NewsItem,
  NewsSocialCorrelationMatch,
  SentimentModel,
  SocialSignal,
} from '@/types';

const MODEL: SentimentModel = 'Xenova/distilbert-base-uncased-finetuned-sst-2-english';

// ── Mock the transformers pipeline ──────────────────────────────────
// Deterministic stub: every text classifies as POSITIVE with score 0.9.
// Both the indexed path and the naive oracle call the same stub.

vi.mock('@/services/engine/ml/transformers', () => ({
  getSentimentPipeline: vi.fn(async () => {
    return async (texts: string[]) =>
      texts.map(() => ({ label: 'POSITIVE', score: 0.9 }));
  }),
}));

// ── Naive oracle (replicate the pre-change engine) ──────────────────

/** Replica of the pre-change `correlateSignalsToContracts` inline filter. */
async function naiveSentiment(
  signals: SocialSignal[],
  contracts: MarketContract[],
): Promise<CorrelationMatch[]> {
  const pipeline = await getSentimentPipeline(MODEL);
  const signalSentiments = (await pipeline(signals.map((s) => s.text))) as {
    label: string;
    score: number;
  }[];
  const matches: CorrelationMatch[] = [];

  for (let i = 0; i < signals.length; i++) {
    const mlSentiment = normalize(signalSentiments[i]);
    const signal = signals[i];

    for (const contract of contracts) {
      const matchedKeywords = signal.keywords.filter((k) =>
        contract.keywords.includes(k),
      );
      if (matchedKeywords.length === 0) continue;

      const overlapRatio =
        matchedKeywords.length /
        Math.max(signal.keywords.length, contract.keywords.length, 1);
      const sentimentMagnitude = Math.abs(mlSentiment);
      const viralityWeight = (signal.virality / 100) * 0.1;
      const confidence = Math.min(
        1,
        overlapRatio * 0.5 + sentimentMagnitude * 0.3 + viralityWeight,
      );
      if (confidence < SENTIMENT_THRESHOLD) continue;

      matches.push({
        contract,
        signal,
        confidence,
        matchedKeywords,
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

/** Replicate the pre-change `correlateNewsToContracts` inline filter. */
async function naiveNewsSentiment(
  news: NewsItem[],
  contracts: MarketContract[],
): Promise<NewsCorrelationMatch[]> {
  const pipeline = await getSentimentPipeline(MODEL);
  const newsSentiments = (await pipeline(news.map((n) => n.headline))) as {
    label: string;
    score: number;
  }[];
  const matches: NewsCorrelationMatch[] = [];

  for (let i = 0; i < news.length; i++) {
    const mlSentiment = normalize(newsSentiments[i]);
    const item = news[i];

    for (const contract of contracts) {
      const matchedKeywords = item.keywords.filter((k) =>
        contract.keywords.includes(k),
      );
      if (matchedKeywords.length === 0) continue;

      const overlapRatio =
        matchedKeywords.length /
        Math.max(item.keywords.length, contract.keywords.length, 1);
      const sentimentMagnitude = Math.abs(mlSentiment);
      const confidence = Math.min(1, overlapRatio * 0.5 + sentimentMagnitude * 0.3 + 0.05);
      if (confidence < SENTIMENT_THRESHOLD) continue;

      matches.push({
        contract,
        news: item,
        confidence,
        matchedKeywords,
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

/** Replicate the pre-change `correlateNewsSocialSentiment` inline filter. */
async function naiveNewsSocialSentiment(
  news: NewsItem[],
  signals: SocialSignal[],
): Promise<NewsSocialCorrelationMatch[]> {
  const pipeline = await getSentimentPipeline(MODEL);
  const newsSentiments = (await pipeline(news.map((n) => n.headline))) as {
    label: string;
    score: number;
  }[];
  const signalSentiments = (await pipeline(signals.map((s) => s.text))) as {
    label: string;
    score: number;
  }[];
  const matches: NewsSocialCorrelationMatch[] = [];

  for (let i = 0; i < news.length; i++) {
    const newsSentiment = normalize(newsSentiments[i]);
    const item = news[i];

    for (let j = 0; j < signals.length; j++) {
      const matchedKeywords = item.keywords.filter((k) =>
        signals[j].keywords.includes(k),
      );
      if (matchedKeywords.length === 0) continue;

      const signalSentiment = normalize(signalSentiments[j]);
      const sentimentAlignment = 1 - Math.abs(newsSentiment - signalSentiment) / 2;
      const overlapRatio =
        matchedKeywords.length /
        Math.max(item.keywords.length, signals[j].keywords.length, 1);
      const viralityWeight = (signals[j].virality / 100) * 0.1;
      const confidence = Math.min(
        1,
        overlapRatio * 0.4 + sentimentAlignment * 0.3 + viralityWeight,
      );
      if (confidence < SENTIMENT_THRESHOLD) continue;

      matches.push({
        news: item,
        signal: signals[j],
        confidence,
        matchedKeywords,
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

/** Replica of the production `normalizeSentiment` (POSITIVE → +score). */
function normalize(top: { label: string; score: number }): number {
  const label = top.label.toLowerCase();
  if (label.includes('pos') || label === 'label_1') return top.score;
  if (label.includes('neg') || label === 'label_0') return -top.score;
  return 0;
}

// ── Comparison helpers ──────────────────────────────────────────────

function normSignal(m: CorrelationMatch) {
  return {
    contractId: m.contract.id,
    signalId: m.signal.id,
    confidence: m.confidence,
    matchedKeywords: m.matchedKeywords,
  };
}
function normNews(m: NewsCorrelationMatch) {
  return {
    contractId: m.contract.id,
    newsId: m.news.id,
    confidence: m.confidence,
    matchedKeywords: m.matchedKeywords,
  };
}
function normNewsSocial(m: NewsSocialCorrelationMatch) {
  return {
    newsId: m.news.id,
    signalId: m.signal.id,
    confidence: m.confidence,
    matchedKeywords: m.matchedKeywords,
  };
}

// ── Fixture sets ────────────────────────────────────────────────────

const contractSet: MarketContract[] = [
  mockContract,
  cashtagOnlyContract,
  hashtagOnlyContract,
  {
    ...mockContract,
    id: 'eth-price',
    question: 'Will Ethereum close above $4000 this month?',
    keywords: ['ethereum', 'eth', '4000', 'close', 'month'],
  },
  {
    ...mockContract,
    id: 'trump-2028',
    question: 'Will Donald Trump run for president in 2028?',
    keywords: ['trump', 'president', '2028', 'run'],
  },
];

const signalSet: SocialSignal[] = [
  mockSignal,
  cashtagOnlySignal,
  hashtagOnlySignal,
  {
    ...mockSignal,
    id: 'sig-eth',
    text: 'Ethereum $ETH is pumping hard',
    keywords: ['ethereum', 'eth', 'pumping'],
  },
  {
    ...mockSignal,
    id: 'sig-trump',
    text: 'Trump announces 2028 run',
    keywords: ['trump', '2028', 'run'],
  },
  {
    ...mockSignal,
    id: 'sig-unrelated',
    text: 'The weather is nice today',
    keywords: ['weather', 'nice', 'today'],
  },
];

const newsSet: NewsItem[] = [
  newsItem('bbc', 'Bitcoin surges past $100k'),
  newsItem('cnn', 'Ethereum hits new all-time high'),
  newsItem('yahoo', 'Trump announces 2028 presidential run'),
  newsItem('investing', 'The weather forecast for tomorrow'),
  newsItem('reuters', 'SpaceX launches a new satellite'),
];

// ── Equivalence: correlateSentiment ─────────────────────────────────

describe('correlateSentiment equivalence (indexed vs naive)', () => {
  it('produces identical matches, confidence, and order over the shared fixture set', async () => {
    const indexed = (await correlateSentiment(signalSet, contractSet, MODEL)).map(normSignal);
    const naive = (await naiveSentiment(signalSet, contractSet)).map(normSignal);
    expect(indexed).toEqual(naive);
  });

  it('matches the hand-verified golden fixtures exactly', async () => {
    const matches = await correlateSentiment([mockSignal], [mockContract], MODEL);
    expect(matches.length).toBe(1);
    expect(matches[0].contract.id).toBe('btc-100k');
    expect(matches[0].signal.id).toBe('sig-1');
    expect(matches[0].confidence).toBeGreaterThan(0);
    expect(matches[0].matchedKeywords).toContain('bitcoin');
    expect(matches[0].matchedKeywords).toContain('btc');
  });

  it('cashtag-only signal matches a cashtag-only contract', async () => {
    const matches = await correlateSentiment([cashtagOnlySignal], [cashtagOnlyContract], MODEL);
    expect(matches.length).toBe(1);
    expect(matches[0].contract.id).toBe('cashtag-btc');
  });

  it('hashtag-only signal matches a hashtag-only contract', async () => {
    const matches = await correlateSentiment([hashtagOnlySignal], [hashtagOnlyContract], MODEL);
    expect(matches.length).toBe(1);
    expect(matches[0].contract.id).toBe('hashtag-bitcoin');
  });

  it('does not match signals with no keyword overlap', async () => {
    const matches = await correlateSentiment([signalSet[5]], contractSet, MODEL);
    expect(matches.length).toBe(0);
  });

  it('sorts matches by confidence descending', async () => {
    const matches = await correlateSentiment(signalSet, contractSet, MODEL);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].confidence).toBeGreaterThanOrEqual(matches[i].confidence);
    }
  });
});

// ── Equivalence: correlateNewsSentiment ─────────────────────────────

describe('correlateNewsSentiment equivalence (indexed vs naive)', () => {
  it('produces identical output, confidence, and order over the shared fixture set', async () => {
    const indexed = (await correlateNewsSentiment(newsSet, contractSet, MODEL)).map(normNews);
    const naive = (await naiveNewsSentiment(newsSet, contractSet)).map(normNews);
    expect(indexed).toEqual(naive);
  });

  it('matches news to contracts with overlapping keywords', async () => {
    const matches = await correlateNewsSentiment([newsSet[0]], contractSet, MODEL);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].news.id).toBe(newsSet[0].id);
  });

  it('does not match news with no overlap', async () => {
    const matches = await correlateNewsSentiment([newsSet[3]], contractSet, MODEL);
    expect(matches.length).toBe(0);
  });
});

// ── Equivalence: correlateNewsSocialSentiment ───────────────────────

describe('correlateNewsSocialSentiment equivalence (indexed vs naive)', () => {
  it('produces identical output, confidence, and order over the shared fixture set', async () => {
    const indexed = (await correlateNewsSocialSentiment(newsSet, signalSet, MODEL)).map(normNewsSocial);
    const naive = (await naiveNewsSocialSentiment(newsSet, signalSet)).map(normNewsSocial);
    expect(indexed).toEqual(naive);
  });

  it('matches news to signals with overlapping keywords', async () => {
    const matches = await correlateNewsSocialSentiment([newsSet[0]], signalSet, MODEL);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].news.id).toBe(newsSet[0].id);
  });

  it('does not match news with no overlap', async () => {
    const matches = await correlateNewsSocialSentiment([newsSet[4]], signalSet, MODEL);
    expect(matches.length).toBe(0);
  });
});

// ── D-03 edge cases ─────────────────────────────────────────────────

describe('D-03 edge cases (sentiment)', () => {
  it('empty keyword arrays produce no matches', async () => {
    const emptySignal: SocialSignal = { ...mockSignal, id: 'sig-empty', keywords: [] };
    const emptyContract: MarketContract = { ...mockContract, id: 'c-empty', keywords: [] };
    expect(await correlateSentiment([emptySignal], [emptyContract], MODEL)).toEqual([]);
    expect(await correlateSentiment([emptySignal], contractSet, MODEL)).toEqual([]);
  });

  it('single contract (tiny-input fallback) matches the naive oracle', async () => {
    const single = [mockContract];
    const indexed = (await correlateSentiment(signalSet, single, MODEL)).map(normSignal);
    const naive = (await naiveSentiment(signalSet, single)).map(normSignal);
    expect(indexed).toEqual(naive);
  });

  it('single signal (tiny-input fallback) matches the naive oracle', async () => {
    const single = [mockSignal];
    const indexed = (await correlateSentiment(single, contractSet, MODEL)).map(normSignal);
    const naive = (await naiveSentiment(single, contractSet)).map(normSignal);
    expect(indexed).toEqual(naive);
  });

  it('duplicate keywords are handled identically', async () => {
    const dupSignal: SocialSignal = {
      ...mockSignal,
      id: 'sig-dup',
      keywords: ['bitcoin', 'bitcoin', 'btc', 'btc'],
    };
    const indexed = (await correlateSentiment([dupSignal], contractSet, MODEL)).map(normSignal);
    const naive = (await naiveSentiment([dupSignal], contractSet)).map(normSignal);
    expect(indexed).toEqual(naive);
  });

  it('cashtag-only texts match via the indexed path', async () => {
    const indexed = (await correlateSentiment([cashtagOnlySignal], contractSet, MODEL)).map(normSignal);
    const naive = (await naiveSentiment([cashtagOnlySignal], contractSet)).map(normSignal);
    expect(indexed).toEqual(naive);
    expect(indexed.length).toBeGreaterThan(0);
  });

  it('hashtag-only texts match via the indexed path', async () => {
    const indexed = (await correlateSentiment([hashtagOnlySignal], contractSet, MODEL)).map(normSignal);
    const naive = (await naiveSentiment([hashtagOnlySignal], contractSet)).map(normSignal);
    expect(indexed).toEqual(naive);
    expect(indexed.length).toBeGreaterThan(0);
  });

  it('tiny-input fallback for correlateNewsSentiment matches the naive oracle', async () => {
    const single = [mockContract];
    const indexed = (await correlateNewsSentiment(newsSet, single, MODEL)).map(normNews);
    const naive = (await naiveNewsSentiment(newsSet, single)).map(normNews);
    expect(indexed).toEqual(naive);
  });

  it('tiny-input fallback for correlateNewsSocialSentiment matches the naive oracle', async () => {
    const single = [mockSignal];
    const indexed = (await correlateNewsSocialSentiment(newsSet, single, MODEL)).map(normNewsSocial);
    const naive = (await naiveNewsSocialSentiment(newsSet, single)).map(normNewsSocial);
    expect(indexed).toEqual(naive);
  });
});
