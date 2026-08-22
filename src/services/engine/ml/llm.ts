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
 *
 * ── Batching ─────────────────────────────────────────────────────
 * Unlike the zero-shot pipeline (which loops premise × hypothesis
 * internally), Transformers.js `TextGenerationPipeline._call` accepts an
 * array of `Chat[]` and runs a SINGLE `model.generate()` over the whole
 * batch tensor (left-padded). On WebGPU this gives near-linear batch
 * parallelism, so scoring N signals costs roughly the same as scoring 1
 * (plus padding overhead) instead of N × per-signal time.
 *
 * We therefore collect all candidate signals/news into chunks of
 * `LLM_BATCH_SIZE` and score each chunk in one pipeline call. This turns
 * 212 sequential ~2s calls into ~27 batched calls.
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
 * Estimated vocab size per supported model. The dominant memory cost of a
 * batched LLM call is the lm_head output tensor: batch × seq × vocab.
 * We use each model's real vocab so the batch size is tuned correctly.
 * Unknown models fall back to the largest known vocab to stay safe.
 */
const LLM_VOCAB: Record<LLMModel, number> = {
  'HuggingFaceTB/SmolLM2-135M-Instruct': 49152,
  'HuggingFaceTB/SmolLM2-360M-Instruct': 49152,
  'onnx-community/Qwen2.5-0.5B-Instruct-ONNX': 151936,
  'onnx-community/Qwen2.5-1.5B-Instruct-ONNX': 151936,
  'onnx-community/Phi-3.5-mini-instruct-onnx-web': 32064,
  'onnx-community/DeepSeek-R1-Distill-Qwen-1.5B-ONNX': 151936,
  'onnx-community/glm-edge-1.5b-chat-ONNX': 131072,
};

/** Conservative fallback vocab for unknown models. */
const LLM_VOCAB_FALLBACK = 151936;

/** Conservative worst-case sequence length (input 200 + output 20 + padding). */
const LLM_MAX_SEQ = 256;

/** fp32 = 4 bytes per element. */
const LLM_BYTES_PER_ELEM = 4;

/** Keep the lm_head output under this fraction of the GPU's max buffer. */
const LLM_SAFETY_FACTOR = 0.5;

/** Hard bounds so we never pick a pathological batch size. */
const LLM_BATCH_MIN = 1;
const LLM_BATCH_MAX = 128;
const LLM_BATCH_DEFAULT = 16;

/** Cache the computed batch size per model so we only query the GPU once. */
const llmBatchSizeCache = new Map<LLMModel, number>();

/**
 * Compute a safe LLM batch size for the current machine.
 *
 * The dominant memory cost of a batched call is the lm_head output tensor:
 * `batch × seq × vocab` elements. WebGPU caps a single buffer at
 * `adapter.limits.maxBufferSize` (commonly ~2 GB), so we pick the largest
 * batch whose lm_head output fits within a safe fraction of that limit.
 *
 * This adapts per GPU — a machine with a large maxBufferSize gets a bigger
 * batch (fewer calls), a small one gets a smaller batch (no OOM). Falls back
 * to a conservative default when WebGPU is unavailable or its limits can't
 * be queried.
 */
async function computeLLMBatchSize(model: LLMModel): Promise<number> {
  const cached = llmBatchSizeCache.get(model);
  if (cached !== undefined) return cached;

  const vocab = LLM_VOCAB[model] ?? LLM_VOCAB_FALLBACK;
  const bytesPerItem = LLM_MAX_SEQ * vocab * LLM_BYTES_PER_ELEM;

  let batch = LLM_BATCH_DEFAULT;
  try {
    const gpu = (navigator as unknown as {
      gpu?: { requestAdapter?: () => Promise<{ limits?: { maxBufferSize?: number } } | null> };
    }).gpu;
    const adapter = gpu?.requestAdapter ? await gpu.requestAdapter() : null;
    const maxBufferSize = adapter?.limits?.maxBufferSize;
    if (maxBufferSize && maxBufferSize > 0) {
      const maxItems = Math.floor((maxBufferSize * LLM_SAFETY_FACTOR) / bytesPerItem);
      batch = Math.max(LLM_BATCH_MIN, Math.min(LLM_BATCH_MAX, maxItems));
    }
  } catch {
    // Fall back to the default if the GPU query fails.
  }

  llmBatchSizeCache.set(model, batch);
  console.log(
    `[TrendCast] ML: LLM batch size = ${batch} for "${model}" (vocab=${vocab}, ~${((bytesPerItem * batch) / 1e9).toFixed(1)}GB lm_head)`,
  );
  return batch;
}

/** A single item to score: one text against a list of questions. */
interface LLMScoreItem {
  text: string;
  questions: string[];
}

/** Raw pipeline output element. */
interface LLMGenerated {
  generated_text: Array<{ role: string; content: string }> | string;
}

/** A chat message, matching Transformers.js `Chat` (Message[]). */
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Build the chat messages for one scored item.
 * Only input (~200 tokens) + tiny output (~5 numbers = ~20 tokens) keeps
 * each forward pass fast.
 */
function buildMessages(item: LLMScoreItem): ChatMessage[] {
  const truncatedText = item.text.slice(0, 200);
  const questionList = item.questions
    .map((q, i) => `${i + 1}. ${q.slice(0, 120)}`)
    .join('\n');

  return [
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
}

/**
 * Extract the assistant's generated text from a pipeline output entry.
 * Handles both single (`LLMGenerated[]`) and batched (`LLMGenerated[][]`)
 * return shapes.
 */
function extractGenerated(output: unknown, index: number): string {
  const arr = output as LLMGenerated[] | LLMGenerated[][] | undefined;
  let entry = arr?.[index];
  // Batched output wraps each item in its own array.
  if (Array.isArray(entry)) entry = entry[0];
  const gen = entry?.generated_text;
  if (Array.isArray(gen)) {
    const assistantMsg = gen.filter((m) => m.role === 'assistant').pop();
    return assistantMsg?.content ?? '';
  }
  return String(gen ?? '');
}

/**
 * Parse a raw generated string into 0–1 scores, one per question.
 * Strips DeepSeek R1 think tags, then extracts the first N integers.
 */
function parseScores(generated: string, numQuestions: number): number[] {
  const thinkMatch = generated.match(/<\/think>\s*(.*)/s);
  if (thinkMatch) generated = thinkMatch[1].trim();

  const numbers = generated.match(/\d+/g);
  if (!numbers) return Array(numQuestions).fill(0);

  return numbers.slice(0, numQuestions).map((n) => {
    const score = parseInt(n, 10);
    return Math.min(100, Math.max(0, score)) / 100;
  });
}

/**
 * Score a batch of items in a SINGLE LLM call.
 * Returns one scores array per item (parallel to `items`).
 */
async function llmScoreBatch(
  items: LLMScoreItem[],
  model: LLMModel,
): Promise<number[][]> {
  if (items.length === 0) return [];
  const pipeline = await getLLMPipeline(model);

  const messages = items.map(buildMessages);

  const t0 = performance.now();
  const output = (await pipeline(messages, {
    max_new_tokens: LLM_MAX_NEW_TOKENS,
    do_sample: false,
    temperature: 0.1,
  })) as unknown;
  const elapsed = performance.now() - t0;

  const scores = items.map((item, i) =>
    parseScores(extractGenerated(output, i), item.questions.length),
  );

  console.log(
    `[TrendCast] ML: LLM batch ✅ ${elapsed.toFixed(0)}ms | ${items.length} items | scores=[${scores.map((s) => `[${s.join(',')}]`).join(' ')}]`,
  );
  return scores;
}

/**
 * Correlate social signals against market contracts using an LLM.
 * Uses keyword overlap as a pre-filter, then scores each signal's
 * candidates in batched LLM calls (multiple signals per call).
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

  // Pre-compute candidate contracts per signal (keyword pre-filter).
  const items: { signal: SocialSignal; candidates: MarketContract[] }[] = [];
  for (let i = 0; i < signals.length; i++) {
    checkCancelled(cancelFlag);
    const candidates = contracts
      .filter((c) => c.keywords.some((k) => signals[i].keywords.includes(k)))
      .slice(0, LLM_MAX_CANDIDATES);
    if (candidates.length === 0) continue;
    items.push({ signal: signals[i], candidates });
  }

  const batchSize = await computeLLMBatchSize(model);
  let llmCalls = 0;
  let processed = 0;
  for (let start = 0; start < items.length; start += batchSize) {
    checkCancelled(cancelFlag);
    const batch = items.slice(start, start + batchSize);
    const scoreItems: LLMScoreItem[] = batch.map((b) => ({
      text: b.signal.text,
      questions: b.candidates.map((c) => c.question),
    }));

    const scoresBatch = await llmScoreBatch(scoreItems, model);
    llmCalls++;

    for (let b = 0; b < batch.length; b++) {
      const { signal, candidates } = batch[b];
      const scores = scoresBatch[b];
      for (let j = 0; j < candidates.length && j < scores.length; j++) {
        const llmScore = scores[j];
        if (llmScore < LLM_THRESHOLD) continue;

        const viralityWeight = (signal.virality / 100) * 0.1;
        const confidence = Math.min(1, llmScore + viralityWeight);

        matches.push({
          contract: candidates[j],
          signal,
          confidence,
          matchedKeywords: signal.keywords.filter((k) =>
            candidates[j].keywords.includes(k),
          ),
          correlatedAt: Date.now(),
        });
      }
    }

    processed += batch.length;
    onProgress?.({
      phase: 'llm-generating-signals',
      current: processed,
      total: signals.length,
      engine: 'llm',
      model,
    });
  }

  const totalElapsed = ((performance.now() - llmStart) / 1000).toFixed(1);
  console.log(`[TrendCast] ML: LLM correlateLLM done — ${llmCalls} batched LLM calls, ${matches.length} matches, ${totalElapsed}s total`);
  return matches.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Correlate news headlines against market contracts using an LLM.
 * Scores each news item's candidate contracts in batched LLM calls.
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

  const scored: { news: NewsItem; candidates: MarketContract[] }[] = [];
  for (let i = 0; i < news.length; i++) {
    checkCancelled(cancelFlag);
    const candidates = contracts
      .filter((c) => c.keywords.some((k) => news[i].keywords.includes(k)))
      .slice(0, LLM_MAX_CANDIDATES);
    if (candidates.length === 0) continue;
    scored.push({ news: news[i], candidates });
  }

  const batchSize = await computeLLMBatchSize(model);
  let llmCalls = 0;
  let processed = 0;
  for (let start = 0; start < scored.length; start += batchSize) {
    checkCancelled(cancelFlag);
    const batch = scored.slice(start, start + batchSize);
    const scoreItems: LLMScoreItem[] = batch.map((it) => ({
      text: it.news.headline,
      questions: it.candidates.map((c) => c.question),
    }));

    const scoresBatch = await llmScoreBatch(scoreItems, model);
    llmCalls++;

    for (let b = 0; b < batch.length; b++) {
      const { news: newsItem, candidates } = batch[b];
      const scores = scoresBatch[b];
      for (let j = 0; j < candidates.length && j < scores.length; j++) {
        const llmScore = scores[j];
        if (llmScore < LLM_THRESHOLD) continue;

        matches.push({
          contract: candidates[j],
          news: newsItem,
          confidence: Math.min(1, llmScore + 0.05),
          matchedKeywords: newsItem.keywords.filter((k) =>
            candidates[j].keywords.includes(k),
          ),
          correlatedAt: Date.now(),
        });
      }
    }

    processed += batch.length;
    onProgress?.({
      phase: 'llm-generating-news',
      current: processed,
      total: news.length,
      engine: 'llm',
      model,
    });
  }

  const totalElapsed = ((performance.now() - llmStart) / 1000).toFixed(1);
  console.log(`[TrendCast] ML: LLM correlateNewsLLM done — ${llmCalls} batched LLM calls, ${matches.length} matches, ${totalElapsed}s total`);
  return matches.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Correlate news headlines against social signals using an LLM.
 * Scores each signal's candidate news items in batched LLM calls.
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

  const scored: { signal: SocialSignal; candidates: NewsItem[] }[] = [];
  for (let i = 0; i < signals.length; i++) {
    checkCancelled(cancelFlag);
    const candidateNews = news
      .filter((n) => n.keywords.some((k) => signals[i].keywords.includes(k)))
      .slice(0, LLM_MAX_CANDIDATES);
    if (candidateNews.length === 0) continue;
    scored.push({ signal: signals[i], candidates: candidateNews });
  }

  const batchSize = await computeLLMBatchSize(model);
  let llmCalls = 0;
  let processed = 0;
  for (let start = 0; start < scored.length; start += batchSize) {
    checkCancelled(cancelFlag);
    const batch = scored.slice(start, start + batchSize);
    const scoreItems: LLMScoreItem[] = batch.map((it) => ({
      text: it.signal.text,
      questions: it.candidates.map((n) => n.headline),
    }));

    const scoresBatch = await llmScoreBatch(scoreItems, model);
    llmCalls++;

    for (let b = 0; b < batch.length; b++) {
      const { signal, candidates } = batch[b];
      const scores = scoresBatch[b];
      for (let j = 0; j < candidates.length && j < scores.length; j++) {
        const llmScore = scores[j];
        if (llmScore < LLM_THRESHOLD) continue;

        const viralityWeight = (signal.virality / 100) * 0.1;
        const confidence = Math.min(1, llmScore + viralityWeight);

        matches.push({
          news: candidates[j],
          signal,
          confidence,
          matchedKeywords: candidates[j].keywords.filter((k) =>
            signal.keywords.includes(k),
          ),
          correlatedAt: Date.now(),
        });
      }
    }

    processed += batch.length;
    onProgress?.({
      phase: 'llm-generating-news-social',
      current: processed,
      total: signals.length,
      engine: 'llm',
      model,
    });
  }

  const totalElapsed = ((performance.now() - llmStart) / 1000).toFixed(1);
  console.log(`[TrendCast] ML: LLM correlateNewsSocialLLM done — ${llmCalls} batched LLM calls, ${matches.length} matches, ${totalElapsed}s total`);
  return matches.sort((a, b) => b.confidence - a.confidence);
}