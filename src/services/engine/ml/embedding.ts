/**
 * Embedding-based correlation engine.
 *
 * Embeds contract questions and social/news text into 384-dim vectors,
 * then computes cosine similarity. Much better semantic matching than
 * keyword overlap (e.g., "Will Fed cut rates?" matches "Powell hints at
 * borrowing cost relief").
 *
 * ── Performance ──────────────────────────────────────────────────
 * Transformers.js `FeatureExtractionPipeline` accepts an array of strings
 * and runs them in a single batched forward pass. The previous
 * implementation called the pipeline once per text in a loop, which meant
 * N separate ONNX forward passes (very slow for ~1000+ contracts). We now
 * batch all texts up front and reuse a shared embedding store across the
 * three correlation passes so contract embeddings are computed exactly once.
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
  type CorrelationPhase,
  type ProgressCallback,
  checkCancelled,
  EMBEDDING_THRESHOLD,
} from './types';
import {
  type EmbeddingResult,
  type Pipeline,
  getEmbeddingPipeline,
} from './transformers';
import { cosineSimilarity, meanPool, normalize } from './math';

// ── Batched embedder ─────────────────────────────────────────────
// Runs the pipeline over chunks of texts in a single forward pass each.

const BATCH_SIZE = 128;

class BatchEmbedder {
  private pipeline: Pipeline | null = null;
  private readonly model: EmbeddingModel;

  constructor(model: EmbeddingModel) {
    this.model = model;
  }

  private async getPipeline(): Promise<Pipeline> {
    if (!this.pipeline) {
      this.pipeline = await getEmbeddingPipeline(this.model);
    }
    return this.pipeline;
  }

  /**
   * Embed a batch of texts. Returns one L2-normalized vector per text.
   * Handles pooled (1D per item), token-level (2D per item), and flat
   * `[batch * dims]` tensor layouts.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    const pipeline = await this.getPipeline();
    const vectors: number[][] = [];

    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      const chunk = texts.slice(start, start + BATCH_SIZE);
      const rawData = await this.runChunk(pipeline, chunk);
      this.pushVectors(vectors, rawData, chunk.length);
    }

    return vectors;
  }

  private async runChunk(pipeline: Pipeline, chunk: string[]): Promise<number[] | number[][]> {
    let output: EmbeddingResult;
    try {
      output = (await pipeline(chunk, {
        pooling: 'mean',
        normalize: true,
      })) as EmbeddingResult;
    } catch (poolErr) {
      // Some models (e.g. bge-small-en-v1.5) throw on built-in pooling.
      // Fall back to raw output + manual pooling.
      output = (await pipeline(chunk)) as EmbeddingResult;
    }

    const rawData =
      output.data ??
      output.logits ??
      output.last_hidden_state ??
      [];

    if (rawData.length === 0) {
      throw new Error(
        `Embedding model "${this.model}" returned empty output. ` +
          'The model may be incompatible with the installed Transformers.js version.',
      );
    }

    return rawData;
  }

  private pushVectors(vectors: number[][], rawData: number[] | number[][], batchLen: number): void {
    if (Array.isArray(rawData[0])) {
      const first = rawData[0];
      if (Array.isArray(first[0])) {
        // 3-D: [batch][tokens][dims] → mean-pool each item
        for (const item of rawData as unknown as number[][][]) {
          vectors.push(normalize(meanPool(item)));
        }
      } else {
        // 2-D: [batch][dims] → already pooled
        for (const item of rawData as number[][]) {
          vectors.push(normalize([...item]));
        }
      }
    } else {
      // 1-D flat: [batch * dims] → slice into rows
      const flat = rawData as number[];
      const dims = flat.length / batchLen;
      for (let i = 0; i < batchLen; i++) {
        vectors.push(normalize(flat.slice(i * dims, (i + 1) * dims)));
      }
    }
  }
}

// ── Shared embedding index ───────────────────────────────────────
// Caches embeddings by text so contract embeddings computed in one
// correlation pass are reused by the next (no redundant forward passes).

class EmbeddingIndex {
  private readonly cache = new Map<string, number[]>();
  private readonly embedder: BatchEmbedder;

  constructor(model: EmbeddingModel) {
    this.embedder = new BatchEmbedder(model);
  }

  /**
   * Embed a list of texts, returning one vector per text in the same order.
   * Only uncached texts are sent to the model. Reports progress after each
   * batch completes so the UI can show a live, incrementing progress bar.
   */
  async embed(
    texts: string[],
    onProgress?: ProgressCallback,
    phase?: CorrelationPhase,
    model?: EmbeddingModel,
  ): Promise<number[][]> {
    const result: number[][] = new Array(texts.length);
    const missing: string[] = [];
    const missingIdx: number[] = [];

    for (let i = 0; i < texts.length; i++) {
      const cached = this.cache.get(texts[i]);
      if (cached) {
        result[i] = cached;
      } else {
        missing.push(texts[i]);
        missingIdx.push(i);
      }
    }

    if (missing.length > 0) {
      // Report progress as each batch finishes so the bar moves smoothly.
      let done = 0;
      for (let start = 0; start < missing.length; start += BATCH_SIZE) {
        const chunk = missing.slice(start, start + BATCH_SIZE);
        const vectors = await this.embedder.embedBatch(chunk);
        for (let k = 0; k < chunk.length; k++) {
          this.cache.set(chunk[k], vectors[k]);
          result[missingIdx[start + k]] = vectors[k];
        }
        done += chunk.length;
        if (phase && model) {
          onProgress?.({ phase, current: done, total: missing.length, engine: 'embedding', model });
        }
      }
    }

    return result;
  }
}

// ── Public correlation passes ────────────────────────────────────

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
  const index = new EmbeddingIndex(model);
  return correlateSignalsToContracts(index, signals, contracts, model, onProgress, cancelFlag);
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
  const index = new EmbeddingIndex(model);
  return correlateNewsToContracts(index, news, contracts, model, onProgress, cancelFlag);
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
  const index = new EmbeddingIndex(model);
  return correlateNewsToSignals(index, news, signals, model, onProgress, cancelFlag);
}

/**
 * Run all three embedding correlation passes with a single shared
 * embedding index. Contract embeddings are computed exactly once and
 * reused across the signal→market and news→market passes. This is the
 * fast path used by the ML worker.
 */
export async function correlateAllEmbedding(
  signals: SocialSignal[],
  contracts: MarketContract[],
  news: NewsItem[],
  model: EmbeddingModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<{
  matches: CorrelationMatch[];
  newsMatches: NewsCorrelationMatch[];
  newsSocialMatches: NewsSocialCorrelationMatch[];
}> {
  const index = new EmbeddingIndex(model);

  const matches = await correlateSignalsToContracts(index, signals, contracts, model, onProgress, cancelFlag);
  const newsMatches = await correlateNewsToContracts(index, news, contracts, model, onProgress, cancelFlag);
  const newsSocialMatches = await correlateNewsToSignals(index, news, signals, model, onProgress, cancelFlag);

  return { matches, newsMatches, newsSocialMatches };
}

// ── Internal implementations (share an index) ────────────────────

async function correlateSignalsToContracts(
  index: EmbeddingIndex,
  signals: SocialSignal[],
  contracts: MarketContract[],
  model: EmbeddingModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<CorrelationMatch[]> {
  const matches: CorrelationMatch[] = [];

  onProgress?.({ phase: 'embedding-contracts', current: 0, total: contracts.length, engine: 'embedding', model });
  const contractEmbeddings = await index.embed(
    contracts.map((c) => c.question),
    onProgress,
    'embedding-contracts',
    model,
  );

  onProgress?.({ phase: 'embedding-signals', current: 0, total: signals.length, engine: 'embedding', model });
  const signalEmbeddings = await index.embed(
    signals.map((s) => s.text),
    onProgress,
    'embedding-signals',
    model,
  );

  for (let i = 0; i < signals.length; i++) {
    checkCancelled(cancelFlag);
    const signalEmb = signalEmbeddings[i];
    const signal = signals[i];

    for (let j = 0; j < contracts.length; j++) {
      const sim = cosineSimilarity(signalEmb, contractEmbeddings[j]);
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

async function correlateNewsToContracts(
  index: EmbeddingIndex,
  news: NewsItem[],
  contracts: MarketContract[],
  model: EmbeddingModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<NewsCorrelationMatch[]> {
  const matches: NewsCorrelationMatch[] = [];

  onProgress?.({ phase: 'embedding-contracts', current: 0, total: contracts.length, engine: 'embedding', model });
  const contractEmbeddings = await index.embed(
    contracts.map((c) => c.question),
    onProgress,
    'embedding-contracts',
    model,
  );

  onProgress?.({ phase: 'embedding-news', current: 0, total: news.length, engine: 'embedding', model });
  const newsEmbeddings = await index.embed(
    news.map((n) => n.headline),
    onProgress,
    'embedding-news',
    model,
  );

  for (let i = 0; i < news.length; i++) {
    checkCancelled(cancelFlag);
    const newsEmb = newsEmbeddings[i];
    const item = news[i];

    for (let j = 0; j < contracts.length; j++) {
      const sim = cosineSimilarity(newsEmb, contractEmbeddings[j]);
      if (sim < EMBEDDING_THRESHOLD) continue;

      const contract = contracts[j];
      matches.push({
        contract,
        news: item,
        confidence: Math.min(1, sim + 0.05),
        matchedKeywords: item.keywords.filter((k) =>
          contract.keywords.includes(k),
        ),
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

async function correlateNewsToSignals(
  index: EmbeddingIndex,
  news: NewsItem[],
  signals: SocialSignal[],
  model: EmbeddingModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<NewsSocialCorrelationMatch[]> {
  const matches: NewsSocialCorrelationMatch[] = [];

  onProgress?.({ phase: 'embedding-news', current: 0, total: news.length, engine: 'embedding', model });
  const newsEmbeddings = await index.embed(
    news.map((n) => n.headline),
    onProgress,
    'embedding-news',
    model,
  );

  onProgress?.({ phase: 'embedding-signals', current: 0, total: signals.length, engine: 'embedding', model });
  const signalEmbeddings = await index.embed(
    signals.map((s) => s.text),
    onProgress,
    'embedding-signals',
    model,
  );

  for (let i = 0; i < news.length; i++) {
    checkCancelled(cancelFlag);
    const newsEmb = newsEmbeddings[i];
    const item = news[i];

    for (let j = 0; j < signals.length; j++) {
      const sim = cosineSimilarity(newsEmb, signalEmbeddings[j]);
      if (sim < EMBEDDING_THRESHOLD) continue;

      const signal = signals[j];
      const viralityWeight = (signal.virality / 100) * 0.1;
      const confidence = Math.min(1, sim + viralityWeight);

      matches.push({
        news: item,
        signal,
        confidence,
        matchedKeywords: item.keywords.filter((k) =>
          signal.keywords.includes(k),
        ),
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}