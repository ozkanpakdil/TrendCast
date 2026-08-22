/**
 * ML-based NER (Named Entity Recognition) correlation engine.
 *
 * Uses a transformer NER model (e.g., BERT-NER) to extract named entities
 * from text, then computes weighted Jaccard similarity on the extracted
 * entity sets — same algorithm as the heuristic engine, but with ML-based
 * entity extraction instead of regex + curated knowledge base.
 *
 * ── Performance ──────────────────────────────────────────────────
 * Transformers.js `TokenClassificationPipeline` accepts an array of strings
 * and runs them in a single batched forward pass. The previous
 * implementation called the pipeline once per text in a loop AND created a
 * fresh entity cache per correlation pass, so contract/news/signal entities
 * were recomputed up to 3×. We now batch extraction and reuse a single
 * shared entity store across the three passes so each text is extracted
 * exactly once.
 */

import type {
  CorrelationMatch,
  MarketContract,
  NERModel,
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
  NER_THRESHOLD,
} from './types';
import {
  type Pipeline,
  getNERPipeline,
} from './transformers';

/**
 * NER token classification result from the pipeline.
 * The pipeline returns an array of token-level entity predictions.
 */
interface NEREntity {
  entity: string;   // e.g., "B-PER", "I-PER", "B-ORG", "B-LOC", "B-MISC"
  word: string;     // the token text (may be subword with ## prefix)
  score: number;    // model confidence [0–1]
  index: number;    // token index
  start?: number;   // character offset in original text
  end?: number;     // character offset end
}

// ── Batched entity extractor ─────────────────────────────────────
// Runs the pipeline over chunks of texts in a single forward pass each.

const BATCH_SIZE = 32;

class BatchEntityExtractor {
  private pipeline: Pipeline | null = null;
  private readonly model: NERModel;

  constructor(model: NERModel) {
    this.model = model;
  }

  private async getPipeline(): Promise<Pipeline> {
    if (!this.pipeline) {
      this.pipeline = await getNERPipeline(this.model);
    }
    return this.pipeline;
  }

  /**
   * Extract entities from a batch of texts. Returns one confidence-weighted
   * entity map per text in the same order.
   */
  async extractBatch(texts: string[]): Promise<Map<string, number>[]> {
    const pipeline = await this.getPipeline();
    const results: Map<string, number>[] = [];

    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      const chunk = texts.slice(start, start + BATCH_SIZE);
      const output = (await pipeline(chunk)) as NEREntity[] | NEREntity[][];

      // token-classification returns an array of entity predictions per input
      // text. For a batched call this is an array of arrays.
      const batchResults: NEREntity[][] =
        Array.isArray(output) && Array.isArray(output[0])
          ? (output as NEREntity[][])
          : [output as NEREntity[]];

      for (const entities of batchResults) {
        results.push(aggregateEntities(entities));
      }
    }

    return results;
  }
}

/**
 * Aggregate B-/I- token tags into full entity spans and return a
 * confidence-weighted entity map (compatible with the heuristic engine's
 * similarity computation).
 */
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
        // Average score across tokens, keep existing if higher
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
    const tag = ent.entity; // e.g., "B-PER", "I-ORG", "O"
    if (tag === 'O' || !tag) {
      flushEntity();
      continue;
    }

    // Parse B-/I- prefix and entity type
    const [prefix, type] = tag.includes('-') ? tag.split('-', 2) : ['B', tag];

    if (prefix === 'B' || type !== currentType) {
      flushEntity();
      currentType = type;
    }

    // Reconstruct word (Transformers.js may return subword tokens with ##)
    const word = ent.word.startsWith('##') ? ent.word.slice(2) : ent.word;
    currentEntity = currentEntity ? currentEntity + word : word;
    currentScore += ent.score;
    currentCount++;
  }
  flushEntity();

  return entityMap;
}

// ── Shared entity store ──────────────────────────────────────────
// Caches entity maps by text so entities extracted in one correlation pass
// are reused by the next (no redundant forward passes).

class NEREntityIndex {
  private readonly cache = new Map<string, Map<string, number>>();
  private readonly extractor: BatchEntityExtractor;

  constructor(model: NERModel) {
    this.extractor = new BatchEntityExtractor(model);
  }

  /**
   * Extract entities for a list of texts, returning one map per text in the
   * same order. Only uncached texts are sent to the model. Reports progress
   * after each batch completes so the UI shows a live, incrementing bar.
   */
  async extract(
    texts: string[],
    onProgress?: ProgressCallback,
    phase?: CorrelationPhase,
    model?: NERModel,
  ): Promise<Map<string, number>[]> {
    const result: Map<string, number>[] = new Array(texts.length);
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
      let done = 0;
      for (let start = 0; start < missing.length; start += BATCH_SIZE) {
        const chunk = missing.slice(start, start + BATCH_SIZE);
        const extracted = await this.extractor.extractBatch(chunk);
        for (let k = 0; k < chunk.length; k++) {
          this.cache.set(chunk[k], extracted[k]);
          result[missingIdx[start + k]] = extracted[k];
        }
        done += chunk.length;
        if (phase && model) {
          onProgress?.({ phase, current: done, total: missing.length, engine: 'ner', model });
        }
      }
    }

    return result;
  }
}

/**
 * Compute entity similarity using cached NER entity maps.
 * Same weighted Jaccard algorithm as the heuristic engine.
 */
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

// ── Public correlation passes ────────────────────────────────────

/**
 * Correlate social signals against market contracts using ML-based NER.
 * Extracts entities with a transformer NER model, then computes weighted
 * Jaccard similarity (same algorithm as the heuristic engine).
 */
export async function correlateNER(
  signals: SocialSignal[],
  contracts: MarketContract[],
  model: NERModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<CorrelationMatch[]> {
  const index = new NEREntityIndex(model);
  return correlateSignalsToContracts(index, signals, contracts, model, onProgress, cancelFlag);
}

/**
 * Correlate news headlines against market contracts using ML-based NER.
 */
export async function correlateNewsNER(
  news: NewsItem[],
  contracts: MarketContract[],
  model: NERModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<NewsCorrelationMatch[]> {
  const index = new NEREntityIndex(model);
  return correlateNewsToContracts(index, news, contracts, model, onProgress, cancelFlag);
}

/**
 * Correlate news headlines against social signals using ML-based NER.
 */
export async function correlateNewsSocialNER(
  news: NewsItem[],
  signals: SocialSignal[],
  model: NERModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<NewsSocialCorrelationMatch[]> {
  const index = new NEREntityIndex(model);
  return correlateNewsToSignals(index, news, signals, model, onProgress, cancelFlag);
}

/**
 * Run all three NER correlation passes with a single shared entity store.
 * Each unique text is extracted exactly once and reused across the passes —
 * this is the fast path used by the ML worker.
 */
export async function correlateAllNER(
  signals: SocialSignal[],
  contracts: MarketContract[],
  news: NewsItem[],
  model: NERModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<{
  matches: CorrelationMatch[];
  newsMatches: NewsCorrelationMatch[];
  newsSocialMatches: NewsSocialCorrelationMatch[];
}> {
  const index = new NEREntityIndex(model);

  const matches = await correlateSignalsToContracts(index, signals, contracts, model, onProgress, cancelFlag);
  const newsMatches = await correlateNewsToContracts(index, news, contracts, model, onProgress, cancelFlag);
  const newsSocialMatches = await correlateNewsToSignals(index, news, signals, model, onProgress, cancelFlag);

  return { matches, newsMatches, newsSocialMatches };
}

// ── Internal implementations (share an index) ────────────────────

async function correlateSignalsToContracts(
  index: NEREntityIndex,
  signals: SocialSignal[],
  contracts: MarketContract[],
  model: NERModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<CorrelationMatch[]> {
  const matches: CorrelationMatch[] = [];

  // Pre-extract contract entities (batched, shared across passes)
  onProgress?.({ phase: 'ner-extracting-contracts', current: 0, total: contracts.length, engine: 'ner', model });
  const contractEntities = await index.extract(
    contracts.map((c) => c.question),
    onProgress,
    'ner-extracting-contracts',
    model,
  );

  // Extract signal entities (batched)
  onProgress?.({ phase: 'ner-extracting-signals', current: 0, total: signals.length, engine: 'ner', model });
  const signalEntities = await index.extract(
    signals.map((s) => s.text),
    onProgress,
    'ner-extracting-signals',
    model,
  );

  for (let i = 0; i < signals.length; i++) {
    checkCancelled(cancelFlag);
    const signalEnt = signalEntities[i];
    const signal = signals[i];

    onProgress?.({ phase: 'ner-comparing-signals', current: i, total: signals.length, engine: 'ner', model });
    for (let j = 0; j < contracts.length; j++) {
      const contractEnt = contractEntities[j];
      const sim = nerEntitySimilarity(signalEnt, contractEnt);
      if (sim < NER_THRESHOLD) continue;

      // Boost by virality
      const viralityWeight = (signal.virality / 100) * 0.1;
      const confidence = Math.min(1, sim + viralityWeight);

      // Collect matched entity keywords
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

async function correlateNewsToContracts(
  index: NEREntityIndex,
  news: NewsItem[],
  contracts: MarketContract[],
  model: NERModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<NewsCorrelationMatch[]> {
  const matches: NewsCorrelationMatch[] = [];

  // Pre-extract contract entities (batched, shared across passes)
  onProgress?.({ phase: 'ner-extracting-contracts', current: 0, total: contracts.length, engine: 'ner', model });
  const contractEntities = await index.extract(
    contracts.map((c) => c.question),
    onProgress,
    'ner-extracting-contracts',
    model,
  );

  // Extract news entities (batched)
  onProgress?.({ phase: 'ner-extracting-news', current: 0, total: news.length, engine: 'ner', model });
  const newsEntities = await index.extract(
    news.map((n) => n.headline),
    onProgress,
    'ner-extracting-news',
    model,
  );

  for (let i = 0; i < news.length; i++) {
    checkCancelled(cancelFlag);
    const newsEnt = newsEntities[i];
    const item = news[i];

    onProgress?.({ phase: 'ner-comparing-news', current: i, total: news.length, engine: 'ner', model });
    for (let j = 0; j < contracts.length; j++) {
      const contractEnt = contractEntities[j];
      const sim = nerEntitySimilarity(newsEnt, contractEnt);
      if (sim < NER_THRESHOLD) continue;

      const matchedEntities = [...newsEnt.keys()].filter((k) =>
        contractEnt.has(k),
      );

      matches.push({
        contract: contracts[j],
        news: item,
        confidence: Math.min(1, sim + 0.05),
        matchedKeywords: [
          ...new Set([
            ...item.keywords.filter((k) => contracts[j].keywords.includes(k)),
            ...matchedEntities,
          ]),
        ],
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

async function correlateNewsToSignals(
  index: NEREntityIndex,
  news: NewsItem[],
  signals: SocialSignal[],
  model: NERModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<NewsSocialCorrelationMatch[]> {
  const matches: NewsSocialCorrelationMatch[] = [];

  // Pre-extract news entities (batched, shared across passes)
  onProgress?.({ phase: 'ner-extracting-news', current: 0, total: news.length, engine: 'ner', model });
  const newsEntities = await index.extract(
    news.map((n) => n.headline),
    onProgress,
    'ner-extracting-news',
    model,
  );

  // Extract signal entities (batched)
  onProgress?.({ phase: 'ner-extracting-signals', current: 0, total: signals.length, engine: 'ner', model });
  const signalEntities = await index.extract(
    signals.map((s) => s.text),
    onProgress,
    'ner-extracting-signals',
    model,
  );

  for (let i = 0; i < signals.length; i++) {
    checkCancelled(cancelFlag);
    const signalEnt = signalEntities[i];
    const signal = signals[i];

    onProgress?.({ phase: 'ner-comparing-news-social', current: i, total: signals.length, engine: 'ner', model });
    for (let j = 0; j < news.length; j++) {
      const nEntities = newsEntities[j];
      const sim = nerEntitySimilarity(signalEnt, nEntities);
      if (sim < NER_THRESHOLD) continue;

      const viralityWeight = (signal.virality / 100) * 0.1;
      const confidence = Math.min(1, sim + viralityWeight);

      const matchedEntities = [...signalEnt.keys()].filter((k) =>
        nEntities.has(k),
      );

      matches.push({
        news: news[j],
        signal,
        confidence,
        matchedKeywords: [
          ...new Set([
            ...news[j].keywords.filter((k) => signal.keywords.includes(k)),
            ...matchedEntities,
          ]),
        ],
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}