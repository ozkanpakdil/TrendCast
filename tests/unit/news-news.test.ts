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

import { describe, it, expect, vi } from 'vitest';
import { correlateNewsNews } from '@/services/engine/correlation';
import { correlateAllEmbedding } from '@/services/engine/ml/embedding';
import { newsItem } from './fixtures';
import type { EmbeddingModel, NewsItem } from '@/types';

const MODEL: EmbeddingModel = 'Xenova/all-MiniLM-L6-v2';

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

// ── Embedding engine (CORR-06 4th pass) ───────────────────────────────

// Deterministic concept-stub pipeline (same pattern as
// embedding-equivalence.test.ts): each text maps to a fixed concept vector
// so the test runs without loading a real ONNX model.
const CONCEPTS = [
  'fed', 'rate', 'powell', 'bitcoin', 'btc', 'crypto', 'ethereum',
  'eth', 'trump', 'weather', 'moon', 'nvidia',
];

function embedVector(text: string): number[] {
  const lower = text.toLowerCase();
  return CONCEPTS.map((c) => (lower.includes(c) ? 1 : 0));
}

vi.mock('@/services/engine/ml/transformers', () => ({
  getEmbeddingPipeline: vi.fn(async () => {
    return async (texts: string[]) => ({ data: texts.map(embedVector) });
  }),
}));

describe('correlateAllEmbedding news↔news pass (CORR-06)', () => {
  it('matches a VCP screener item to a same-ticker SA story (entity-gated)', async () => {
    const vcpNvda: NewsItem = {
      ...newsItem('stockScreener2', 'NVDA — VCP 2026-08-27'),
      keywords: ['nvda'],
    };
    const saNvda: NewsItem = {
      ...newsItem('seekingalpha', 'Nvidia earnings beat expectations'),
      url: 'https://seekingalpha.com/symbol/NVDA/earnings',
      keywords: ['nvidia', 'earnings', 'beat'],
    };

    const { newsNewsMatches } = await correlateAllEmbedding([], [], [vcpNvda, saNvda], MODEL);

    // Both sides enrich to the shared canonical token `nvidia` → cosine 1.0.
    expect(newsNewsMatches).toHaveLength(1);
    expect(newsNewsMatches[0].newsA.id).toBe(vcpNvda.id);
    expect(newsNewsMatches[0].newsB.id).toBe(saNvda.id);
    expect(newsNewsMatches[0].matchedKeywords).toEqual([]);
  });

  it('skips same-source pairs and unrelated pairs on the embedding path', async () => {
    const vcpA: NewsItem = { ...newsItem('stockScreener2', 'NVDA — VCP 2026-08-27'), keywords: ['nvda'] };
    const vcpB: NewsItem = { ...newsItem('stockScreener2', 'NVDA — VCP 2026-08-28'), keywords: ['nvda'] };
    const weather = newsItem('bbc', 'Global weather patterns shift');

    const { newsNewsMatches } = await correlateAllEmbedding([], [], [vcpA, vcpB, weather], MODEL);

    // Same-source NVDA pair skipped; weather↔NVDA has no semantic overlap.
    expect(newsNewsMatches).toEqual([]);
  });

  it('entity-gated threshold: shared-entity pair in the 0.35–0.45 band is accepted', async () => {
    // The SA headline lights 5 concepts (nvidia + 4 noise) while the VCP
    // item lights only `nvidia` → cosine = 1/√5 ≈ 0.447: below the general
    // EMBEDDING_THRESHOLD (0.45) but above the entity-gated 0.35 bar.
    const vcpNvda: NewsItem = { ...newsItem('stockScreener2', 'NVDA — VCP 2026-08-27'), keywords: ['nvda'] };
    const saDiluted: NewsItem = {
      ...newsItem('seekingalpha', 'nvidia bitcoin trump weather moon'),
      keywords: ['nvidia', 'bitcoin', 'trump', 'weather', 'moon'],
    };

    const { newsNewsMatches } = await correlateAllEmbedding([], [], [vcpNvda, saDiluted], MODEL);

    expect(newsNewsMatches).toHaveLength(1);
    expect(newsNewsMatches[0].newsA.id).toBe(vcpNvda.id);
  });

  it('entity-gated threshold: shared-entity pair below 0.35 is still rejected', async () => {
    // Shared `nvidia` entity lowers the bar to 0.35 but does not remove it:
    // a heavily diluted headline (10 concepts) drops cosine to 1/√10 ≈ 0.32.
    const vcpNvda: NewsItem = { ...newsItem('stockScreener2', 'NVDA — VCP 2026-08-27'), keywords: ['nvda'] };
    const saDiluted: NewsItem = {
      ...newsItem('seekingalpha', 'nvidia bitcoin trump weather moon fed rate powell crypto ethereum'),
      keywords: ['nvidia', 'bitcoin', 'trump', 'weather', 'moon', 'fed', 'rate', 'powell', 'crypto', 'ethereum'],
    };

    const { newsNewsMatches } = await correlateAllEmbedding([], [], [vcpNvda, saDiluted], MODEL);

    expect(newsNewsMatches).toEqual([]);
  });
});