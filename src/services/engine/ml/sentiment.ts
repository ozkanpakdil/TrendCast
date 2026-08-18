/**
 * Sentiment-based correlation engine.
 *
 * Classifies the sentiment of social/news text with a transformer model,
 * then correlates same-topic items with divergent sentiment to market
 * contracts (e.g., bearish social sentiment on a topic that has a "Yes"
 * market contract → lower confidence).
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
  type ProgressCallback,
  checkCancelled,
  SENTIMENT_THRESHOLD,
} from './types';
import {
  type SentimentResult,
  getSentimentPipeline,
} from './transformers';

// ── Sentiment helpers ────────────────────────────────────────────

/**
 * Classify sentiment of a text. Returns a score in [-1, +1] where
 * -1 = very negative, 0 = neutral, +1 = very positive.
 *
 * Different models use different label sets:
 *   - SST-2 / FinBERT:  { POSITIVE, NEGATIVE }
 *   - Twitter RoBERTa:  { positive, negative, neutral }
 *   - Tiny DistilBERT:  { LABEL_0, LABEL_1 }
 */
export async function classifySentiment(
  text: string,
  model: SentimentModel,
): Promise<{ score: number; label: string }> {
  const pipeline = await getSentimentPipeline(model);
  const output = (await pipeline(text)) as SentimentResult;

  // text-classification returns an array of { label, score } entries
  // (one per input text). Take the first.
  const results = Array.isArray(output) ? output : [output];
  const top = results[0] ?? { label: 'neutral', score: 0.5 };

  // Normalise to [-1, +1]
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

/**
 * Correlate social signals against market contracts using a sentiment
 * classifier. The idea: if social sentiment on a topic is strongly
 * directional (bullish/bearish) and the market contract asks about
 * that topic, the correlation confidence is higher.
 *
 * We use keyword overlap to find candidate pairs (same as heuristic),
 * then use the sentiment classifier to refine the confidence.
 */
export async function correlateSentiment(
  signals: SocialSignal[],
  contracts: MarketContract[],
  model: SentimentModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<CorrelationMatch[]> {
  const matches: CorrelationMatch[] = [];

  onProgress?.({ phase: 'classifying-signals', current: 0, total: signals.length, engine: 'sentiment', model });
  for (let i = 0; i < signals.length; i++) {
    checkCancelled(cancelFlag);
    // Classify the signal's sentiment with the ML model
    const { score: mlSentiment } = await classifySentiment(signals[i].text, model);
    if (i % 5 === 0 || i === signals.length - 1) {
      onProgress?.({ phase: 'classifying-signals', current: i + 1, total: signals.length, engine: 'sentiment', model });
    }

    for (const contract of contracts) {
      // Use keyword overlap as candidate filter
      const matchedKeywords = signals[i].keywords.filter((k) =>
        contract.keywords.includes(k),
      );
      if (matchedKeywords.length === 0) continue;

      // Base confidence from keyword overlap ratio
      const overlapRatio =
        matchedKeywords.length /
        Math.max(signals[i].keywords.length, contract.keywords.length, 1);

      // Sentiment magnitude — stronger sentiment = more confident correlation
      const sentimentMagnitude = Math.abs(mlSentiment);

      // Virality boost
      const viralityWeight = (signals[i].virality / 100) * 0.1;

      const confidence = Math.min(
        1,
        overlapRatio * 0.5 + sentimentMagnitude * 0.3 + viralityWeight,
      );

      if (confidence < SENTIMENT_THRESHOLD) continue;

      matches.push({
        contract,
        signal: signals[i],
        confidence,
        matchedKeywords,
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
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
  const matches: NewsCorrelationMatch[] = [];

  onProgress?.({ phase: 'classifying-news', current: 0, total: news.length, engine: 'sentiment', model });
  for (let i = 0; i < news.length; i++) {
    checkCancelled(cancelFlag);
    const { score: mlSentiment } = await classifySentiment(news[i].headline, model);
    if (i % 5 === 0 || i === news.length - 1) {
      onProgress?.({ phase: 'classifying-news', current: i + 1, total: news.length, engine: 'sentiment', model });
    }

    for (const contract of contracts) {
      const matchedKeywords = news[i].keywords.filter((k) =>
        contract.keywords.includes(k),
      );
      if (matchedKeywords.length === 0) continue;

      const overlapRatio =
        matchedKeywords.length /
        Math.max(news[i].keywords.length, contract.keywords.length, 1);

      const sentimentMagnitude = Math.abs(mlSentiment);

      const confidence = Math.min(1, overlapRatio * 0.5 + sentimentMagnitude * 0.3 + 0.05);

      if (confidence < SENTIMENT_THRESHOLD) continue;

      matches.push({
        contract,
        news: news[i],
        confidence,
        matchedKeywords,
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
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
  const matches: NewsSocialCorrelationMatch[] = [];

  onProgress?.({ phase: 'classifying-news-social', current: 0, total: news.length, engine: 'sentiment', model });
  for (let i = 0; i < news.length; i++) {
    checkCancelled(cancelFlag);
    const { score: newsSentiment } = await classifySentiment(news[i].headline, model);
    if (i % 5 === 0 || i === news.length - 1) {
      onProgress?.({ phase: 'classifying-news-social', current: i + 1, total: news.length, engine: 'sentiment', model });
    }

    for (let j = 0; j < signals.length; j++) {
      const matchedKeywords = news[i].keywords.filter((k) =>
        signals[j].keywords.includes(k),
      );
      if (matchedKeywords.length === 0) continue;

      const { score: signalSentiment } = await classifySentiment(signals[j].text, model);

      // If news and social sentiment align (both bullish or both bearish),
      // the correlation is stronger.
      const sentimentAlignment =
        1 - Math.abs(newsSentiment - signalSentiment) / 2;

      const overlapRatio =
        matchedKeywords.length /
        Math.max(news[i].keywords.length, signals[j].keywords.length, 1);

      const viralityWeight = (signals[j].virality / 100) * 0.1;

      const confidence = Math.min(
        1,
        overlapRatio * 0.4 + sentimentAlignment * 0.3 + viralityWeight,
      );

      if (confidence < SENTIMENT_THRESHOLD) continue;

      matches.push({
        news: news[i],
        signal: signals[j],
        confidence,
        matchedKeywords,
        correlatedAt: Date.now(),
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}