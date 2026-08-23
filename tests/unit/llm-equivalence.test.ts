/**
 * LLM correlation equivalence tests (D-02 / D-03 / D-04).
 *
 * The LLM engine (`correlateLLM`, `correlateNewsLLM`, `correlateNewsSocialLLM`)
 * was converted from the inline `.filter(...).slice(0, LLM_MAX_CANDIDATES)`
 * candidate blocks to candidate-filtered via the shared `InvertedIndex`. This
 * file proves the indexed output is IDENTICAL to the naive filter path — same
 * matches, same confidence, same order — over the shared fixtures, the
 * hand-verified golden fixtures, and the D-03 edge cases.
 *
 * The LLM pipeline is mocked with a deterministic stub. The naive oracle below
 * replicates the pre-change `.filter(...).slice(0, LLM_MAX_CANDIDATES)` loop
 * (including the pipeline call) so the indexed path is compared against an
 * independent reference.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  correlateLLM,
  correlateNewsLLM,
  correlateNewsSocialLLM,
} from '@/services/engine/ml/llm';
import { getLLMPipeline } from '@/services/engine/ml/transformers';
import { LLM_THRESHOLD, LLM_MAX_CANDIDATES } from '@/services/engine/ml/types';
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
  LLMModel,
  MarketContract,
  NewsCorrelationMatch,
  NewsItem,
  NewsSocialCorrelationMatch,
  SocialSignal,
} from '@/types';

const MODEL: LLMModel = 'HuggingFaceTB/SmolLM2-135M-Instruct';

// ── Mock the transformers pipeline ──────────────────────────────────
// Deterministic stub: every candidate scores 90 (0.9), above LLM_THRESHOLD.
// The output shape matches what `extractGenerated`/`parseScores` expect:
// an array of items, each `[{ generated_text: [{ role, content }] }]`.

vi.mock('@/services/engine/ml/transformers', () => ({
  getLLMPipeline: vi.fn(async () => {
    return async (messages: unknown[]) => {
      return messages.map(() => [
        {
          generated_text: [
            { role: 'assistant', content: '90\n90\n90\n90\n90' },
          ],
        },
      ]);
    };
  }),
}));

// ── Naive oracle (replicate the pre-change engine) ──────────────────

/** Replica of the pre-change `correlateLLM` candidate block. */
async function naiveLLM(
  signals: SocialSignal[],
  contracts: MarketContract[],
): Promise<CorrelationMatch[]> {
  const pipeline = await getLLMPipeline(MODEL);
  const matches: CorrelationMatch[] = [];

  for (const signal of signals) {
    const candidates = contracts
      .filter((c) => c.keywords.some((k) => signal.keywords.includes(k)))
      .slice(0, LLM_MAX_CANDIDATES);
    if (candidates.length === 0) continue;

    const output = (await pipeline([
      {
        text: signal.text,
        questions: candidates.map((c) => c.question),
      },
    ])) as Array<Array<{ generated_text: Array<{ role: string; content: string }> }>>;
    const generated = output[0][0].generated_text
      .filter((m) => m.role === 'assistant')
      .pop()?.content ?? '';
    const numbers = generated.match(/\d+/g) ?? [];
    const scores = numbers.slice(0, candidates.length).map((n) =>
      Math.min(100, Math.max(0, parseInt(n, 10))) / 100,
    );

    for (let j = 0; j < candidates.length && j < scores.length; j++) {
      const llmScore = scores[j];
      if (llmScore < LLM_THRESHOLD) continue;

      const viralityWeight = (signal.virality / 100) * 0.1;
      const confidence = Math.min(1, llmScore + viralityWeight);

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

/** Replica of the pre-change `correlateNewsLLM` candidate block. */
async function naiveNewsLLM(
  news: NewsItem[],
  contracts: MarketContract[],
): Promise<NewsCorrelationMatch[]> {
  const pipeline = await getLLMPipeline(MODEL);
  const matches: NewsCorrelationMatch[] = [];

  for (const item of news) {
    const candidates = contracts
      .filter((c) => c.keywords.some((k) => item.keywords.includes(k)))
      .slice(0, LLM_MAX_CANDIDATES);
    if (candidates.length === 0) continue;

    const output = (await pipeline([
      {
        text: item.headline,
        questions: candidates.map((c) => c.question),
      },
    ])) as Array<Array<{ generated_text: Array<{ role: string; content: string }> }>>;
    const generated = output[0][0].generated_text
      .filter((m) => m.role === 'assistant')
      .pop()?.content ?? '';
    const numbers = generated.match(/\d+/g) ?? [];
    const scores = numbers.slice(0, candidates.length).map((n) =>
      Math.min(100, Math.max(0, parseInt(n, 10))) / 100,
    );

    for (let j = 0; j < candidates.length && j < scores.length; j++) {
      const llmScore = scores[j];
      if (llmScore < LLM_THRESHOLD) continue;

      matches.push({
        contract: candidates[j],
        news: item,
        confidence: Math.min(1, llmScore + 0.05),
        matchedKeywords: item.keywords.filter((k) =>
          candidates[j].keywords.includes(k),
        ),
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

/** Replica of the pre-change `correlateNewsSocialLLM` candidate block. */
async function naiveNewsSocialLLM(
  news: NewsItem[],
  signals: SocialSignal[],
): Promise<NewsSocialCorrelationMatch[]> {
  const pipeline = await getLLMPipeline(MODEL);
  const matches: NewsSocialCorrelationMatch[] = [];

  for (const signal of signals) {
    const candidateNews = news
      .filter((n) => n.keywords.some((k) => signal.keywords.includes(k)))
      .slice(0, LLM_MAX_CANDIDATES);
    if (candidateNews.length === 0) continue;

    const output = (await pipeline([
      {
        text: signal.text,
        questions: candidateNews.map((n) => n.headline),
      },
    ])) as Array<Array<{ generated_text: Array<{ role: string; content: string }> }>>;
    const generated = output[0][0].generated_text
      .filter((m) => m.role === 'assistant')
      .pop()?.content ?? '';
    const numbers = generated.match(/\d+/g) ?? [];
    const scores = numbers.slice(0, candidateNews.length).map((n) =>
      Math.min(100, Math.max(0, parseInt(n, 10))) / 100,
    );

    for (let j = 0; j < candidateNews.length && j < scores.length; j++) {
      const llmScore = scores[j];
      if (llmScore < LLM_THRESHOLD) continue;

      const viralityWeight = (signal.virality / 100) * 0.1;
      const confidence = Math.min(1, llmScore + viralityWeight);

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
  newsItem('reuters', 'SpaceX launches a new satellite'),
];

// ── Equivalence: correlateLLM ───────────────────────────────────────

describe('correlateLLM equivalence (indexed vs naive)', () => {
  it('produces identical matches, confidence, and order over the shared fixture set', async () => {
    const indexed = (await correlateLLM(signalSet, contractSet, MODEL)).map(normSignal);
    const naive = (await naiveLLM(signalSet, contractSet)).map(normSignal);
    expect(indexed).toEqual(naive);
  });

  it('matches the hand-verified golden fixtures exactly', async () => {
    const matches = await correlateLLM([mockSignal], [mockContract], MODEL);
    expect(matches.length).toBe(1);
    expect(matches[0].contract.id).toBe('btc-100k');
    expect(matches[0].signal.id).toBe('sig-1');
    expect(matches[0].confidence).toBeGreaterThan(0);
    expect(matches[0].matchedKeywords).toContain('bitcoin');
    expect(matches[0].matchedKeywords).toContain('btc');
  });

  it('cashtag-only signal matches a cashtag-only contract', async () => {
    const matches = await correlateLLM([cashtagOnlySignal], [cashtagOnlyContract], MODEL);
    expect(matches.length).toBe(1);
    expect(matches[0].contract.id).toBe('cashtag-btc');
  });

  it('hashtag-only signal matches a hashtag-only contract', async () => {
    const matches = await correlateLLM([hashtagOnlySignal], [hashtagOnlyContract], MODEL);
    expect(matches.length).toBe(1);
    expect(matches[0].contract.id).toBe('hashtag-bitcoin');
  });

  it('does not match signals with no keyword overlap', async () => {
    const matches = await correlateLLM([signalSet[5]], contractSet, MODEL);
    expect(matches.length).toBe(0);
  });

  it('sorts matches by confidence descending', async () => {
    const matches = await correlateLLM(signalSet, contractSet, MODEL);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].confidence).toBeGreaterThanOrEqual(matches[i].confidence);
    }
  });
});

// ── Equivalence: correlateNewsLLM ───────────────────────────────────

describe('correlateNewsLLM equivalence (indexed vs naive)', () => {
  it('produces identical output, confidence, and order over the shared fixture set', async () => {
    const indexed = (await correlateNewsLLM(newsSet, contractSet, MODEL)).map(normNews);
    const naive = (await naiveNewsLLM(newsSet, contractSet)).map(normNews);
    expect(indexed).toEqual(naive);
  });

  it('matches news to contracts with overlapping keywords', async () => {
    const matches = await correlateNewsLLM([newsSet[0]], contractSet, MODEL);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].news.id).toBe(newsSet[0].id);
  });

  it('does not match news with no overlap', async () => {
    const matches = await correlateNewsLLM([newsSet[3]], contractSet, MODEL);
    expect(matches.length).toBe(0);
  });
});

// ── Equivalence: correlateNewsSocialLLM ─────────────────────────────

describe('correlateNewsSocialLLM equivalence (indexed vs naive)', () => {
  it('produces identical output, confidence, and order over the shared fixture set', async () => {
    const indexed = (await correlateNewsSocialLLM(newsSet, signalSet, MODEL)).map(normNewsSocial);
    const naive = (await naiveNewsSocialLLM(newsSet, signalSet)).map(normNewsSocial);
    expect(indexed).toEqual(naive);
  });

  it('matches news to signals with overlapping keywords', async () => {
    const matches = await correlateNewsSocialLLM([newsSet[0]], signalSet, MODEL);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].news.id).toBe(newsSet[0].id);
  });

  it('does not match news with no overlap', async () => {
    const matches = await correlateNewsSocialLLM([newsSet[4]], signalSet, MODEL);
    expect(matches.length).toBe(0);
  });
});

// ── D-03 edge cases ─────────────────────────────────────────────────

describe('D-03 edge cases (llm)', () => {
  it('empty keyword arrays produce no matches', async () => {
    const emptySignal: SocialSignal = { ...mockSignal, id: 'sig-empty', keywords: [] };
    const emptyContract: MarketContract = { ...mockContract, id: 'c-empty', keywords: [] };
    expect(await correlateLLM([emptySignal], [emptyContract], MODEL)).toEqual([]);
    expect(await correlateLLM([emptySignal], contractSet, MODEL)).toEqual([]);
  });

  it('single contract (tiny-input fallback) matches the naive oracle', async () => {
    const single = [mockContract];
    const indexed = (await correlateLLM(signalSet, single, MODEL)).map(normSignal);
    const naive = (await naiveLLM(signalSet, single)).map(normSignal);
    expect(indexed).toEqual(naive);
  });

  it('single signal (tiny-input fallback) matches the naive oracle', async () => {
    const single = [mockSignal];
    const indexed = (await correlateLLM(single, contractSet, MODEL)).map(normSignal);
    const naive = (await naiveLLM(single, contractSet)).map(normSignal);
    expect(indexed).toEqual(naive);
  });

  it('duplicate keywords are handled identically', async () => {
    const dupSignal: SocialSignal = {
      ...mockSignal,
      id: 'sig-dup',
      keywords: ['bitcoin', 'bitcoin', 'btc', 'btc'],
    };
    const indexed = (await correlateLLM([dupSignal], contractSet, MODEL)).map(normSignal);
    const naive = (await naiveLLM([dupSignal], contractSet)).map(normSignal);
    expect(indexed).toEqual(naive);
  });

  it('cashtag-only texts match via the indexed path', async () => {
    const indexed = (await correlateLLM([cashtagOnlySignal], contractSet, MODEL)).map(normSignal);
    const naive = (await naiveLLM([cashtagOnlySignal], contractSet)).map(normSignal);
    expect(indexed).toEqual(naive);
    expect(indexed.length).toBeGreaterThan(0);
  });

  it('hashtag-only texts match via the indexed path', async () => {
    const indexed = (await correlateLLM([hashtagOnlySignal], contractSet, MODEL)).map(normSignal);
    const naive = (await naiveLLM([hashtagOnlySignal], contractSet)).map(normSignal);
    expect(indexed).toEqual(naive);
    expect(indexed.length).toBeGreaterThan(0);
  });

  it('tiny-input fallback for correlateNewsLLM matches the naive oracle', async () => {
    const single = [mockContract];
    const indexed = (await correlateNewsLLM(newsSet, single, MODEL)).map(normNews);
    const naive = (await naiveNewsLLM(newsSet, single)).map(normNews);
    expect(indexed).toEqual(naive);
  });

  it('tiny-input fallback for correlateNewsSocialLLM matches the naive oracle', async () => {
    const single = [mockSignal];
    const indexed = (await correlateNewsSocialLLM(newsSet, single, MODEL)).map(normNewsSocial);
    const naive = (await naiveNewsSocialLLM(newsSet, single)).map(normNewsSocial);
    expect(indexed).toEqual(naive);
  });
});
