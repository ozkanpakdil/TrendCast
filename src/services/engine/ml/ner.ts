/**
 * ML-based NER (Named Entity Recognition) correlation engine.
 *
 * Uses a transformer NER model (e.g., BERT-NER) to extract named entities
 * from text, then computes weighted Jaccard similarity on the extracted
 * entity sets — same algorithm as the heuristic engine, but with ML-based
 * entity extraction instead of regex + curated knowledge base.
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
  type ProgressCallback,
  checkCancelled,
  NER_THRESHOLD,
} from './types';
import { getNERPipeline } from './transformers';

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

/**
 * Extract entities from text using a transformer NER model.
 * Aggregates B-/I- token tags into full entity spans and returns a
 * confidence-weighted entity map (compatible with the heuristic engine's
 * similarity computation).
 */
class NEREntityCache {
  private entityMaps = new Map<string, Map<string, number>>();

  async getEntities(
    text: string,
    model: NERModel,
  ): Promise<Map<string, number>> {
    const cached = this.entityMaps.get(text);
    if (cached) return cached;

    const pipeline = await getNERPipeline(model);
    const output = (await pipeline(text)) as NEREntity[] | NEREntity[][];

    // token-classification returns an array of entity predictions
    const entities: NEREntity[] = Array.isArray(output) && Array.isArray(output[0])
      ? (output[0] as NEREntity[])
      : (output as NEREntity[]);

    // Aggregate B-/I- tags into full entity spans
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

    this.entityMaps.set(text, entityMap);
    return entityMap;
  }

  clear(): void {
    this.entityMaps.clear();
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
  const matches: CorrelationMatch[] = [];
  const cache = new NEREntityCache();

  // Pre-extract contract entities
  onProgress?.({ phase: 'ner-extracting-contracts', current: 0, total: contracts.length, engine: 'ner', model });
  const contractEntities = new Map<string, Map<string, number>>();
  for (let i = 0; i < contracts.length; i++) {
    checkCancelled(cancelFlag);
    const entities = await cache.getEntities(contracts[i].question, model);
    contractEntities.set(contracts[i].id, entities);
    if (i % 10 === 0 || i === contracts.length - 1) {
      onProgress?.({ phase: 'ner-extracting-contracts', current: i + 1, total: contracts.length, engine: 'ner', model });
    }
  }

  // Extract signal entities and compare
  onProgress?.({ phase: 'ner-extracting-signals', current: 0, total: signals.length, engine: 'ner', model });
  for (let i = 0; i < signals.length; i++) {
    checkCancelled(cancelFlag);
    const signalEntities = await cache.getEntities(signals[i].text, model);
    if (i % 10 === 0 || i === signals.length - 1) {
      onProgress?.({ phase: 'ner-extracting-signals', current: i + 1, total: signals.length, engine: 'ner', model });
    }

    onProgress?.({ phase: 'ner-comparing-signals', current: i, total: signals.length, engine: 'ner', model });
    for (const contract of contracts) {
      const contractEnt = contractEntities.get(contract.id)!;
      const sim = nerEntitySimilarity(signalEntities, contractEnt);
      if (sim < NER_THRESHOLD) continue;

      // Boost by virality
      const viralityWeight = (signals[i].virality / 100) * 0.1;
      const confidence = Math.min(1, sim + viralityWeight);

      // Collect matched entity keywords
      const matchedEntities = [...signalEntities.keys()].filter((k) =>
        contractEnt.has(k),
      );

      matches.push({
        contract,
        signal: signals[i],
        confidence,
        matchedKeywords: [
          ...new Set([
            ...signals[i].keywords.filter((k) => contract.keywords.includes(k)),
            ...matchedEntities,
          ]),
        ],
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
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
  const matches: NewsCorrelationMatch[] = [];
  const cache = new NEREntityCache();

  // Pre-extract contract entities
  onProgress?.({ phase: 'ner-extracting-contracts', current: 0, total: contracts.length, engine: 'ner', model });
  const contractEntities = new Map<string, Map<string, number>>();
  for (let i = 0; i < contracts.length; i++) {
    checkCancelled(cancelFlag);
    const entities = await cache.getEntities(contracts[i].question, model);
    contractEntities.set(contracts[i].id, entities);
    if (i % 10 === 0 || i === contracts.length - 1) {
      onProgress?.({ phase: 'ner-extracting-contracts', current: i + 1, total: contracts.length, engine: 'ner', model });
    }
  }

  // Extract news entities and compare
  onProgress?.({ phase: 'ner-extracting-news', current: 0, total: news.length, engine: 'ner', model });
  for (let i = 0; i < news.length; i++) {
    checkCancelled(cancelFlag);
    const newsEntities = await cache.getEntities(news[i].headline, model);
    if (i % 10 === 0 || i === news.length - 1) {
      onProgress?.({ phase: 'ner-extracting-news', current: i + 1, total: news.length, engine: 'ner', model });
    }

    onProgress?.({ phase: 'ner-comparing-news', current: i, total: news.length, engine: 'ner', model });
    for (const contract of contracts) {
      const contractEnt = contractEntities.get(contract.id)!;
      const sim = nerEntitySimilarity(newsEntities, contractEnt);
      if (sim < NER_THRESHOLD) continue;

      const matchedEntities = [...newsEntities.keys()].filter((k) =>
        contractEnt.has(k),
      );

      matches.push({
        contract,
        news: news[i],
        confidence: Math.min(1, sim + 0.05),
        matchedKeywords: [
          ...new Set([
            ...news[i].keywords.filter((k) => contract.keywords.includes(k)),
            ...matchedEntities,
          ]),
        ],
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
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
  const matches: NewsSocialCorrelationMatch[] = [];
  const cache = new NEREntityCache();

  // Pre-extract news entities
  onProgress?.({ phase: 'ner-extracting-news', current: 0, total: news.length, engine: 'ner', model });
  const newsEntities = new Map<string, Map<string, number>>();
  for (let i = 0; i < news.length; i++) {
    checkCancelled(cancelFlag);
    const entities = await cache.getEntities(news[i].headline, model);
    newsEntities.set(news[i].id, entities);
    if (i % 10 === 0 || i === news.length - 1) {
      onProgress?.({ phase: 'ner-extracting-news', current: i + 1, total: news.length, engine: 'ner', model });
    }
  }

  // Extract signal entities and compare against news
  onProgress?.({ phase: 'ner-extracting-signals', current: 0, total: signals.length, engine: 'ner', model });
  for (let i = 0; i < signals.length; i++) {
    checkCancelled(cancelFlag);
    const signalEntities = await cache.getEntities(signals[i].text, model);
    if (i % 10 === 0 || i === signals.length - 1) {
      onProgress?.({ phase: 'ner-extracting-signals', current: i + 1, total: signals.length, engine: 'ner', model });
    }

    onProgress?.({ phase: 'ner-comparing-news-social', current: i, total: signals.length, engine: 'ner', model });
    for (const n of news) {
      const nEntities = newsEntities.get(n.id)!;
      const sim = nerEntitySimilarity(signalEntities, nEntities);
      if (sim < NER_THRESHOLD) continue;

      const viralityWeight = (signals[i].virality / 100) * 0.1;
      const confidence = Math.min(1, sim + viralityWeight);

      const matchedEntities = [...signalEntities.keys()].filter((k) =>
        nEntities.has(k),
      );

      matches.push({
        news: n,
        signal: signals[i],
        confidence,
        matchedKeywords: [
          ...new Set([
            ...n.keywords.filter((k) => signals[i].keywords.includes(k)),
            ...matchedEntities,
          ]),
        ],
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}