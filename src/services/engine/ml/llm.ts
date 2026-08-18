/**
 * LLM-based correlation engine.
 *
 * Uses a small instruction-tuned LLM (e.g., SmolLM2, Qwen2.5) to perform
 * correlation assessment. The LLM is prompted with the signal/news text
 * and the contract question, and asked to return a confidence score
 * (0–100) indicating how related the two are.
 *
 * This is the most flexible engine — the LLM can reason about nuance,
 * sarcasm, and context that embedding/keyword approaches miss. But it's
 * also the slowest, especially on CPU (WASM). WebGPU is strongly
 * recommended for acceptable performance.
 *
 * We use keyword overlap as a pre-filter (same as zero-shot) to avoid
 * running the LLM on all signal × contract pairs.
 */

import type {
  CorrelationMatch,
  LLMModel,
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
  LLM_THRESHOLD,
  LLM_MAX_NEW_TOKENS,
  LLM_MAX_CANDIDATES,
} from './types';
import { getLLMPipeline } from './transformers';

/**
 * LLM text-generation result from the pipeline.
 * The pipeline returns an array with generated_text.
 */
interface LLMResult {
  generated_text: Array<{ role: string; content: string }> | string;
}

/**
 * Ask the LLM to score ONE signal text against its candidate questions.
 * Per-signal approach: each LLM call handles a single signal with up to
 * LLM_MAX_CANDIDATES questions. The small input (~200 tokens) and tiny
 * output (~5 numbers = ~20 tokens) keeps each forward pass fast (~1s on GPU).
 *
 * This is dramatically faster than mega-batching because LLM inference time
 * scales with (input_tokens × output_tokens) — autoregressive generation
 * is sequential, so 200 output tokens = 200 forward passes, each processing
 * the full input + KV cache. Small input + small output = fast.
 */
async function llmScoreSignal(
  text: string,
  questions: string[],
  model: LLMModel,
): Promise<number[]> {
  const pipeline = await getLLMPipeline(model);
  if (questions.length === 0) return [];

  const truncatedText = text.slice(0, 200);
  const questionList = questions
    .map((q, i) => `${i + 1}. ${q.slice(0, 120)}`)
    .join('\n');

  const messages = [
    {
      role: 'system',
      content:
        'You are a financial correlation analyst. Rate how related the Text is to each Question on 0-100. Output ONLY numbers, one per line.',
    },
    {
      role: 'user',
      content: `Text: "${truncatedText}"\n\nQuestions:\n${questionList}\n\nScores:`,
    },
  ];

  try {
    const t0 = performance.now();
    const output = (await pipeline(messages, {
      max_new_tokens: LLM_MAX_NEW_TOKENS,
      do_sample: false,
      temperature: 0.1,
    })) as LLMResult[];
    const elapsed = performance.now() - t0;

    let generated = '';
    if (Array.isArray(output) && output.length > 0) {
      const gen = output[0].generated_text;
      if (Array.isArray(gen)) {
        const assistantMsg = gen.filter((m) => m.role === 'assistant').pop();
        generated = assistantMsg?.content ?? '';
      } else {
        generated = String(gen);
      }
    }

    // DeepSeek R1 reasoning models wrap their answer in think tags.
    const thinkMatch = generated.match(/<\/think>\s*(.*)/s);
    if (thinkMatch) {
      generated = thinkMatch[1].trim();
    }

    const numbers = generated.match(/\d+/g);
    if (numbers) {
      const scores = numbers.slice(0, questions.length).map((n) => {
        const score = parseInt(n, 10);
        return Math.min(100, Math.max(0, score)) / 100;
      });
      console.log(
        `[TrendCast] ML: LLM per-signal ✅ ${elapsed.toFixed(0)}ms | ${questions.length} candidates | scores=[${scores.map((s) => s.toFixed(2)).join(', ')}]`,
      );
      return scores;
    } else {
      console.warn(
        `[TrendCast] ML: LLM per-signal ⚠️ ${elapsed.toFixed(0)}ms | no numbers parsed | raw="${generated.slice(0, 80)}"`,
      );
      return questions.map(() => 0);
    }
  } catch (err) {
    console.warn('[TrendCast] ML: LLM per-signal scoring failed:', err);
    return questions.map(() => 0);
  }
}

/**
 * Correlate social signals against market contracts using an LLM.
 * Uses keyword overlap as a pre-filter, then scores each signal's candidates
 * in a single LLM call (one signal → up to 5 questions → 5 scores per call).
 */
export async function correlateLLM(
  signals: SocialSignal[],
  contracts: MarketContract[],
  model: LLMModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<CorrelationMatch[]> {
  const matches: CorrelationMatch[] = [];
  const llmStart = performance.now();

  console.log(`[TrendCast] ML: LLM correlateLLM started — ${signals.length} signals, ${contracts.length} contracts, model="${model}"`);

  let llmCalls = 0;
  for (let i = 0; i < signals.length; i++) {
    checkCancelled(cancelFlag);

    const candidates = contracts
      .filter((c) => c.keywords.some((k) => signals[i].keywords.includes(k)))
      .slice(0, LLM_MAX_CANDIDATES);
    if (candidates.length === 0) continue;

    llmCalls++;
    const questions = candidates.map((c) => c.question);
    const scores = await llmScoreSignal(signals[i].text, questions, model);

    for (let j = 0; j < candidates.length && j < scores.length; j++) {
      const llmScore = scores[j];
      if (llmScore < LLM_THRESHOLD) continue;

      const viralityWeight = (signals[i].virality / 100) * 0.1;
      const confidence = Math.min(1, llmScore + viralityWeight);

      matches.push({
        contract: candidates[j],
        signal: signals[i],
        confidence,
        matchedKeywords: signals[i].keywords.filter((k) =>
          candidates[j].keywords.includes(k),
        ),
        correlatedAt: Date.now(),
      });
    }

    if (llmCalls % 10 === 0 || i === signals.length - 1) {
      const totalElapsed = ((performance.now() - llmStart) / 1000).toFixed(1);
      const avgPerCall = ((performance.now() - llmStart) / llmCalls / 1000).toFixed(1);
      console.log(`[TrendCast] ML: LLM per-signal ${llmCalls} calls — signal ${i + 1}/${signals.length}, ${matches.length} matches | ${totalElapsed}s total, ${avgPerCall}s/call avg`);
    }
    onProgress?.({
      phase: 'llm-generating-signals',
      current: i + 1,
      total: signals.length,
      engine: 'llm',
      model,
    });
  }

  const totalElapsed = ((performance.now() - llmStart) / 1000).toFixed(1);
  console.log(`[TrendCast] ML: LLM correlateLLM done — ${llmCalls} LLM calls (per-signal), ${matches.length} matches, ${totalElapsed}s total`);
  return matches.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Correlate news headlines against market contracts using an LLM.
 * Scores each news item's candidate contracts in a single LLM call.
 */
export async function correlateNewsLLM(
  news: NewsItem[],
  contracts: MarketContract[],
  model: LLMModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<NewsCorrelationMatch[]> {
  const matches: NewsCorrelationMatch[] = [];
  const llmStart = performance.now();

  console.log(`[TrendCast] ML: LLM correlateNewsLLM started — ${news.length} news, ${contracts.length} contracts, model="${model}"`);

  let llmCalls = 0;
  for (let i = 0; i < news.length; i++) {
    checkCancelled(cancelFlag);

    const candidates = contracts
      .filter((c) => c.keywords.some((k) => news[i].keywords.includes(k)))
      .slice(0, LLM_MAX_CANDIDATES);
    if (candidates.length === 0) continue;

    llmCalls++;
    const questions = candidates.map((c) => c.question);
    const scores = await llmScoreSignal(news[i].headline, questions, model);

    for (let j = 0; j < candidates.length && j < scores.length; j++) {
      const llmScore = scores[j];
      if (llmScore < LLM_THRESHOLD) continue;

      matches.push({
        contract: candidates[j],
        news: news[i],
        confidence: Math.min(1, llmScore + 0.05),
        matchedKeywords: news[i].keywords.filter((k) =>
          candidates[j].keywords.includes(k),
        ),
        correlatedAt: Date.now(),
      });
    }

    if (llmCalls % 10 === 0 || i === news.length - 1) {
      const totalElapsed = ((performance.now() - llmStart) / 1000).toFixed(1);
      const avgPerCall = ((performance.now() - llmStart) / llmCalls / 1000).toFixed(1);
      console.log(`[TrendCast] ML: LLM news per-signal ${llmCalls} calls — news ${i + 1}/${news.length}, ${matches.length} matches | ${totalElapsed}s total, ${avgPerCall}s/call avg`);
    }
    onProgress?.({ phase: 'llm-generating-news', current: i + 1, total: news.length, engine: 'llm', model });
  }

  const totalElapsed = ((performance.now() - llmStart) / 1000).toFixed(1);
  console.log(`[TrendCast] ML: LLM correlateNewsLLM done — ${llmCalls} LLM calls (per-signal), ${matches.length} matches, ${totalElapsed}s total`);
  return matches.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Correlate news headlines against social signals using an LLM.
 * Scores each signal's candidate news items in a single LLM call.
 */
export async function correlateNewsSocialLLM(
  news: NewsItem[],
  signals: SocialSignal[],
  model: LLMModel,
  onProgress?: ProgressCallback,
  cancelFlag?: CancelFlag,
): Promise<NewsSocialCorrelationMatch[]> {
  const matches: NewsSocialCorrelationMatch[] = [];
  const llmStart = performance.now();

  console.log(`[TrendCast] ML: LLM correlateNewsSocialLLM started — ${signals.length} signals, ${news.length} news, model="${model}"`);

  let llmCalls = 0;
  for (let i = 0; i < signals.length; i++) {
    checkCancelled(cancelFlag);

    const candidateNews = news
      .filter((n) => n.keywords.some((k) => signals[i].keywords.includes(k)))
      .slice(0, LLM_MAX_CANDIDATES);
    if (candidateNews.length === 0) continue;

    llmCalls++;
    const questions = candidateNews.map((n) => n.headline);
    const scores = await llmScoreSignal(signals[i].text, questions, model);

    for (let j = 0; j < candidateNews.length && j < scores.length; j++) {
      const llmScore = scores[j];
      if (llmScore < LLM_THRESHOLD) continue;

      const viralityWeight = (signals[i].virality / 100) * 0.1;
      const confidence = Math.min(1, llmScore + viralityWeight);

      matches.push({
        news: candidateNews[j],
        signal: signals[i],
        confidence,
        matchedKeywords: candidateNews[j].keywords.filter((k) =>
          signals[i].keywords.includes(k),
        ),
        correlatedAt: Date.now(),
      });
    }

    if (llmCalls % 10 === 0 || i === signals.length - 1) {
      const totalElapsed = ((performance.now() - llmStart) / 1000).toFixed(1);
      const avgPerCall = ((performance.now() - llmStart) / llmCalls / 1000).toFixed(1);
      console.log(`[TrendCast] ML: LLM news-social per-signal ${llmCalls} calls — signal ${i + 1}/${signals.length}, ${matches.length} matches | ${totalElapsed}s total, ${avgPerCall}s/call avg`);
    }
    onProgress?.({ phase: 'llm-generating-news-social', current: i + 1, total: signals.length, engine: 'llm', model });
  }

  const totalElapsed = ((performance.now() - llmStart) / 1000).toFixed(1);
  console.log(`[TrendCast] ML: LLM correlateNewsSocialLLM done — ${llmCalls} LLM calls (per-signal), ${matches.length} matches, ${totalElapsed}s total`);
  return matches.sort((a, b) => b.confidence - a.confidence);
}