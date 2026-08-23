/**
 * Embedding correlation equivalence tests (D-02 / D-03 / D-04).
 *
 * ── Why the keyword index does NOT apply to embedding ──────────────
 * The embedding engine (`correlateEmbedding`) uses pure SEMANTIC cosine
 * similarity between contract questions and signal/news text. A contract can
 * match a signal with ZERO keyword overlap — e.g. the signal "Powell hints at
 * rate relief" semantically matches the contract "Will the Fed cut rates?"
 * even though they share no keyword. A keyword-only inverted index is therefore
 * NOT a valid superset of the embedding engine's matches: routing embedding
 * through it would silently drop valid semantic matches and break the locked
 * D-02 equivalence requirement.
 *
 * Consequently the embedding engine REMAINS on the naive loop (its dominant
 * cost is already the batched embedding forward pass, not the O(n²) cosine
 * comparison). This file proves the naive-loop output is correct and stable by
 * comparing the production `correlateEmbedding` against an independent
 * hand-verified oracle over the shared fixtures, the golden fixtures, and the
 * D-03 edge cases. It also documents — via a zero-keyword-overlap semantic
 * fixture — why a future contributor must NOT route embedding through the
 * keyword index.
 *
 * The transformers pipeline is mocked with a deterministic stub so the test
 * runs without loading a real ONNX model. Both the production path and the
 * oracle call the same stub, so equivalence is a true comparison of the
 * correlation loop.
 */

import { describe, it, expect, vi } from 'vitest';
import { correlateEmbedding } from '@/services/engine/ml/embedding';
import { getEmbeddingPipeline } from '@/services/engine/ml/transformers';
import { EMBEDDING_THRESHOLD } from '@/services/engine/ml/types';
import {
  mockContract,
  mockSignal,
  cashtagOnlyContract,
  cashtagOnlySignal,
  hashtagOnlyContract,
  hashtagOnlySignal,
} from './fixtures';
import type {
  CorrelationMatch,
  EmbeddingModel,
  MarketContract,
  SocialSignal,
} from '@/types';

const MODEL: EmbeddingModel = 'Xenova/all-MiniLM-L6-v2';

// ── Mock the transformers pipeline ──────────────────────────────────
// Deterministic stub: maps each text to a fixed concept-based vector. Both the
// production path and the oracle call the same stub, so equivalence is a true
// comparison of the correlation loop (not of the embedding math).

const CONCEPTS = [
  'fed',
  'rate',
  'powell',
  'bitcoin',
  'btc',
  'crypto',
  'ethereum',
  'eth',
  'trump',
  'weather',
  'moon',
];

/** Deterministic concept-based vector for a text (L2-normalized by the engine). */
function embedVector(text: string): number[] {
  const lower = text.toLowerCase();
  return CONCEPTS.map((c) => (lower.includes(c) ? 1 : 0));
}

vi.mock('@/services/engine/ml/transformers', () => ({
  getEmbeddingPipeline: vi.fn(async () => {
    return async (texts: string[]) => ({ data: texts.map(embedVector) });
  }),
}));

// ── Naive oracle (replicate the pre-change nested loop) ─────────────

/** Independent L2-normalize (not imported from production math). */
function normalize(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < v.length; i++) v[i] /= norm;
  }
  return v;
}

/**
 * Independent cosine similarity (not imported from production math).
 * Mirrors the production `cosineSimilarity` exactly: it computes dot, normA,
 * and normB in a single pass over the (already L2-normalized) vectors, then
 * divides by sqrt(normA)*sqrt(normB). Replicating this exact formula (rather
 * than returning a plain dot product) reproduces the identical floating-point
 * result, so deep-equality holds.
 */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Replica of the pre-change `correlateSignalsToContracts` nested loop:
 * embed all contracts + signals, cosine-similarity every pair, threshold at
 * EMBEDDING_THRESHOLD. This is the reference oracle.
 */
async function naiveEmbedding(
  signals: SocialSignal[],
  contracts: MarketContract[],
): Promise<CorrelationMatch[]> {
  const pipeline = await getEmbeddingPipeline(MODEL);
  const contractVectors = (
    (await pipeline(contracts.map((c) => c.question), {
      pooling: 'mean',
      normalize: true,
    })) as { data: number[][] }
  ).data.map(normalize);
  const signalVectors = (
    (await pipeline(signals.map((s) => s.text), {
      pooling: 'mean',
      normalize: true,
    })) as { data: number[][] }
  ).data.map(normalize);

  const matches: CorrelationMatch[] = [];

  for (let i = 0; i < signals.length; i++) {
    const signalEmb = signalVectors[i];
    const signal = signals[i];

    for (let j = 0; j < contracts.length; j++) {
      const sim = cosine(signalEmb, contractVectors[j]);
      if (sim < EMBEDDING_THRESHOLD) continue;

      const contract = contracts[j];
      const viralityWeight = (signal.virality / 100) * 0.1;
      const confidence = Math.min(1, sim + viralityWeight);

      matches.push({
        contract,
        signal,
        confidence,
        matchedKeywords: signal.keywords.filter((k) =>
          contract.keywords.includes(k),
        ),
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

// ── Comparison helper ───────────────────────────────────────────────

function normSignal(m: CorrelationMatch) {
  return {
    contractId: m.contract.id,
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
  {
    ...mockContract,
    id: 'fed-rates',
    question: 'Will the Fed cut rates?',
    keywords: ['fed', 'rates', 'cut'],
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
  {
    ...mockSignal,
    id: 'sig-powell',
    text: 'Powell hints at rate relief',
    keywords: ['powell', 'rate', 'relief'],
  },
];

// ── Equivalence: correlateEmbedding ─────────────────────────────────

describe('correlateEmbedding equivalence (naive-loop oracle)', () => {
  it('produces identical matches, confidence, and order over the shared fixture set', async () => {
    const production = (await correlateEmbedding(signalSet, contractSet, MODEL)).map(normSignal);
    const naive = (await naiveEmbedding(signalSet, contractSet)).map(normSignal);
    expect(production).toEqual(naive);
  });

  it('matches the hand-verified golden fixtures exactly', async () => {
    const matches = await correlateEmbedding([mockSignal], [mockContract], MODEL);
    expect(matches.length).toBe(1);
    expect(matches[0].contract.id).toBe('btc-100k');
    expect(matches[0].signal.id).toBe('sig-1');
    expect(matches[0].confidence).toBeGreaterThan(0);
    expect(matches[0].matchedKeywords).toContain('bitcoin');
    expect(matches[0].matchedKeywords).toContain('btc');
  });

  it('matches a contract with ZERO keyword overlap via semantic similarity', async () => {
    // "Powell hints at rate relief" ↔ "Will the Fed cut rates?" share no
    // keyword, yet are semantically close. This documents WHY the keyword
    // index does not apply to embedding: a keyword pre-filter would drop this
    // valid match.
    const signal: SocialSignal = {
      ...mockSignal,
      id: 'sig-powell',
      text: 'Powell hints at rate relief',
      keywords: ['powell', 'rate', 'relief'],
    };
    const contract: MarketContract = {
      ...mockContract,
      id: 'fed-rates',
      question: 'Will the Fed cut rates?',
      keywords: ['fed', 'rates', 'cut'],
    };

    const matches = await correlateEmbedding([signal], [contract], MODEL);
    expect(matches.length).toBe(1);
    expect(matches[0].contract.id).toBe('fed-rates');
    expect(matches[0].signal.id).toBe('sig-powell');
    // Zero keyword overlap → no keyword-based matchedKeywords, but the match
    // still exists via semantic similarity.
    expect(matches[0].matchedKeywords).toEqual([]);
  });

  it('sorts matches by confidence descending', async () => {
    const matches = await correlateEmbedding(signalSet, contractSet, MODEL);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].confidence).toBeGreaterThanOrEqual(matches[i].confidence);
    }
  });
});

// ── D-03 edge cases ─────────────────────────────────────────────────

describe('D-03 edge cases (embedding)', () => {
  it('empty keyword arrays still match via semantic similarity (naive == production)', async () => {
    const emptySignal: SocialSignal = { ...mockSignal, id: 'sig-empty', keywords: [] };
    const emptyContract: MarketContract = { ...mockContract, id: 'c-empty', keywords: [] };
    const production = (await correlateEmbedding([emptySignal], [emptyContract], MODEL)).map(normSignal);
    const naive = (await naiveEmbedding([emptySignal], [emptyContract])).map(normSignal);
    expect(production).toEqual(naive);
  });

  it('single contract (tiny-input fallback) matches the naive oracle', async () => {
    const single = [mockContract];
    const production = (await correlateEmbedding(signalSet, single, MODEL)).map(normSignal);
    const naive = (await naiveEmbedding(signalSet, single)).map(normSignal);
    expect(production).toEqual(naive);
  });

  it('single signal (tiny-input fallback) matches the naive oracle', async () => {
    const single = [mockSignal];
    const production = (await correlateEmbedding(single, contractSet, MODEL)).map(normSignal);
    const naive = (await naiveEmbedding(single, contractSet)).map(normSignal);
    expect(production).toEqual(naive);
  });

  it('duplicate keywords are handled identically', async () => {
    const dupSignal: SocialSignal = {
      ...mockSignal,
      id: 'sig-dup',
      keywords: ['bitcoin', 'bitcoin', 'btc', 'btc'],
    };
    const production = (await correlateEmbedding([dupSignal], contractSet, MODEL)).map(normSignal);
    const naive = (await naiveEmbedding([dupSignal], contractSet)).map(normSignal);
    expect(production).toEqual(naive);
  });

  it('cashtag-only texts match the naive oracle', async () => {
    const production = (await correlateEmbedding([cashtagOnlySignal], contractSet, MODEL)).map(normSignal);
    const naive = (await naiveEmbedding([cashtagOnlySignal], contractSet)).map(normSignal);
    expect(production).toEqual(naive);
  });

  it('hashtag-only texts match the naive oracle', async () => {
    const production = (await correlateEmbedding([hashtagOnlySignal], contractSet, MODEL)).map(normSignal);
    const naive = (await naiveEmbedding([hashtagOnlySignal], contractSet)).map(normSignal);
    expect(production).toEqual(naive);
  });
});
