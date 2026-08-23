/**
 * NER correlation equivalence tests (D-02 / D-03 / D-04).
 *
 * ── Why the keyword index does NOT apply to NER ────────────────────
 * The NER engine (`correlateNER`) matches on ML-extracted named entities
 * (persons/orgs/locations) via weighted Jaccard similarity over entity sets.
 * A contract can match a signal through a shared named entity that appears in
 * NEITHER contract's `keywords` array — e.g. both mention "Powell" as an
 * entity while the contract's `keywords` omit it. A keyword-only inverted index
 * is therefore NOT a valid superset of the NER engine's matches: routing NER
 * through it would silently drop valid entity matches and break the locked D-02
 * equivalence requirement.
 *
 * Consequently the NER engine REMAINS on the naive loop (its dominant cost is
 * already the batched entity-extraction forward pass, not the O(n²) Jaccard
 * comparison). This file proves the naive-loop output is correct and stable by
 * comparing the production `correlateNER` against an independent hand-verified
 * oracle over the shared fixtures, the golden fixtures, and the D-03 edge cases.
 * It also documents — via an entity-match fixture where the shared entity is
 * absent from the contract's `keywords` — why a future contributor must NOT
 * route NER through the keyword index.
 *
 * The transformers pipeline is mocked with a deterministic stub so the test
 * runs without loading a real ONNX model. Both the production path and the
 * oracle call the same stub, so equivalence is a true comparison of the
 * correlation loop.
 */

import { describe, it, expect, vi } from 'vitest';
import { correlateNER } from '@/services/engine/ml/ner';
import { getNERPipeline } from '@/services/engine/ml/transformers';
import { NER_THRESHOLD } from '@/services/engine/ml/types';
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
  MarketContract,
  NERModel,
  SocialSignal,
} from '@/types';

const MODEL: NERModel = 'Xenova/bert-base-NER-uncased';

// ── Mock the transformers pipeline ──────────────────────────────────
// Deterministic stub: extracts a fixed set of named entities per text. Both the
// production path and the oracle call the same stub, so equivalence is a true
// comparison of the correlation loop (not of the NER model itself).

interface NEREntity {
  entity: string;
  word: string;
  score: number;
  index: number;
}

const ENTITY_NAMES = ['powell', 'trump', 'fed', 'bitcoin', 'ethereum'];

/** Deterministic token-level entity predictions for a text. */
function extractEntities(text: string): NEREntity[] {
  const lower = text.toLowerCase();
  const tokens: NEREntity[] = [];
  for (const name of ENTITY_NAMES) {
    if (lower.includes(name)) {
      tokens.push({ entity: 'B-PER', word: name, score: 0.99, index: 0 });
    }
  }
  return tokens;
}

vi.mock('@/services/engine/ml/transformers', () => ({
  getNERPipeline: vi.fn(async () => {
    return async (texts: string[]) => texts.map(extractEntities);
  }),
}));

// ── Naive oracle (replicate the pre-change nested loop) ─────────────

/** Replica of the production `aggregateEntities` (B-/I- → entity map). */
function aggregateEntities(entities: NEREntity[]): Map<string, number> {
  const entityMap = new Map<string, number>();
  let currentEntity = '';
  let currentType = '';
  let currentScore = 0;
  let currentCount = 0;

  const flushEntity = () => {
    if (currentEntity) {
      const normalized = currentEntity.toLowerCase().trim();
      if (normalized.length > 1) {
        const avgScore = currentScore / currentCount;
        const existing = entityMap.get(normalized);
        if (existing === undefined || avgScore > existing) {
          entityMap.set(normalized, avgScore);
        }
      }
    }
    currentEntity = '';
    currentType = '';
    currentScore = 0;
    currentCount = 0;
  };

  for (const ent of entities) {
    const tag = ent.entity;
    if (tag === 'O' || !tag) {
      flushEntity();
      continue;
    }
    const [prefix, type] = tag.includes('-') ? tag.split('-', 2) : ['B', tag];
    if (prefix === 'B' || type !== currentType) {
      flushEntity();
      currentType = type;
    }
    const word = ent.word.startsWith('##') ? ent.word.slice(2) : ent.word;
    currentEntity = currentEntity ? currentEntity + word : word;
    currentScore += ent.score;
    currentCount++;
  }
  flushEntity();

  return entityMap;
}

/** Replica of the production `nerEntitySimilarity` (weighted Jaccard). */
function nerEntitySimilarity(
  mapA: Map<string, number>,
  mapB: Map<string, number>,
): number {
  if (mapA.size === 0 || mapB.size === 0) return 0;

  let intersectionWeight = 0;
  let unionWeight = 0;

  const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);
  for (const key of allKeys) {
    const wA = mapA.get(key) ?? 0;
    const wB = mapB.get(key) ?? 0;
    intersectionWeight += Math.min(wA, wB);
    unionWeight += Math.max(wA, wB);
  }

  return unionWeight > 0 ? intersectionWeight / unionWeight : 0;
}

/**
 * Replica of the pre-change `correlateSignalsToContracts` nested loop:
 * extract entities, `nerEntitySimilarity` every pair, threshold at
 * NER_THRESHOLD. This is the reference oracle.
 */
async function naiveNER(
  signals: SocialSignal[],
  contracts: MarketContract[],
): Promise<CorrelationMatch[]> {
  const pipeline = await getNERPipeline(MODEL);
  const contractEntities = (
    (await pipeline(contracts.map((c) => c.question))) as NEREntity[][]
  ).map(aggregateEntities);
  const signalEntities = (
    (await pipeline(signals.map((s) => s.text))) as NEREntity[][]
  ).map(aggregateEntities);

  const matches: CorrelationMatch[] = [];

  for (let i = 0; i < signals.length; i++) {
    const signalEnt = signalEntities[i];
    const signal = signals[i];

    for (let j = 0; j < contracts.length; j++) {
      const contractEnt = contractEntities[j];
      const sim = nerEntitySimilarity(signalEnt, contractEnt);
      if (sim < NER_THRESHOLD) continue;

      const viralityWeight = (signal.virality / 100) * 0.1;
      const confidence = Math.min(1, sim + viralityWeight);

      const matchedEntities = [...signalEnt.keys()].filter((k) =>
        contractEnt.has(k),
      );

      matches.push({
        contract: contracts[j],
        signal,
        confidence,
        matchedKeywords: [
          ...new Set([
            ...signal.keywords.filter((k) => contracts[j].keywords.includes(k)),
            ...matchedEntities,
          ]),
        ],
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
    id: 'powell-fed',
    question: 'Will Powell cut rates?',
    keywords: ['rates', 'cut'], // NOTE: "powell" deliberately omitted
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

// ── Equivalence: correlateNER ───────────────────────────────────────

describe('correlateNER equivalence (naive-loop oracle)', () => {
  it('produces identical matches, confidence, and order over the shared fixture set', async () => {
    const production = (await correlateNER(signalSet, contractSet, MODEL)).map(normSignal);
    const naive = (await naiveNER(signalSet, contractSet)).map(normSignal);
    expect(production).toEqual(naive);
  });

  it('matches the hand-verified golden fixtures exactly', async () => {
    const matches = await correlateNER([mockSignal], [mockContract], MODEL);
    expect(matches.length).toBe(1);
    expect(matches[0].contract.id).toBe('btc-100k');
    expect(matches[0].signal.id).toBe('sig-1');
    expect(matches[0].confidence).toBeGreaterThan(0);
    expect(matches[0].matchedKeywords).toContain('bitcoin');
    expect(matches[0].matchedKeywords).toContain('btc');
  });

  it('matches a contract via a shared entity ABSENT from its keywords', async () => {
    // Both texts mention "Powell" as an entity, but the contract's `keywords`
    // omit it. This documents WHY the keyword index does not apply to NER: a
    // keyword pre-filter would drop this valid entity match.
    const signal: SocialSignal = {
      ...mockSignal,
      id: 'sig-powell',
      text: 'Powell hints at rate relief',
      keywords: ['powell', 'rate', 'relief'],
    };
    const contract: MarketContract = {
      ...mockContract,
      id: 'powell-fed',
      question: 'Will Powell cut rates?',
      keywords: ['rates', 'cut'], // "powell" intentionally omitted
    };

    const matches = await correlateNER([signal], [contract], MODEL);
    expect(matches.length).toBe(1);
    expect(matches[0].contract.id).toBe('powell-fed');
    expect(matches[0].signal.id).toBe('sig-powell');
    // The shared entity "powell" is surfaced in matchedKeywords even though it
    // is not in the contract's `keywords`.
    expect(matches[0].matchedKeywords).toContain('powell');
  });

  it('sorts matches by confidence descending', async () => {
    const matches = await correlateNER(signalSet, contractSet, MODEL);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].confidence).toBeGreaterThanOrEqual(matches[i].confidence);
    }
  });
});

// ── D-03 edge cases ─────────────────────────────────────────────────

describe('D-03 edge cases (NER)', () => {
  it('empty keyword arrays still match via entity similarity (naive == production)', async () => {
    const emptySignal: SocialSignal = { ...mockSignal, id: 'sig-empty', keywords: [] };
    const emptyContract: MarketContract = { ...mockContract, id: 'c-empty', keywords: [] };
    const production = (await correlateNER([emptySignal], [emptyContract], MODEL)).map(normSignal);
    const naive = (await naiveNER([emptySignal], [emptyContract])).map(normSignal);
    expect(production).toEqual(naive);
  });

  it('single contract (tiny-input fallback) matches the naive oracle', async () => {
    const single = [mockContract];
    const production = (await correlateNER(signalSet, single, MODEL)).map(normSignal);
    const naive = (await naiveNER(signalSet, single)).map(normSignal);
    expect(production).toEqual(naive);
  });

  it('single signal (tiny-input fallback) matches the naive oracle', async () => {
    const single = [mockSignal];
    const production = (await correlateNER(single, contractSet, MODEL)).map(normSignal);
    const naive = (await naiveNER(single, contractSet)).map(normSignal);
    expect(production).toEqual(naive);
  });

  it('duplicate keywords are handled identically', async () => {
    const dupSignal: SocialSignal = {
      ...mockSignal,
      id: 'sig-dup',
      keywords: ['bitcoin', 'bitcoin', 'btc', 'btc'],
    };
    const production = (await correlateNER([dupSignal], contractSet, MODEL)).map(normSignal);
    const naive = (await naiveNER([dupSignal], contractSet)).map(normSignal);
    expect(production).toEqual(naive);
  });

  it('cashtag-only texts match the naive oracle', async () => {
    const production = (await correlateNER([cashtagOnlySignal], contractSet, MODEL)).map(normSignal);
    const naive = (await naiveNER([cashtagOnlySignal], contractSet)).map(normSignal);
    expect(production).toEqual(naive);
  });

  it('hashtag-only texts match the naive oracle', async () => {
    const production = (await correlateNER([hashtagOnlySignal], contractSet, MODEL)).map(normSignal);
    const naive = (await naiveNER([hashtagOnlySignal], contractSet)).map(normSignal);
    expect(production).toEqual(naive);
  });
});
