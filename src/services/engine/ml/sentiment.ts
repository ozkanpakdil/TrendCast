/**
 * Sentiment-based correlation engine.
 *
 * Classifies the sentiment of social/news text with a transformer model,
 * then correlates same-topic items with divergent sentiment to market
 * contracts (e.g., bearish social sentiment on a topic that has a "Yes"
 * market contract → lower confidence).
 *
 * ── Performance ──────────────────────────────────────────────────
 * Transformers.js `TextClassificationPipeline` accepts an array of strings
 * and runs them in a single batched forward pass. The previous
 * implementation called the pipeline once per text in a loop (N separate
 * ONNX forward passes) and — worse — `correlateNewsSocialSentiment`
 * re-classified every signal inside its inner loop. We now batch all texts
 * up front and reuse a shared sentiment store across the three correlation
 * passes so each text is classified exactly once.
 */

import type {
  CorrelationMatch,
  MarketContract,
  NewsCorrelationMatch,
  NewsItem,
  NewsSocialCorrelationMatch,
  SentimentModel,
  SocialSignal,
} from '@/types';
import {
  type CancelFlag,
  type CorrelationPhase,
  type ProgressCallback,
  checkCancelled,
  SENTIMENT_THRESHOLD,
} from './types';
import {
  type Pipeline,
  type SentimentResult,
  getSentimentPipeline,
} from './transformers';

// ── Batched sentiment classifier ─────────────────────────────────
// Runs the pipeline over chunks of texts in a single forward pass each.

const BATCH_SIZE = 32;

class BatchSentimentClassifier {
  private pipeline: Pipeline | null = null;
  private readonly model: SentimentModel;

  constructor(model: SentimentModel) {
    this.model = model;
  }

  private async getPipeline(): Promise<Pipeline> {
    if (!this.pipeline) {
      this.pipeline = await getSentimentPipeline(this.model);
    }
    return this.pipeline;
  }

  /**
   * Classify a batch of texts. Returns one `{ score, label }` per text in
   * the same order. `score` is normalised to [-1, +1].
   */
  async classifyBatch(texts: string[]): Promise<{ score: number; label: string }[]> {
    const pipeline = await this.getPipeline();
    const results: { score: number; label: string }[] = [];

    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      const chunk = texts.slice(start, start + BATCH_SIZE);
      const output = (await pipeline(chunk)) as SentimentResult | SentimentResult[];

      // text-classification returns an array of { label, score } entries per
      // input text. For a batched call this is an array of arrays.
      const batchResults: SentimentResult[] =
        Array.isArray(output) && Array.isArray(output[0])
          ? (output as SentimentResult[])
          : [output as SentimentResult];

      for (const res of batchResults) {
        results.push(normalizeSentiment(res));
      }
    }

    return results;
  }
}

/**
 * Normalise a raw text-classification result to a [-1, +1] score.
 *
 * Different models use different label sets:
 *   - SST-2 / FinBERT:  { POSITIVE, NEGATIVE }
 *   - Twitter RoBERTa:  { positive, negative, neutral }
 *   - Tiny DistilBERT:  { LABEL_0, LABEL_1 }
 */
function normalizeSentiment(results: SentimentResult): { score: number; label: string } {
  const top = results[0] ?? { label: 'neutral', score: 0.5 };

  let score = 0;
  const label = top.label.toLowerCase();
  if (label.includes('pos') || label === 'label_1') {
    score = top.score;
  } else if (label.includes('neg') || label === 'label_0') {
    score = -top.score;
  } else {
    // neutral — map to a small magnitude
    score = 0;
  }

  return { score, label: top.label };
}

// ── Shared sentiment store ───────────────────────────────────────
// Caches sentiment by text so a text classified in one correlation pass is
// reused by the next (no redundant forward passes).

class SentimentIndex {
  private readonly cache = new Map<string, { score: number; label: string }>();
  private readonly classifier: BatchSentimentClassifier;

  constructor(model: SentimentModel) {
    this.classifier = new BatchSentimentClassifier(model);
  }

  /**
   * Classify a list of texts, returning one `{ score, label }` per text in
   * the same order. Only uncached texts are sent to the model. Reports
   * progress after each batch completes so the UI shows a live, incrementing
   * progress bar.
   */
  async classify(
    texts: string[],
    onProgress?: ProgressCallback,
    phase?: CorrelationPhase,
    model?: SentimentModel,
  ): Promise<{ score: number; label: string }[]> {
    const result: { score: number; label: string }[] = new Array(texts.length);
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
        const classified = await this.classifier.classifyBatch(chunk);
        for (let k = 0; k < chunk.length; k++) {
          this.cache.set(chunk[k], classified[k]);
          result[missingIdx[start + k]] = classified[k];
        }
        done += chunk.length;
        if (phase && model) {
          onProgress?.({ phase, current: done, total: missing.length, engine: 'sentiment', model });
        }
      }
    }

    return result;
  }
}

// ── Public correlation passes ────────────────────────────────────

/**
 * Correlate social signals against market contracts using a sentiment
 * classifier. The idea: if social sentiment on a topic is strongly
 * directional (bullish/bearish) and the market contract asks about
 * that topic, the correlation confidence is higher.
 *
 * We use keyword overlap to find candidate pairs (same method as heuristic),
 * then use the sentiment classifier to refine the confidence.
 */
export async function correlateSentiment(
  signals: SocialSignal[],
  contracts: MarketContract[],
  model: SentimentModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<CorrelationMatch[]> {
  const index = new SentimentIndex(model);
  return correlateSignalsToContracts(index, signals, contracts, model, onProgress, cancelFlag);
}

/**
 * Correlate news headlines against market contracts using a sentiment
 * classifier.
 */
export async function correlateNewsSentiment(
  news: NewsItem[],
  contracts: MarketContract[],
  model: SentimentModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<NewsCorrelationMatch[]> {
  const index = new SentimentIndex(model);
  return correlateNewsToContracts(index, news, contracts, model, onProgress, cancelFlag);
}

/**
 * Correlate news headlines against social signals using a sentiment
 * classifier.
 */
export async function correlateNewsSocialSentiment(
  news: NewsItem[],
  signals: SocialSignal[],
  model: SentimentModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<NewsSocialCorrelationMatch[]> {
  const index = new SentimentIndex(model);
  return correlateNewsToSignals(index, news, signals, model, onProgress, cancelFlag);
}

/**
 * Run all three sentiment correlation passes with a single shared sentiment
 * store. Each unique text is classified exactly once and reused across the
 * passes — this is the fast path used by the ML worker.
 */
export async function correlateAllSentiment(
  signals: SocialSignal[],
  contracts: MarketContract[],
  news: NewsItem[],
  model: SentimentModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<{
  matches: CorrelationMatch[];
  newsMatches: NewsCorrelationMatch[];
  newsSocialMatches: NewsSocialCorrelationMatch[];
}> {
  const index = new SentimentIndex(model);

  const matches = await correlateSignalsToContracts(index, signals, contracts, model, onProgress, cancelFlag);
  const newsMatches = await correlateNewsToContracts(index, news, contracts, model, onProgress, cancelFlag);
  const newsSocialMatches = await correlateNewsToSignals(index, news, signals, model, onProgress, cancelFlag);

  return { matches, newsMatches, newsSocialMatches };
}

// ── Internal implementations (share an index) ────────────────────

async function correlateSignalsToContracts(
  index: SentimentIndex,
  signals: SocialSignal[],
  contracts: MarketContract[],
  model: SentimentModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<CorrelationMatch[]> {
  const matches: CorrelationMatch[] = [];

  onProgress?.({ phase: 'classifying-signals', current: 0, total: signals.length, engine: 'sentiment', model });
  const signalSentiments = await index.classify(
    signals.map((s) => s.text),
    onProgress,
    'classifying-signals',
    model,
  );

  for (let i = 0; i < signals.length; i++) {
    checkCancelled(cancelFlag);
    const mlSentiment = signalSentiments[i].score;
    const signal = signals[i];

    for (const contract of contracts) {
      // Use keyword overlap as candidate filter
      const matchedKeywords = signal.keywords.filter((k) =>
        contract.keywords.includes(k),
      );
      if (matchedKeywords.length === 0) continue;

      // Base confidence from keyword overlap ratio
      const overlapRatio =
        matchedKeywords.length /
        Math.max(signal.keywords.length, contract.keywords.length, 1);

      // Sentiment magnitude — stronger sentiment = more confident correlation
      const sentimentMagnitude = Math.abs(mlSentiment);

      // Virality boost
      const viralityWeight = (signal.virality / 100) * 0.1;

      const confidence = Math.min(
        1,
        overlapRatio * 0.5 + sentimentMagnitude * 0.3 + viralityWeight,
      );

      if (confidence < SENTIMENT_THRESHOLD) continue;

      matches.push({
        contract,
        signal,
        confidence,
        matchedKeywords,
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

async function correlateNewsToContracts(
  index: SentimentIndex,
  news: NewsItem[],
  contracts: MarketContract[],
  model: SentimentModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<NewsCorrelationMatch[]> {
  const matches: NewsCorrelationMatch[] = [];

  onProgress?.({ phase: 'classifying-news', current: 0, total: news.length, engine: 'sentiment', model });
  const newsSentiments = await index.classify(
    news.map((n) => n.headline),
    onProgress,
    'classifying-news',
    model,
  );

  for (let i = 0; i < news.length; i++) {
    checkCancelled(cancelFlag);
    const mlSentiment = newsSentiments[i].score;
    const item = news[i];

    for (const contract of contracts) {
      const matchedKeywords = item.keywords.filter((k) =>
        contract.keywords.includes(k),
      );
      if (matchedKeywords.length === 0) continue;

      const overlapRatio =
        matchedKeywords.length /
        Math.max(item.keywords.length, contract.keywords.length, 1);

      const sentimentMagnitude = Math.abs(mlSentiment);

      const confidence = Math.min(1, overlapRatio * 0.5 + sentimentMagnitude * 0.3 + 0.05);

      if (confidence < SENTIMENT_THRESHOLD) continue;

      matches.push({
        contract,
        news: item,
        confidence,
        matchedKeywords,
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

async function correlateNewsToSignals(
  index: SentimentIndex,
  news: NewsItem[],
  signals: SocialSignal[],
  model: SentimentModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<NewsSocialCorrelationMatch[]> {
  const matches: NewsSocialCorrelationMatch[] = [];

  // Classify all news and all signals up front (batched). Because the index
  // is shared across passes, signals classified here are reused if they were
  // already classified in the signal→market pass.
  onProgress?.({ phase: 'classifying-news-social', current: 0, total: news.length, engine: 'sentiment', model });
  const newsSentiments = await index.classify(
    news.map((n) => n.headline),
    onProgress,
    'classifying-news-social',
    model,
  );
  const signalSentiments = await index.classify(
    signals.map((s) => s.text),
    onProgress,
    'classifying-news-social',
    model,
  );

  for (let i = 0; i < news.length; i++) {
    checkCancelled(cancelFlag);
    const newsSentiment = newsSentiments[i].score;
    const item = news[i];

    for (let j = 0; j < signals.length; j++) {
      const matchedKeywords = item.keywords.filter((k) =>
        signals[j].keywords.includes(k),
      );
      if (matchedKeywords.length === 0) continue;

      const signalSentiment = signalSentiments[j].score;

      // If news and social sentiment align (both bullish or both bearish),
      // the correlation is stronger.
      const sentimentAlignment =
        1 - Math.abs(newsSentiment - signalSentiment) / 2;

      const overlapRatio =
        matchedKeywords.length /
        Math.max(item.keywords.length, signals[j].keywords.length, 1);

      const viralityWeight = (signals[j].virality / 100) * 0.1;

      const confidence = Math.min(
        1,
        overlapRatio * 0.4 + sentimentAlignment * 0.3 + viralityWeight,
      );

      if (confidence < SENTIMENT_THRESHOLD) continue;

      matches.push({
        news: item,
        signal: signals[j],
        confidence,
        matchedKeywords,
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}