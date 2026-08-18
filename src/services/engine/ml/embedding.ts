/**
 * Embedding-based correlation engine.
 *
 * Embeds contract questions and social/news text into 384-dim vectors,
 * then computes cosine similarity. Much better semantic matching than
 * keyword overlap (e.g., "Will Fed cut rates?" matches "Powell hints at
 * borrowing cost relief").
 */

import type {
  CorrelationMatch,
  EmbeddingModel,
  MarketContract,
  NewsCorrelationMatch,
  NewsItem,
  NewsSocialCorrelationMatch,
  SocialSignal,
} from '@/types';
import {
  type CancelFlag,
  type ProgressCallback,
  checkCancelled,
  EMBEDDING_THRESHOLD,
} from './types';
import {
  type EmbeddingResult,
  getEmbeddingPipeline,
} from './transformers';
import { cosineSimilarity, meanPool } from './math';

// ── Embedding cache ──────────────────────────────────────────────
// Embeddings are computed once per text and reused across all pairs.

class EmbeddingCache {
  private embeddings = new Map<string, number[]>();

  async getEmbedding(text: string, model: EmbeddingModel): Promise<number[]> {
    const cached = this.embeddings.get(text);
    if (cached) return cached;

    const pipeline = await getEmbeddingPipeline(model);

    // Try with built-in pooling/normalize first (works for all-MiniLM-L6-v2).
    // If the model doesn't support these options (e.g., bge-small-en-v1.5
    // throws "logits is undefined"), fall back to raw output + manual pooling.
    let output: EmbeddingResult;
    try {
      output = (await pipeline(text, {
        pooling: 'mean',
        normalize: true,
      })) as EmbeddingResult;
    } catch (poolErr) {
      console.warn(
        `[TrendCast] ML: built-in pooling failed for "${model}", falling back to raw output:`,
        poolErr instanceof Error ? poolErr.message : poolErr,
      );
      // Get raw output without pooling/normalize options
      output = (await pipeline(text)) as EmbeddingResult;
    }

    // Determine the raw data array — some models put the tensor in
    // `data`, others in `logits` or `last_hidden_state`.
    const rawData =
      output.data ??
      output.logits ??
      output.last_hidden_state ??
      [];

    if (rawData.length === 0) {
      throw new Error(
        `Embedding model "${model}" returned empty output. ` +
          'The model may be incompatible with the installed Transformers.js version.',
      );
    }

    // If data is 1D (already pooled), use directly.
    // If data is 2D (token-level [tokens][dims]), mean-pool it.
    let vector: number[];
    if (Array.isArray(rawData[0])) {
      vector = meanPool(rawData as number[][]);
    } else {
      vector = rawData as number[];
    }

    // Normalize the vector (L2 norm = 1) if not already normalized
    let norm = 0;
    for (const v of vector) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm > 0) {
      vector = vector.map((v) => v / norm);
    }

    this.embeddings.set(text, vector);
    return vector;
  }

  clear(): void {
    this.embeddings.clear();
  }
}

/**
 * Correlate social signals against market contracts using embedding
 * cosine similarity. Returns matches above the threshold, sorted by
 * confidence.
 */
export async function correlateEmbedding(
  signals: SocialSignal[],
  contracts: MarketContract[],
  model: EmbeddingModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<CorrelationMatch[]> {
  const matches: CorrelationMatch[] = [];
  const cache = new EmbeddingCache();

  // Pre-compute all contract embeddings (fewer contracts than signals)
  onProgress?.({ phase: 'embedding-contracts', current: 0, total: contracts.length, engine: 'embedding', model });
  const contractEmbeddings = new Map<string, number[]>();
  for (let i = 0; i < contracts.length; i++) {
    checkCancelled(cancelFlag);
    const emb = await cache.getEmbedding(contracts[i].question, model);
    contractEmbeddings.set(contracts[i].id, emb);
    if (i % 10 === 0 || i === contracts.length - 1) {
      onProgress?.({ phase: 'embedding-contracts', current: i + 1, total: contracts.length, engine: 'embedding', model });
    }
  }

  onProgress?.({ phase: 'embedding-signals', current: 0, total: signals.length, engine: 'embedding', model });
  for (let i = 0; i < signals.length; i++) {
    checkCancelled(cancelFlag);
    const signalEmb = await cache.getEmbedding(signals[i].text, model);
    if (i % 10 === 0 || i === signals.length - 1) {
      onProgress?.({ phase: 'embedding-signals', current: i + 1, total: signals.length, engine: 'embedding', model });
    }

    for (const contract of contracts) {
      const contractEmb = contractEmbeddings.get(contract.id)!;
      const sim = cosineSimilarity(signalEmb, contractEmb);

      if (sim < EMBEDDING_THRESHOLD) continue;

      // Boost by virality (same as heuristic engine)
      const viralityWeight = (signals[i].virality / 100) * 0.1;
      const confidence = Math.min(1, sim + viralityWeight);

      matches.push({
        contract,
        signal: signals[i],
        confidence,
        matchedKeywords: signals[i].keywords.filter((k) =>
          contract.keywords.includes(k),
        ),
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Correlate news headlines against market contracts using embedding
 * cosine similarity.
 */
export async function correlateNewsEmbedding(
  news: NewsItem[],
  contracts: MarketContract[],
  model: EmbeddingModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<NewsCorrelationMatch[]> {
  const matches: NewsCorrelationMatch[] = [];
  const cache = new EmbeddingCache();

  // Pre-compute contract embeddings (reuse cache from prior call if same model)
  onProgress?.({ phase: 'embedding-contracts', current: 0, total: contracts.length, engine: 'embedding', model });
  const contractEmbeddings = new Map<string, number[]>();
  for (let i = 0; i < contracts.length; i++) {
    checkCancelled(cancelFlag);
    const emb = await cache.getEmbedding(contracts[i].question, model);
    contractEmbeddings.set(contracts[i].id, emb);
    if (i % 10 === 0 || i === contracts.length - 1) {
      onProgress?.({ phase: 'embedding-contracts', current: i + 1, total: contracts.length, engine: 'embedding', model });
    }
  }

  onProgress?.({ phase: 'embedding-news', current: 0, total: news.length, engine: 'embedding', model });
  for (let i = 0; i < news.length; i++) {
    checkCancelled(cancelFlag);
    const newsEmb = await cache.getEmbedding(news[i].headline, model);
    if (i % 10 === 0 || i === news.length - 1) {
      onProgress?.({ phase: 'embedding-news', current: i + 1, total: news.length, engine: 'embedding', model });
    }

    for (const contract of contracts) {
      const contractEmb = contractEmbeddings.get(contract.id)!;
      const sim = cosineSimilarity(newsEmb, contractEmb);

      if (sim < EMBEDDING_THRESHOLD) continue;

      matches.push({
        contract,
        news: news[i],
        confidence: Math.min(1, sim + 0.05),
        matchedKeywords: news[i].keywords.filter((k) =>
          contract.keywords.includes(k),
        ),
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Correlate news headlines against social signals using embedding
 * cosine similarity.
 */
export async function correlateNewsSocialEmbedding(
  news: NewsItem[],
  signals: SocialSignal[],
  model: EmbeddingModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<NewsSocialCorrelationMatch[]> {
  const matches: NewsSocialCorrelationMatch[] = [];
  const cache = new EmbeddingCache();

  onProgress?.({ phase: 'embedding-news', current: 0, total: news.length, engine: 'embedding', model });
  for (let i = 0; i < news.length; i++) {
    checkCancelled(cancelFlag);
    const newsEmb = await cache.getEmbedding(news[i].headline, model);
    if (i % 10 === 0 || i === news.length - 1) {
      onProgress?.({ phase: 'embedding-news', current: i + 1, total: news.length, engine: 'embedding', model });
    }

    for (let j = 0; j < signals.length; j++) {
      const signalEmb = await cache.getEmbedding(signals[j].text, model);
      const sim = cosineSimilarity(newsEmb, signalEmb);

      if (sim < EMBEDDING_THRESHOLD) continue;

      const viralityWeight = (signals[j].virality / 100) * 0.1;
      const confidence = Math.min(1, sim + viralityWeight);

      matches.push({
        news: news[i],
        signal: signals[j],
        confidence,
        matchedKeywords: news[i].keywords.filter((k) =>
          signals[j].keywords.includes(k),
        ),
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}