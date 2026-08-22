# Phase 3: Correlation Speedup — Pattern Map

**Mapped:** 2026-08-22
**Files analyzed:** 10 (1 new index, 6 modified engines, 3 test groups)
**Analogs found:** 10 / 10

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/services/engine/index.ts` (new `InvertedIndex`) | service | CRUD (build) + request-response (candidates) | `ZeroShotIndex` class + `findCandidateContracts` in `ml/zeroshot.ts`; `EntityCache` in `correlation.ts` | exact |
| `src/services/engine/correlation.ts` (modified) | service | request-response (naive loop) | itself — `correlate`/`correlateNews`/`correlateNewsSocial` + `correlatePair` | exact (self) |
| `src/services/engine/ml/zeroshot.ts` (modified) | service | request-response | itself — `findCandidateContracts`/`findCandidateContractsForNews` | exact (self) |
| `src/services/engine/ml/embedding.ts` (modified) | service | request-response | itself — `EmbeddingIndex` + `correlateSignalsToContracts` | role-match (self) |
| `src/services/engine/ml/sentiment.ts` (modified) | service | request-response | itself — inline keyword filter in `correlateSignalsToContracts` | role-match (self) |
| `src/services/engine/ml/ner.ts` (modified) | service | request-response | itself — `NEREntityIndex` + `correlateSignalsToContracts` | role-match (self) |
| `src/services/engine/ml/llm.ts` (modified) | service | request-response | itself — inline keyword filter in `correlateLLM`/`correlateNewsLLM`/`correlateNewsSocialLLM` | role-match (self) |
| `tests/unit/index.test.ts` (new) | test | unit | `tests/unit/correlation.test.ts` | exact |
| `tests/unit/{engine}-equivalence.test.ts` ×6 (new) | test | unit | `tests/unit/correlation.test.ts` + `correlation-threshold.test.ts` | exact |
| `tests/unit/fixtures.ts` (new) | test fixture | shared | `mockContract`/`mockSignal` in `correlation.test.ts`; `newsItem()` in `correlation-threshold.test.ts` | exact |

---

## Pattern Assignments

### `src/services/engine/index.ts` — new `InvertedIndex` class (service, CRUD+request)

**Analog:** `ZeroShotIndex` class + `findCandidateContracts` in `src/services/engine/ml/zeroshot.ts`; `EntityCache` in `src/services/engine/correlation.ts`

This is the **core new file**. It generalizes the zero-shot engine's existing pre-filter into a shared `Map<keyword, contractId[]>` index. Follow the established **index-class shape** (private `Map` cache + constructor + methods) used by every ML engine.

**Index-class shape to copy** (`zeroshot.ts` lines 44–88):
```typescript
class ZeroShotIndex {
  private readonly cache = new Map<string, Map<string, number>>();
  private readonly model: ZeroShotModel;

  constructor(model: ZeroShotModel) {
    this.model = model;
  }

  async classify(text: string, labels: string[]): Promise<Map<string, number>> {
    const key = text + '\u0000' + labels.join('\u0000');
    const cached = this.cache.get(key);
    if (cached) return cached;
    // ... compute, cache, return
  }
}
```

**The pre-filter to generalize** — `zeroshot.ts` lines 90-110 (this is the O(n×m) `filter`+`some` that the inverted index replaces):
```typescript
function findCandidateContracts(
  signalKeywords: string[],
  contracts: MarketContract[],
): MarketContract[] {
  const candidates = contracts
    .filter((c) => c.keywords.some((k) => signalKeywords.includes(k)))
    .slice(0, ZEROSHOT_MAX_LABELS);
  return candidates;
}
```

**Memoization-cache pattern to copy** — `correlation.ts` lines 30-55 (`EntityCache`):
```typescript
class EntityCache {
  private entityKeywords = new Map<string, string[]>();
  private entityMaps = new Map<string, Map<string, number>>();

  getKeywords(text: string): string[] {
    let cached = this.entityKeywords.get(text);
    if (!cached) {
      cached = extractEntityKeywords(text);
      this.entityKeywords.set(text, cached);
    }
    return cached;
  }
  // getConfidenceMap(...) same shape
}
```

**What to reuse vs. new:**
- **Reuse:** the `Map`-backed cache field pattern; the `private readonly` field + constructor idiom; the `get`-then-compute-then-`set` memoization shape from `EntityCache`.
- **New:** the `Map<keyword, contractId[]>` inverted structure; a `build(contracts)` method that tokenizes each contract's `keywords` once and posts into the map; a `candidates(keywords)` method that unions the postings lists for a signal/news keyword set; a `fallback`/tiny-input path (when index not built or inputs below threshold, fall back to the naive loop). **Single tokenization source** — the index and matcher must share one tokenizer (reconcile `extractKeywords`/`extractEntities` from `utils/keywords.ts`/`utils/entities.ts` with the ML engines' `keywords` arrays).

**Contract type** — `src/types/index.ts` line 23: `MarketContract` has `id: string` and `keywords: string[]`. The index maps `keyword → contractId[]`, then resolves ids back to contracts (or stores contract refs directly).

---

### `src/services/engine/correlation.ts` — MODIFIED heuristic path (service, request-response)

**Analog:** itself (the naive O(n×m) loop is the equivalence oracle)

**Core pattern to preserve (the oracle)** — `correlation.ts` lines 120-160 (`correlate` + `correlatePair`):
```typescript
export function correlate(signals, contracts): CorrelationMatch[] {
  const matches: CorrelationMatch[] = [];
  const cache = new EntityCache();
  for (const signal of signals) {
    for (const contract of contracts) {
      const result = correlatePair(signal, contract, cache);
      if (result) matches.push(result);
    }
  }
  return matches.sort((a, b) => b.confidence - a.confidence);
}
```

**What to change:** wrap the inner `for (const contract of contracts)` loop with the shared `InvertedIndex.candidates(signal.keywords)` pre-filter. The `correlatePair` body (entity similarity + keyword similarity + cashtag boost + threshold) must remain **byte-for-byte identical** so equivalence holds. Same for `correlateNews`/`correlateNewsPair` and `correlateNewsSocial`/`correlateNewsSocialPair`.

**Reuse:** `EntityCache` (keep — it memoizes NER extraction); `cachedEntitySimilarity`; `keywordSimilarity` from `utils/keywords.ts`; `extractEntityKeywords`/`extractEntities` from `utils/entities.ts`; the `MIN_CONFIDENCE`/`MIN_CONFIDENCE_ENTITY_MATCH`/`CASHTAG_BOOST`/`ENTITY_WEIGHT`/`KEYWORD_WEIGHT` constants.

**New:** the candidate pre-filter call; the tiny-input fallback (when index not built, keep the naive loop so results are unchanged).

---

### `src/services/engine/ml/zeroshot.ts` — MODIFIED (service, request-response)

**Analog:** itself — `findCandidateContracts`/`findCandidateContractsForNews` (lines 90-110) are the exact pre-filters to replace with the shared index.

**Reuse:** `ZeroShotIndex` class (keep); `correlateSignalsToContracts`/`correlateNewsToContracts`/`correlateNewsToSignals` structure; `ZEROSHOT_THRESHOLD`/`ZEROSHOT_MAX_LABELS` from `ml/types.ts`; the `onProgress`/`checkCancelled`/`cancelFlag` plumbing.

**Change:** replace the two `findCandidateContracts*` functions (and the inline `news.filter(...)` in `correlateNewsToSignals`) with `InvertedIndex.candidates(...)`. The `.slice(0, ZEROSHOT_MAX_LABELS)` cap must be preserved for equivalence.

---

### `src/services/engine/ml/embedding.ts` — MODIFIED (service, request)

**Analog:** itself — `EmbeddingIndex` class (lines 120-190) + `correlateSignalsToContracts` (lines 230-300).

**Important:** embedding currently has **no keyword pre-filter** — it embeds all contracts and compares every pair via `cosineSimilarity`. Adding the index pre-filter is a **behavior change** that the equivalence test must guard. The `EmbeddingIndex`/`BatchEmbedder` batching machinery stays untouched.

**Reuse:** `EmbeddingIndex` class, `BatchEmbedder`, `cosineSimilarity`/`normalize`/`meanPool` from `ml/math.ts`, `EMBEDDING_THRESHOLD`.

**Change:** wrap the inner `for (let j = 0; j < contracts.length; j++)` loop with `InvertedIndex.candidates(signal.keywords)`. **Equivalence risk:** the naive loop scores ALL contracts; the indexed path only scores candidates. The equivalence test must assert that non-candidate contracts never exceed `EMBEDDING_THRESHOLD` (or the index must be a superset that provably contains every contract that could match).

---

### `src/services/engine/ml/sentiment.ts` — MODIFIED (service, request)

**Files:** itself — the inline keyword filter in `correlateSignalsToContracts` (lines 300-320):
```typescript
for (const contract of contracts) {
  const matchedKeywords = signal.keywords.filter((k) =>
    contract.keywords.includes(k),
  );
  if (matchedKeywords.length === 0) continue;
  // overlapRatio, sentimentMagnitude, confidence...
}
```

**Reuse:** `SentimentIndex` class, `BatchSentimentClassifier`, `normalizeSentiment`, `SENTIMENT_THRESHOLD`.

**Change:** replace the inline `filter`+`continue` with `InvertedIndex.candidates(...)`. The `matchedKeywords` computation must stay identical (it feeds `overlapRatio`).

---

### `src/services/engine/ml/ner.ts` — MODIFIED (service)

**Files:** itself — `NEREntityIndex` (lines 150-220) + `correlateSignalsToContracts` (lines 300-360). Like embedding, NER currently has **no keyword pre-filter** — it compares all pairs via `nerEntitySimilarity`. Adding the index pre-filter is a behavior change the equivalence tests must guard.

**Reuse:** `NEREntityIndex`, `BatchEntityExtractor`, `aggregateEntities`, `nerEntitySimilarity`, `NER_THRESHOLD`.

**Change:** wrap the inner `for (let j = 0; j < contracts.length; j++)` loop with `InvertedIndex.candidates(...)`.

---

### `src/services/engine/ml/llm.ts` — MODIFIED (service)

**Pattern:** itself — inline keyword pre-filter in `correlateLLM` (lines 249-260), `correlateNewsLLM` (lines 327-340), `correlateNewsSocialLLM` (lines 401-415):
```typescript
const candidates = contracts
  .filter((c) => c.keywords.some((k) => signals[i].keywords.includes(k)))
  .slice(0, LLM_MAX_CANDIDATES);
```

**Reuse:** `computeLLMBatchSize`, `llmScoreBatch`, `buildMessages`, `parseScores`, `extractGenerated`, `LLM_THRESHOLD`/`LLM_MAX_CANDIDATES`/`LLM_MAX_NEW_TOKENS` from `ml/types.ts`.

**Change:** replace the three inline `filter`+`slice` blocks with `InvertedIndex.candidates(...)`. Preserve `.slice(0, LLM_MAX_CANDIDATES)` (note: LLM cap is 5, zero-shot is 15 — the index must accept a per-engine cap).

---

### `tests/unit/index.test.ts` — NEW (test)

**Analog:** `tests/unit/correlation.test.ts` — vitest `describe`/`it`/`expect` structure, `@/` path aliases.

**Reuse the test skeleton:**
```typescript
import { describe, it, expect } from 'vitest';
import { extractKeywords, keywordSimilarity } from '@/utils/keywords';
import { correlate } from '@/services/engine/correlation';
import type { MarketContract, SocialSignal } from '@/types';
```

**New coverage:** `build()` populates the map; `candidates()` returns correct contract ids for overlapping keywords; empty keyword array → empty; single contract; single signal; duplicate keywords deduped; cashtag/hashtag-only texts; tiny-input fallback (index not built → naive path).

---

### `tests/unit/{engine}-equivalence.test.ts` ×6 — new per-engine equivalence tests

**Analog:** `correlation.test.ts` + `correlation-threshold.test.ts` (the `newsItem()` fixture helper pattern).

**Pattern to copy** — `correlation-threshold.test.ts` lines 30-45 (fixture builder):
```typescript
function newsItem(source: NewsItem['source'], headline: string): NewsItem {
  return {
    id: `${source}:${headline}`,
    source,
    headline,
    url: `https://example.com/${source}`,
    publishedAt: new Date().toISOString(),
    keywords: extractKeywords(headline),
  };
}
```

**New structure (per D-04):** each file runs the **naive loop** (reference oracle) and the **indexed path** over the same shared fixtures and asserts identical results — same matches, same confidence, same order. Plus hand-verified golden fixtures (D-02) guarding against both paths sharing a bug. Edge cases per D-03: empty keyword arrays, single contract, single signal, duplicate keywords, cashtag/hashtag-only, tiny-input fallback.

**Files:** `correlation-equivalence.test.ts`, `zeroshot-equivalence.test.ts`, `embedding-equivalence.test.ts`, `sentiment-equivalence.test.ts`, `ner-equivalence.test.ts`, `llm-equivalence.test.ts`.

---

### `tests/unit/fixtures.ts` — new shared fixtures

**Analog:** `mockContract`/`mockSignal` in `correlation.test.ts` (lines 45-90) + `newsItem()` in `correlation-threshold.test.ts`.

**Reuse the exact fixture shapes** — `mockContract` (a `MarketContract` with `id`, `platform`, `question`, `outcomes`, `endDate`, `keywords`, `lastUpdated`) and `mockSignal` (a `SocialSignal` with `id`, `platform`, `text`, `author`, `metrics`, `timestamp`, `keywords`, `sentiment`, `virality`). Export these as named constants so all 7 test files import from one place.

---

## Shared Patterns

### Index-class shape (all engines)
**Source:** `ZeroShotIndex` in `ml/zeroshot.ts` (lines 30-88), `EmbeddingIndex` in `ml/embedding.ts` (lines 62-190), `SentimentIndex` in `ml/sentiment.ts`, `NEREntityIndex` in `ml/ner.ts`
**Apply to:** `src/services/engine/index.ts` (the new `InvertedIndex`)
```typescript
class XIndex {
  private readonly cache = new Map<string, ...>();
  constructor(...) { ... }
  // build / candidates / fallback methods
}
```

**Pre-filter to generalize** — `ml/zeroshot.ts` lines 90-110 (`findCandidateContracts`/`findCandidateContractsForNews`). This is the exact O(n×m) `filter`+`some` that becomes the shared `Map<keyword, contractId[]>` index.

**Memoization cache** — `correlation.ts` lines 30-55 (`EntityCache`): the `get`-then-compute-then-`set` shape for the index's incremental build.

### Candidate pre-filter (all engines)
**Source:** `ml/zeroshot.ts` `findCandidateContracts`; `ml/llm.ts` inline `filter`+`slice`; `ml/sentiment.ts` inline `filter`+`continue`
**Apply to:** `correlation.ts`, `ml/zeroshot.ts`, `ml/embedding.ts`, `ml/sentiment.ts`, `ml/ner.ts`, `ml/llm.ts`
```typescript
const candidates = contracts
  .filter((c) => c.keywords.some((k) => signalKeywords.includes(k)))
  .slice(0, MAX_LABELS); // per-engine cap: ZEROSHOT_MAX_LABELS=15, LLM_MAX_CANDIDATES=5
```
Replace with `InvertedIndex.candidates(signalKeywords, cap)`.

### ML dispatch facade
**Source:** `src/services/engine/ml.ts` (barrel re-exports) + `src/background/index.ts` lines 155-205 (`runMLCorrelation`) + `src/workers/ml-worker.ts` lines 162-188
**Apply to:** wiring the shared index so all paths use it. The facade re-exports each engine's `correlate*`/`correlateAll*`; the background orchestrator and worker call them. The index build/cache lifecycle hooks into `src/background/index.ts` (the orchestrator that calls correlation).

### Progress / cancellation
**Source:** `ml/types.ts` — `ProgressCallback`, `CancelFlag`, `checkCancelled`, `CorrelationPhase`
**Apply to:** all engine modifications — preserve the `onProgress?.({ phase, current, total, engine, model })` and `checkCancelled(cancelFlag)` calls exactly.

### Test structure
**Source:** `tests/unit/correlation.test.ts`, `tests/unit/correlation-threshold.test.ts`
**Apply to:** all new test files. Vitest `describe`/`it`/`expect`, `@/` alias imports, shared fixtures from `tests/unit/fixtures.ts`.

---

## No Analog Found

None — every planned file maps to an existing engine, index class, or test file. The `InvertedIndex` is new but follows the established index-class shape; the equivalence tests follow the existing vitest fixture pattern.

## Metadata

**Analog search scope:** `src/services/engine/`, `src/services/engine/ml/`, `src/utils/`, `src/background/`, `src/workers/`, `src/types/`, `tests/unit/`
**Files scanned:** 12 (6 engine files, 2 utils, ml.ts facade, background orchestrator, ml-worker, types, 2 test files)
**Pattern extraction date:** 2026-08-22
