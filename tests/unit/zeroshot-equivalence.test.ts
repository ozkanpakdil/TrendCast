/**
 * Zero-shot correlation equivalence tests (D-02 / D-03 / D-04).
 *
 * The zero-shot engine (`correlateZeroShot`, `correlateNewsZeroShot`,
 * `correlateNewsSocialZeroShot`) was converted from the ad-hoc
 * `findCandidateContracts`/`findCandidateContractsForNews` keyword filters to
 * candidate-filtered via the shared `InvertedIndex`. This file proves the
 * indexed output is IDENTICAL to the naive keyword-filtered path — same
 * matches, same confidence, same order — over the shared fixtures, the
 * hand-verified golden fixtures, and the D-03 edge cases.
 *
 * Because zero-shot requires a real NLI model, the transformers pipeline is
 * mocked with a deterministic stub. The naive oracle below replicates the
 * pre-change `findCandidateContracts`-based loop (including the pipeline call)
 * so the indexed path is compared against an independent reference.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  correlateZeroShot,
  correlateNewsZeroShot,
  correlateNewsSocialZeroShot,
} from '@/services/engine/ml/zeroshot';
import { getZeroShotPipeline } from '@/services/engine/ml/transformers';
import { ZEROSHOT_THRESHOLD, ZEROSHOT_MAX_LABELS } from '@/services/engine/ml/types';
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
  SocialSignal,
  ZeroShotModel,
} from '@/types';

const MODEL: ZeroShotModel = 'Xenova/distilbert-base-uncased-mnli';

// ── Mock the transformers pipeline ──────────────────────────────────
// Deterministic stub: the first candidate label scores above threshold,
// the rest score below. Both the indexed path and the naive oracle call the
// same stub, so equivalence is a true comparison of candidate selection.

vi.mock('@/services/engine/ml/transformers', () => ({
  getZeroShotPipeline: vi.fn(async () => {
    return async (_text: string, labels: string[]) => ({
      labels,
      scores: labels.map((_, i) => (i === 0 ? 0.9 : 0.1)),
    });
  }),
}));

// ── Naive oracle (replicate the pre-change engine) ──────────────────

/** Replica of the pre-change `findCandidateContracts`-based loop. */
async function naiveZeroShot(
  signals: SocialSignal[],
  contracts: MarketContract[],
): Promise<CorrelationMatch[]> {
  const pipeline = await getZeroShotPipeline(MODEL);
  const matches: CorrelationMatch[] = [];

  for (const signal of signals) {
    const candidates = contracts
      .filter((c) => c.keywords.some((k) => signal.keywords.includes(k)))
      .slice(0, ZEROSHOT_MAX_LABELS);
    if (candidates.length === 0) continue;

    const candidateLabels = candidates.map((c) => c.question.slice(0, 200));
    const output = (await pipeline(signal.text, candidateLabels)) as {
      labels: string[];
      scores: number[];
    };
    const scores = new Map<string, number>();
    for (let i = 0; i < output.labels.length; i++) {
      scores.set(output.labels[i], output.scores[i]);
    }

    for (let j = 0; j < candidates.length; j++) {
      const entailmentScore = scores.get(candidateLabels[j]) ?? 0;
      if (entailmentScore < ZEROSHOT_THRESHOLD) continue;

      const viralityWeight = (signal.virality / 100) * 0.1;
      const confidence = Math.min(1, entailmentScore + viralityWeight);

      matches.push({
        contract: candidates[j],
        signal,
        confidence,
        matchedKeywords: signal.keywords.filter((k) =>
          candidates[j].keywords.includes(k),
        ),
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

/** Replica of the pre-change `findCandidateContractsForNews`-based loop. */
async function naiveNewsZero(
  news: NewsItem[],
  contracts: MarketContract[],
): Promise<NewsCorrelationMatch[]> {
  const pipeline = await getZeroShotPipeline(MODEL);
  const matches: NewsCorrelationMatch[] = [];

  for (const item of news) {
    const candidates = contracts
      .filter((c) => c.keywords.some((k) => item.keywords.includes(k)))
      .slice(0, ZEROSHOT_MAX_LABELS);
    if (candidates.length === 0) continue;

    const candidateLabels = candidates.map((c) => c.question.slice(0, 200));
    const output = (await pipeline(item.headline, candidateLabels)) as {
      labels: string[];
      scores: number[];
    };
    const scores = new Map<string, number>();
    for (let i = 0; i < output.labels.length; i++) {
      scores.set(output.labels[i], output.scores[i]);
    }

    for (let j = 0; j < candidates.length; j++) {
      const entailmentScore = scores.get(candidateLabels[j]) ?? 0;
      if (entailmentScore < ZEROSHOT_THRESHOLD) continue;

      matches.push({
        contract: candidates[j],
        news: item,
        confidence: Math.min(1, entailmentScore + 0.05),
        matchedKeywords: item.keywords.filter((k) =>
          candidates[j].keywords.includes(k),
        ),
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

/** Replica of the pre-change inline `news.filter(...)` loop. */
async function naiveNewsSocialZero(
  news: NewsItem[],
  signals: SocialSignal[],
): Promise<NewsSocialCorrelationMatch[]> {
  const pipeline = await getZeroShotPipeline(MODEL);
  const matches: NewsSocialCorrelationMatch[] = [];

  for (const signal of signals) {
    const candidateNews = news
      .filter((n) => n.keywords.some((k) => signal.keywords.includes(k)))
      .slice(0, ZEROSHOT_MAX_LABELS);
    if (candidateNews.length === 0) continue;

    const newsLabels = candidateNews.map((n) => n.headline.slice(0, 200));
    const output = (await pipeline(signal.text, newsLabels)) as {
      labels: string[];
      scores: number[];
    };
    const scores = new Map<string, number>();
    for (let i = 0; i < output.labels.length; i++) {
      scores.set(output.labels[i], output.scores[i]);
    }

    for (let j = 0; j < candidateNews.length; j++) {
      const entailmentScore = scores.get(newsLabels[j]) ?? 0;
      if (entailmentScore < ZEROSHOT_THRESHOLD) continue;

      const viralityWeight = (signal.virality / 100) * 0.1;
      const confidence = Math.min(1, entailmentScore + viralityWeight);

      matches.push({
        news: candidateNews[j],
        signal,
        confidence,
        matchedKeywords: candidateNews[j].keywords.filter((k) =>
          signal.keywords.includes(k),
        ),
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
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
  newsItem('yahoo', 'SpaceX launches a new satellite'),
];

// ── Equivalence: correlateZeroShot ──────────────────────────────────

describe('correlateZeroShot equivalence (indexed vs naive)', () => {
  it('produces identical matches, confidence, and order over the shared fixture set', async () => {
    const indexed = (await correlateZeroShot(signalSet, contractSet, MODEL)).map(normSignal);
    const naive = (await naiveZeroShot(signalSet, contractSet)).map(normSignal);
    expect(indexed).toEqual(naive);
  });

  it('matches the hand-verified golden fixtures exactly', async () => {
    const matches = await correlateZeroShot([mockSignal], [mockContract], MODEL);
    expect(matches.length).toBe(1);
    expect(matches[0].contract.id).toBe('btc-100k');
    expect(matches[0].signal.id).toBe('sig-1');
    expect(matches[0].confidence).toBeGreaterThan(0);
    expect(matches[0].matchedKeywords).toContain('bitcoin');
    expect(matches[0].matchedKeywords).toContain('btc');
  });

  it('cashtag-only signal matches a cashtag-only contract', async () => {
    const matches = await correlateZeroShot([cashtagOnlySignal], [cashtagOnlyContract], MODEL);
    expect(matches.length).toBe(1);
    expect(matches[0].contract.id).toBe('cashtag-btc');
  });

  it('hashtag-only signal matches a hashtag-only contract', async () => {
    const matches = await correlateZeroShot([hashtagOnlySignal], [hashtagOnlyContract], MODEL);
    expect(matches.length).toBe(1);
    expect(matches[0].contract.id).toBe('hashtag-bitcoin');
  });

  it('does not match signals with no keyword overlap', async () => {
    const matches = await correlateZeroShot([signalSet[5]], contractSet, MODEL);
    expect(matches.length).toBe(0);
  });

  it('sorts matches by confidence descending', async () => {
    const matches = await correlateZeroShot(signalSet, contractSet, MODEL);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].confidence).toBeGreaterThanOrEqual(matches[i].confidence);
    }
  });
});

// ── Equivalence: correlateNewsZeroShot ──────────────────────────────

describe('correlateNewsZeroShot equivalence (indexed vs naive)', () => {
  it('produces identical output, confidence, and order over the shared fixture set', async () => {
    const indexed = (await correlateNewsZeroShot(newsSet, contractSet, MODEL)).map(normNews);
    const naive = (await naiveNewsZero(newsSet, contractSet)).map(normNews);
    expect(indexed).toEqual(naive);
  });

  it('matches news to contracts with overlapping keywords', async () => {
    const matches = await correlateNewsZeroShot([newsSet[0]], contractSet, MODEL);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].news.id).toBe(newsSet[0].id);
  });

  it('does not match news with no overlap', async () => {
    const matches = await correlateNewsZeroShot([newsSet[3]], contractSet, MODEL);
    expect(matches.length).toBe(0);
  });
});

// ── Equivalence: correlateNewsSocialZeroShot ────────────────────────

describe('correlateNewsSocialZeroShot equivalence (indexed vs naive)', () => {
  it('produces identical output, confidence, and order over the shared fixture set', async () => {
    const indexed = (await correlateNewsSocialZeroShot(newsSet, signalSet, MODEL)).map(normNewsSocial);
    const naive = (await naiveNewsSocialZero(newsSet, signalSet)).map(normNewsSocial);
    expect(indexed).toEqual(naive);
  });

  it('matches news to signals with overlapping keywords', async () => {
    const matches = await correlateNewsSocialZeroShot([newsSet[0]], signalSet, MODEL);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].news.id).toBe(newsSet[0].id);
  });

  it('does not match news with no overlap', async () => {
    const matches = await correlateNewsSocialZeroShot([newsSet[4]], signalSet, MODEL);
    expect(matches.length).toBe(0);
  });
});

// ── D-03 edge cases ─────────────────────────────────────────────────

describe('D-03 edge cases (zeroshot)', () => {
  it('empty keyword arrays produce no matches', async () => {
    const emptySignal: SocialSignal = { ...mockSignal, id: 'sig-empty', keywords: [] };
    const emptyContract: MarketContract = { ...mockContract, id: 'c-empty', keywords: [] };
    expect(await correlateZeroShot([emptySignal], [emptyContract], MODEL)).toEqual([]);
    expect(await correlateZeroShot([emptySignal], contractSet, MODEL)).toEqual([]);
  });

  it('single contract (tiny-input fallback) matches the naive oracle', async () => {
    const single = [mockContract];
    const indexed = (await correlateZeroShot(signalSet, single, MODEL)).map(normSignal);
    const naive = (await naiveZeroShot(signalSet, single)).map(normSignal);
    expect(indexed).toEqual(naive);
  });

  it('single signal (tiny-input fallback) matches the naive oracle', async () => {
    const single = [mockSignal];
    const indexed = (await correlateZeroShot(single, contractSet, MODEL)).map(normSignal);
    const naive = (await naiveZeroShot(single, contractSet)).map(normSignal);
    expect(indexed).toEqual(naive);
  });

  it('duplicate keywords are handled identically', async () => {
    const dupSignal: SocialSignal = {
      ...mockSignal,
      id: 'sig-dup',
      keywords: ['bitcoin', 'bitcoin', 'btc', 'btc'],
    };
    const indexed = (await correlateZeroShot([dupSignal], contractSet, MODEL)).map(normSignal);
    const naive = (await naiveZeroShot([dupSignal], contractSet)).map(normSignal);
    expect(indexed).toEqual(naive);
  });

  it('cashtag-only texts match via the indexed path', async () => {
    const indexed = (await correlateZeroShot([cashtagOnlySignal], contractSet, MODEL)).map(normSignal);
    const naive = (await naiveZeroShot([cashtagOnlySignal], contractSet)).map(normSignal);
    expect(indexed).toEqual(naive);
    expect(indexed.length).toBeGreaterThan(0);
  });

  it('hashtag-only texts match via the indexed path', async () => {
    const indexed = (await correlateZeroShot([hashtagOnlySignal], contractSet, MODEL)).map(normSignal);
    const naive = (await naiveZeroShot([hashtagOnlySignal], contractSet)).map(normSignal);
    expect(indexed).toEqual(naive);
    expect(indexed.length).toBeGreaterThan(0);
  });

  it('tiny-input fallback for correlateNewsZeroShot matches the naive oracle', async () => {
    const single = [mockContract];
    const indexed = (await correlateNewsZeroShot(newsSet, single, MODEL)).map(normNews);
    const naive = (await naiveNewsZero(newsSet, single)).map(normNews);
    expect(indexed).toEqual(naive);
  });

  it('tiny-input fallback for correlateNewsSocialZeroShot matches the naive oracle', async () => {
    const single = [mockSignal];
    const indexed = (await correlateNewsSocialZeroShot(newsSet, single, MODEL)).map(normNewsSocial);
    const naive = (await naiveNewsSocialZero(newsSet, single)).map(normNewsSocial);
    expect(indexed).toEqual(naive);
  });
});
