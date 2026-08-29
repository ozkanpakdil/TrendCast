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
 *
 * ── Entity enrichment ────────────────────────────────────────────
 * Raw strings under-express ticker identity: MiniLM does not reliably know
 * that the ticker `NVDA` means Nvidia, so a stock-indicator headline like
 * "NVDA — VCP 2026-08-27" embeds far from a "$NVDA breaking out" signal
 * even though they describe the same company. Every embedded text is
 * therefore enriched with its canonical entity keywords (CORR-01 unified
 * keys, e.g. nvda→nvidia) before the forward pass, injecting the shared
 * token into BOTH sides so cosine similarity can see the ticker identity
 * the raw strings don't express. Texts with no entities embed unchanged.
 *
 * ── Entity-gated threshold (news→social) ─────────────────────────
 * Enrichment alone cannot rescue screener headlines: "NVDA — VCP
 * 2026-08-27" is mostly date/label tokens, so even enriched its cosine
 * against "$NVDA breaking out" lands in the 0.35–0.45 band — below the
 * general bar. The news→social pass therefore lowers the acceptance
 * threshold to EMBEDDING_ENTITY_THRESHOLD (0.35) when both sides share a
 * canonical entity — the embedding analogue of the heuristic engine's
 * MIN_CONFIDENCE_ENTITY_MATCH. Pairs with no shared entity keep the full
 * EMBEDDING_THRESHOLD (0.45) bar.
 */

import type {
  CorrelationMatch,
  EmbeddingModel,
  MarketContract,
  NewsCorrelationMatch,
  NewsItem,
  NewsNewsCorrelationMatch,
  NewsSocialCorrelationMatch,
  SocialSignal,
} from '@/types';
import { extractEntityKeywords, isKnownTicker } from '@/utils/entities';
import {
  type CancelFlag,
  type CorrelationPhase,
  type ProgressCallback,
  checkCancelled,
  EMBEDDING_ENTITY_THRESHOLD,
  EMBEDDING_THRESHOLD,
} from './types';
import {
  type EmbeddingResult,
  type ModelDownloadCallback,
  type Pipeline,
  getEmbeddingPipeline,
} from './transformers';
import { cosineSimilarity, meanPool, normalize } from './math';

/**
 * Fixed batch size for embedding forward passes.
 *
 * The embedding models (MiniLM/BGE/GTE small) are tiny encoders — the
 * dominant cost of a pipeline call is fixed per-call overhead (tokenize +
 * tensor plumbing + backend dispatch), not per-text compute. Large batches
 * amortize that overhead: 100 texts in batches of 32 = 4 forward passes,
 * vs 100 single-text passes before the nested-chunking fix (~25x fewer).
 * Peak memory for a batch of 32 short texts is a few MB.
 */
const EMBED_BATCH_SIZE = 32;

/**
 * Enrich a text with its canonical entity keywords before embedding.
 *
 * Appends the CORR-01 unified entity keys (e.g. "NVDA — VCP 2026-08-27" →
 * "… nvidia") so both sides of a pair carry the same canonical token when
 * they reference the same ticker/org. Purely additive — texts with no
 * entities embed unchanged, so non-financial content is unaffected.
 *
 * Item keywords are deliberately NOT appended: collectors derive keywords
 * from the text itself, so text entities already cover them, and raw ticker
 * tokens ("nvda") add nothing MiniLM can use — the canonical org key is the
 * token it actually knows.
 */
function enrichForEmbedding(text: string): string {
  const entities = extractEntityKeywords(text);
  if (entities.length === 0) return text;
  return `${text} ${entities.join(' ')}`;
}

// ── Batched embedder ─────────────────────────────────────────────
// Runs the pipeline over chunks of texts in a single forward pass each.

class BatchEmbedder {
  private pipeline: Pipeline | null = null;
  private readonly model: EmbeddingModel;
  private readonly onModelDownload?: ModelDownloadCallback;

  constructor(model: EmbeddingModel, onModelDownload?: ModelDownloadCallback) {
    this.model = model;
    this.onModelDownload = onModelDownload;
  }

  private async getPipeline(): Promise<Pipeline> {
    if (!this.pipeline) {
      this.pipeline = await getEmbeddingPipeline(this.model, this.onModelDownload);
    }
    return this.pipeline;
  }

  /**
   * Embed a batch of texts in a SINGLE forward pass. Returns one
   * L2-normalized vector per text.
   *
   * Callers (EmbeddingIndex.embed) already chunk their input; this method
   * must not re-chunk. The previous implementation called
   * computeBatchSize(texts.length) here, which turned a caller chunk of 10
   * into 10 single-text pipeline calls — a ~25x slowdown from per-call
   * overhead (observed: 26s per 10 contracts on WebGPU).
   * Handles pooled (1D per item), token-level (2D per item), and flat
   * `[batch * dims]` tensor layouts.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    const pipeline = await this.getPipeline();
    const rawData = await this.runChunk(pipeline, texts);
    const vectors: number[][] = [];
    this.pushVectors(vectors, rawData, texts.length);
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

  constructor(model: EmbeddingModel, onModelDownload?: ModelDownloadCallback) {
    this.embedder = new BatchEmbedder(model, onModelDownload);
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
      // Fixed batch size (not computeBatchSize): the per-call overhead of a
      // pipeline invocation dominates for small encoders, so we want the
      // fewest possible forward passes.
      let done = 0;
      for (let start = 0; start < missing.length; start += EMBED_BATCH_SIZE) {
        const chunk = missing.slice(start, start + EMBED_BATCH_SIZE);
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
 * Diagnostic: log the top-K closest pairs across two embedded sets,
 * regardless of threshold. Makes "why no matches?" answerable from the
 * console: if the top scores cluster just below EMBEDDING_THRESHOLD the
 * data is near-miss; if they're ~0.2 the data genuinely has no overlap.
 */
function logTopPairs(
  label: string,
  aTexts: string[],
  aVecs: number[][],
  bTexts: string[],
  bVecs: number[][],
  topK = 5,
): void {
  try {
    const pairs: Array<{ sim: number; a: string; b: string }> = [];
    for (let i = 0; i < aVecs.length; i++) {
      for (let j = 0; j < bVecs.length; j++) {
        pairs.push({ sim: cosineSimilarity(aVecs[i], bVecs[j]), a: aTexts[i], b: bTexts[j] });
      }
    }
    pairs.sort((x, y) => y.sim - x.sim);
    console.log(`[TrendCast] Embedding top-${topK} ${label} pairs (threshold ${EMBEDDING_THRESHOLD}):`);
    for (const p of pairs.slice(0, topK)) {
      console.log(
        `[TrendCast]   ${p.sim.toFixed(3)} | ${p.a.slice(0, 60)} ↔ ${p.b.slice(0, 60)}`,
      );
    }
  } catch {
    // Diagnostics must never break correlation.
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
 * Run all four embedding correlation passes with a single shared
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
  onModelDownload?: ModelDownloadCallback,
): Promise<{
  matches: CorrelationMatch[];
  newsMatches: NewsCorrelationMatch[];
  newsSocialMatches: NewsSocialCorrelationMatch[];
  newsNewsMatches: NewsNewsCorrelationMatch[];
}> {
  const index = new EmbeddingIndex(model, onModelDownload);

  const matches = await correlateSignalsToContracts(index, signals, contracts, model, onProgress, cancelFlag);
  const newsMatches = await correlateNewsToContracts(index, news, contracts, model, onProgress, cancelFlag);
  const newsSocialMatches = await correlateNewsToSignals(index, news, signals, model, onProgress, cancelFlag);
  const newsNewsMatches = await correlateNewsToNews(index, news, model, onProgress, cancelFlag);

  return { matches, newsMatches, newsSocialMatches, newsNewsMatches };
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
    contracts.map((c) => enrichForEmbedding(c.question)),
    onProgress,
    'embedding-contracts',
    model,
  );

  onProgress?.({ phase: 'embedding-signals', current: 0, total: signals.length, engine: 'embedding', model });
  const signalEmbeddings = await index.embed(
    signals.map((s) => enrichForEmbedding(s.text)),
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

  // Diagnostic: log the top-5 closest signal→contract pairs regardless of
  // threshold, so a "no matches" result can be distinguished between "data
  // has no semantic overlap" and "scores cluster just below the threshold".
  logTopPairs(
    'signal→market',
    signals.map((s) => s.text),
    signalEmbeddings,
    contracts.map((c) => c.question),
    contractEmbeddings,
  );

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
    contracts.map((c) => enrichForEmbedding(c.question)),
    onProgress,
    'embedding-contracts',
    model,
  );

  onProgress?.({ phase: 'embedding-news', current: 0, total: news.length, engine: 'embedding', model });
  const newsEmbeddings = await index.embed(
    news.map((n) => enrichForEmbedding(n.headline)),
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

  // Diagnostic: top-5 news→contract pairs regardless of threshold.
  logTopPairs(
    'news→market',
    news.map((n) => n.headline),
    newsEmbeddings,
    contracts.map((c) => c.question),
    contractEmbeddings,
  );

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
    news.map((n) => enrichForEmbedding(n.headline)),
    onProgress,
    'embedding-news',
    model,
  );

  onProgress?.({ phase: 'embedding-signals', current: 0, total: signals.length, engine: 'embedding', model });
  const signalEmbeddings = await index.embed(
    signals.map((s) => enrichForEmbedding(s.text)),
    onProgress,
    'embedding-signals',
    model,
  );

  // Precompute canonical entity sets once — regex extraction is expensive
  // and the O(n·m) pair loop must not re-run it per pair.
  const newsEntitySets = news.map((n) => new Set(extractEntityKeywords(n.headline)));
  const signalEntitySets = signals.map((s) => new Set(extractEntityKeywords(s.text)));

  for (let i = 0; i < news.length; i++) {
    checkCancelled(cancelFlag);
    const newsEmb = newsEmbeddings[i];
    const item = news[i];

    for (let j = 0; j < signals.length; j++) {
      const sim = cosineSimilarity(newsEmb, signalEmbeddings[j]);

      // Entity-gated threshold (embedding analogue of the heuristic engine's
      // MIN_CONFIDENCE_ENTITY_MATCH): when both sides reference the same
      // canonical entity (e.g. "NVDA — VCP 2026-08-27" and "$NVDA breaking
      // out" both resolve to `nvidia`), accept the pair down to
      // EMBEDDING_ENTITY_THRESHOLD. Thin screener headlines share only the
      // ticker token with social posts, so their raw cosine lands in the
      // 0.35–0.45 band; the shared entity is the evidence the pair describes
      // the same company. Pairs with no shared entity keep the full bar.
      let hasEntityMatch = false;
      for (const entity of newsEntitySets[i]) {
        if (signalEntitySets[j].has(entity)) {
          hasEntityMatch = true;
          break;
        }
      }
      const threshold = hasEntityMatch
        ? EMBEDDING_ENTITY_THRESHOLD
        : EMBEDDING_THRESHOLD;
      if (sim < threshold) continue;

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

  // Diagnostic: top-5 news→signal pairs regardless of threshold, so a
  // "no matches for source X" result can be distinguished between "no
  // semantic overlap" and "scores cluster just below the threshold".
  logTopPairs(
    'news→social',
    news.map((n) => n.headline),
    newsEmbeddings,
    signals.map((s) => s.text),
    signalEmbeddings,
  );

  return matches.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Correlate news items against each other (CORR-06) using embedding
 * cosine similarity. Cross-source only — same-source pairs are skipped
 * so a screener feed never self-matches.
 */
async function correlateNewsToNews(
  index: EmbeddingIndex,
  news: NewsItem[],
  model: EmbeddingModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<NewsNewsCorrelationMatch[]> {
  const matches: NewsNewsCorrelationMatch[] = [];

  onProgress?.({ phase: 'embedding-news', current: 0, total: news.length, engine: 'embedding', model });
  const newsEmbeddings = await index.embed(
    news.map((n) => enrichForEmbedding(n.headline)),
    onProgress,
    'embedding-news',
    model,
  );

  // Precompute canonical entity sets once — regex extraction is expensive
  // and the O(n²) pair loop must not re-run it per pair.
  const newsEntitySets = news.map((n) => new Set(extractEntityKeywords(n.headline)));

  for (let i = 0; i < news.length; i++) {
    checkCancelled(cancelFlag);
    const itemA = news[i];

    for (let j = i + 1; j < news.length; j++) {
      const itemB = news[j];
      // CORR-06: cross-source only — a screener feed must never self-match,
      // and identical ids are the same item seen twice.
      if (itemA.source === itemB.source || itemA.id === itemB.id) continue;

      const sim = cosineSimilarity(newsEmbeddings[i], newsEmbeddings[j]);

      // Entity-gated threshold (same rationale as news→social): a shared
      // canonical entity — extracted entity OR shared known-ticker keyword,
      // since the ticker often only appears in the URL-derived keyword set —
      // accepts the pair down to EMBEDDING_ENTITY_THRESHOLD; otherwise the
      // full EMBEDDING_THRESHOLD bar applies.
      let hasEntityMatch = false;
      for (const entity of newsEntitySets[i]) {
        if (newsEntitySets[j].has(entity)) {
          hasEntityMatch = true;
          break;
        }
      }
      if (!hasEntityMatch) {
        for (const k of itemA.keywords) {
          if (isKnownTicker(k) && itemB.keywords.includes(k)) {
            hasEntityMatch = true;
            break;
          }
        }
      }
      const threshold = hasEntityMatch
        ? EMBEDDING_ENTITY_THRESHOLD
        : EMBEDDING_THRESHOLD;
      if (sim < threshold) continue;

      matches.push({
        newsA: itemA,
        newsB: itemB,
        confidence: Math.min(1, sim + 0.05),
        matchedKeywords: itemA.keywords.filter((k) =>
          itemB.keywords.includes(k),
        ),
        correlatedAt: Date.now(),
      });
    }
  }

  // Diagnostic: top-5 news↔news pairs regardless of threshold.
  logTopPairs(
    'news↔news',
    news.map((n) => n.headline),
    newsEmbeddings,
    news.map((n) => n.headline),
    newsEmbeddings,
  );

  return matches.sort((a, b) => b.confidence - a.confidence);
}