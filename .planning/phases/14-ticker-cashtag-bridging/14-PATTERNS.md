# Phase 14: Ticker/Cashtag Bridging - Pattern Map

**Mapped:** 2026-08-27
**Files analyzed:** 12 (6 production, 6 test)
**Analogs found:** 12 / 12 (all modifications — every file's analog is its own existing structure or a direct sibling; no greenfield files)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/utils/keywords.ts` | utility | transform | self (existing `extractKeywords`/`keywordSimilarity` structure) | exact (in-place edit) |
| `src/utils/entities.ts` | utility (NER) | transform | self (existing curated-KB + regex ladder in `extractEntities`) | exact (in-place edit) |
| `src/utils/source-health.ts` | utility (projection) | transform | self — `computeCorrelatedCounts` (lines 55-64) is the literal template for `computeBridgingCoverage` | exact |
| `src/services/collectors/news.ts` | service (collector) | file-I/O + transform | self — stock-indicator block (lines 278-312) | exact (in-place edit) |
| `src/services/engine/correlation.ts` | service (engine) | request-response/batch | self — `correlatePair` boost block (lines 184-190) | exact (in-place edit) |
| `src/dashboard/components/SourceHealthIndicator.tsx` | component | event-driven (render) | self — `correlatedCounts` prop plumbing (lines 19-21, 87-97, 149) | exact (in-place edit) |
| `tests/unit/correlation-equivalence.test.ts` | test (equivalence oracle) | batch | self — naive oracles (lines 76-190) | exact (lockstep edit) |
| `tests/unit/correlation.test.ts` | test (unit) | transform | self — cashtag assertion (lines 17-20) | exact |
| `tests/unit/index.test.ts` | test (unit) | transform | self — cashtag-only candidates test (lines 116-119) | exact |
| `tests/unit/news-collector.test.ts` | test (unit) | file-I/O | self + `source-health.test.ts` fixture-builder style | exact |
| `tests/unit/source-health.test.ts` | test (unit) | transform | self — `computeCorrelatedCounts` describe block (lines 109-149) is the template for the new coverage tests | exact |
| `tests/unit/` (new bridging tests) | test (unit) | transform | `tests/unit/correlation-equivalence.test.ts` (oracle style) + `tests/unit/fixtures.ts` (fixture style) | role-match |

## Pattern Assignments

### `src/utils/keywords.ts` (utility, transform) — CORR-02

**Analog:** self — the file is 68 lines; edit in place, preserving the module docstring and export order.

**Current cashtag emission** (lines 30-33) — the `$` prefix lives here:
```typescript
  // Extract cashtags: $TICKER
  const cashtags = text.match(/\$[A-Z]{2,}/g) ?? [];
  cashtags.forEach((tag) => keywords.add(tag.toLowerCase()));
```

**Current compare-time similarity** (lines 51-58) — where the legacy strip-$ bridge goes:
```typescript
export function keywordSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a.map((k) => k.toLowerCase()));
  const setB = new Set(b.map((k) => k.toLowerCase()));
  const intersection = new Set([...setA].filter((k) => setB.has(k)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}
```

**Pattern to copy (from RESEARCH.md Pattern 1, verified against this file):** normalize once per input array, before set construction — never inside a per-pair loop:
```typescript
export function keywordSimilarity(a: string[], b: string[]): number {
  // Normalize both sides: strip leading '$' so legacy stored cashtag
  // keywords ('$btc') bridge to bare forms ('btc') with no data migration.
  const norm = (k: string) => (k.startsWith('$') ? k.slice(1) : k);
  const setA = new Set(a.map((k) => norm(k.toLowerCase())));
  const setB = new Set(b.map((k) => norm(k.toLowerCase())));
  // ...existing Jaccard intersection/union logic unchanged...
}
```

**Decision locked by research (Open Question 1):** emit **bare-only** from `extractKeywords` (change `keywords.add(tag.toLowerCase())` → `keywords.add(tag.toLowerCase().slice(1))`); strip-$ in `keywordSimilarity` is the legacy-data bridge only. Do NOT emit dual forms.

---

### `src/utils/entities.ts` (utility, NER, transform) — CORR-01

**Analog:** self — `extractEntities` (lines 197-357) is a numbered-stage pipeline; the new bare-caps stage slots in as a new numbered stage following the exact house style.

**Curated-KB pattern** (lines 39-48, 77-99) — reuse, never hand-roll a new ticker table:
```typescript
const KNOWN_TICKERS = new Set([
  'aapl', 'msft', 'googl', 'goog', 'amzn', 'nvda', 'meta', 'tsla',
  // ... 48 entries total; NOTE 'v' IS present → bare-caps path MUST gate on length >= 2
]);
const KNOWN_ORGS = new Map<string, string[]>([
  ['amazon', ['amazon', 'amzn']],   // ← alias 'amzn' is the dual-canonicalization culprit
  // ...
]);
```

**Stage-1 cashtag pattern** (lines 201-215) — the dedupe-by-`seen`-set + confidence-ladder idiom every new stage must copy:
```typescript
  // 1. Cashtags: $TICKER
  const cashtagMatches = text.matchAll(/\$([A-Z]{1,6})\b/g);
  for (const match of cashtagMatches) {
    const ticker = match[1].toLowerCase();
    const normalized = `$${ticker}`;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      entities.push({
        text: match[0],
        normalized: ticker,
        type: 'ticker',
        confidence: KNOWN_TICKERS.has(ticker) ? 0.95 : 0.7,
      });
    }
  }
```

**Word-boundary matching pattern** (lines 172-194) — mandatory for short tokens; do NOT use `indexOf`:
```typescript
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function matchKeyword(text: string, keyword: string): boolean {
  if (keyword.length <= 4) {
    return new RegExp(`\\b${escapeRegex(keyword)}\\b`, 'i').test(text);
  }
  return text.includes(keyword);
}
```

**Alias-loop pattern** (lines 246-262, Organizations stage) — the template for ticker↔org unification: when an org alias collides with a ticker, the canonical key must become the bare ticker (A2):
```typescript
  // Organizations
  for (const [canonical, aliases] of KNOWN_ORGS) {
    for (const alias of aliases) {
      if (matchKeyword(lowerText, alias) && !seen.has(canonical)) {
        seen.add(canonical);
        entities.push({
          text: alias,
          normalized: canonical,   // ← unify: map 'amzn' alias hits to ticker key 'amzn'
          type: 'organization',
          confidence: 0.8,
        });
        break;
      }
    }
  }
```

**New stage to add (bare-caps recognition) — gates verified against lines 39-48 and 147-176:**
```typescript
  // N. Bare all-caps tickers (CORR-01): mixed-case regexes at stages 4/5
  // can't see these. Gate: KNOWN_TICKERS ∩ length>=2 ∩ ¬STOP_WORDS.
  // 'V' excluded by {2,6}; 'ALL'/'ON'/'US'/'UK' excluded by STOP_WORDS;
  // 'XPON' excluded by KNOWN_TICKERS. Fixed literal regex — never
  // interpolate feed data into RegExp sources (ReDoS, ASVS V5).
  const bareCaps = text.matchAll(/\b([A-Z]{2,6})\b/g);
  for (const match of bareCaps) {
    const normalized = match[1].toLowerCase();
    if (KNOWN_TICKERS.has(normalized) && !STOP_WORDS.has(normalized) && !seen.has(normalized)) {
      seen.add(normalized);
      entities.push({ text: match[1], normalized, type: 'ticker', confidence: 0.85 });
    }
  }
```
Confidence 0.85 per A3 (between cashtag 0.95 and hashtag 0.6); must be mirrored in the equivalence oracle fixtures.

**Downstream consumers that inherit the fix unchanged** (lines 360-395): `extractEntityKeywords` (line 360) and `entitySimilarity` (line 370, confidence-weighted Jaccard keyed on `e.normalized`) — both consume `extractEntities` output, so canonical-key unification propagates automatically. Do not touch them.

---

### `src/utils/source-health.ts` (utility, projection, transform) — CORR-04

**Analog:** `computeCorrelatedCounts` in the same file (lines 55-64) — the literal template. Same import block (lines 8-16), same "pure, testable projection" docstring convention.

**Import pattern** (lines 8-16):
```typescript
import type {
  NewsCorrelationMatch,
  NewsItem,
  NewsSource,
  SocialPlatform,
  SocialSourceHealth,
  SourceHealthEntry,
} from '@/types';
```

**Template to copy** (lines 55-64):
```typescript
export function computeCorrelatedCounts(
  newsMatches: NewsCorrelationMatch[],
): Partial<Record<NewsSource, number>> {
  const counts: Partial<Record<NewsSource, number>> = {};
  for (const match of newsMatches) {
    const source = match.news.source;
    counts[source] = (counts[source] ?? 0) + 1;
  }
  return counts;
}
```

**New function (CORR-04) — same shape, two inputs, no storage I/O, no `SourceHealthEntry` schema change:**
```typescript
export function computeBridgingCoverage(
  news: NewsItem[],
  newsMatches: NewsCorrelationMatch[],
): Partial<Record<NewsSource, { total: number; bridged: number }>> {
  const bridgedIds = new Set(newsMatches.map((m) => m.news.id));
  const acc: Partial<Record<NewsSource, { total: number; bridged: number }>> = {};
  for (const item of news) {
    const e = (acc[item.source] ??= { total: 0, bridged: 0 });
    e.total += 1;
    if (bridgedIds.has(item.id)) e.bridged += 1;
  }
  return acc;
}
```
Place it directly after `computeFetchedCounts` (line 84) to keep the file's grouping (health → correlated → fetched → social merge).

---

### `src/services/collectors/news.ts` (service, collector, file-I/O + transform) — CORR-03

**Analog:** self — the stock-indicator block (lines 278-312) is the only site synthesizing headlines from source labels.

**Source-set + label patterns** (lines 56-71) — reuse these constants; do not duplicate:
```typescript
const STOCK_INDICATOR_SOURCES: ReadonlySet<NewsSource> = new Set([
  'usaStocksIndicator', 'stockScreener', 'stockScreener2',
]);
const STOCK_SOURCE_LABELS: Record<NewsSource, string> = {
  // ...
  usaStocksIndicator: 'Stock Indicator',
  stockScreener: 'Breakout',
  stockScreener2: 'VCP',
};
```

**Current keyword emission** (lines 293-311) — the curation point:
```typescript
                return symbols.map((symbol) => {
                  const stockHeadline = date
                    ? `${symbol} — ${label} ${date}`
                    : `${symbol} — ${label}`;
                  return {
                    id: `${source}:${id}:${symbol}`,
                    source,
                    headline: stockHeadline,
                    summary: undefined,
                    url: link,
                    publishedAt,
                    // Ticker in keywords so the correlation engine can match it
                    // against market contracts and social signals.
                    keywords: extractKeywords(`${stockHeadline} ${symbol}`),
                    imageUrl: imageUrl ?? undefined,
                    category: classifyCategory(stockHeadline),
                  } satisfies NewsItem;
                });
```

**Pattern to copy (curation):** for `STOCK_INDICATOR_SOURCES.has(source)`, replace the raw `extractKeywords(...)` with ticker-only tokens (A4): `keywords: [symbol.toLowerCase()]`. Keep the `satisfies NewsItem` literal and the existing comment style. Non-stock-indicator sources (line 322, `keywords: extractKeywords(fullText)`) stay untouched.

---

### `src/services/engine/correlation.ts` (service, engine, batch) — boost rework

**Analog:** self — `correlatePair` (lines 155-234).

**Superset-invariant pattern** (lines 111-122) — the comment + helper that keeps index and naive paths in sync; any keyword-form change must flow through here, not around it:
```typescript
function candidateKeywords(keywords: string[], text: string): string[] {
  return [...new Set([...keywords, ...extractEntityKeywords(text)])];
}
```

**Boost detection to rework** (lines 184-190) — currently keys on string shape, silently dead once keywords go bare:
```typescript
  // Cashtag/hashtag boost
  const signalTags = signal.keywords.filter(
    (k) => k.startsWith('$') || signal.text.includes(`#${k}`),
  );
  const contractTags = contract.keywords.filter((k) => k.startsWith('$'));
  const tagOverlap = signalTags.filter((k) => contractTags.includes(k)).length;
  const boost = tagOverlap > 0 ? CASHTAG_BOOST * tagOverlap : 0;
```

**Pattern to copy:** replace `startsWith('$')` detection with KNOWN_TICKERS membership (or entity type `'ticker'`) on both sides; keep the `#`-hashtag half of the signal filter unchanged. Constants `CASHTAG_BOOST`/`ENTITY_WEIGHT`/`KEYWORD_WEIGHT` (lines 100-108) stay as-is. `matchedKeywords` intersection blocks (lines 211-213, 290-292, 366-368) need no edit — they inherit bare forms from extraction.

---

### `src/dashboard/components/SourceHealthIndicator.tsx` (component, render) — CORR-04 display

**Analog:** self — the `correlatedCounts` prop is the exact plumbing to clone for coverage.

**Props pattern** (lines 19-28):
```typescript
interface SourceHealthIndicatorProps {
  health: SourceHealth;
  correlatedCounts: Partial<Record<NewsSource, number>>;
  /** Accumulated news items — used to show the real per-source fetched count. */
  news: NewsItem[];
  // ...
}
```

**Consumption pattern** (lines 87-97, 146-149):
```typescript
function SourceHealthIndicatorImpl({
  health,
  correlatedCounts,
  news,
  // ...
}: SourceHealthIndicatorProps) {
  // ...
  const fetchedCounts = computeFetchedCounts(news);
  // ...
        const correlated = correlatedCounts[source] ?? 0;
```

**Tooltip pattern** (line 152) — extend, don't replace:
```typescript
            title={`${sourceLabels[source]}: ${meta.label} — fetched ${fetched} · correlated ${correlated}${fails > 0 ? ` · ${fails} fail${fails === 1 ? '' : 's'}` : ''}${active ? ' (click to remove filter)' : ' (click to filter)'}`}
```
Add a `bridgingCoverage` prop (same `Partial<Record<NewsSource, …>>` shape) and append `· bridged X/Y` to the tooltip. **Caller pattern** — `src/dashboard/App.tsx` lines 427-429 and 742-744 pass `correlatedCounts={computeCorrelatedCounts(correlations?.newsMatches ?? [])}`; clone that line for `bridgingCoverage={computeBridgingCoverage(news, correlations?.newsMatches ?? [])}` at both render sites.

---

### `tests/unit/correlation-equivalence.test.ts` (test, oracle) — lockstep edits

**Analog:** self — the four naive oracles replicate production line-for-line and MUST change in the same edit as production (Pitfall 4).

**Oracle constants** (lines 42-46) — mirror production values exactly:
```typescript
const MIN_CONFIDENCE = 0.75;
const MIN_CONFIDENCE_ENTITY_MATCH = 0.35;
const CASHTAG_BOOST = 0.3;
const ENTITY_WEIGHT = 0.65;
const KEYWORD_WEIGHT = 0.35;
```

**Oracle boost block** (lines 106-112) — the mirror of `correlatePair`'s; apply the identical KNOWN_TICKERS-based detection here:
```typescript
  const signalTags = signal.keywords.filter(
    (k) => k.startsWith('$') || signal.text.includes(`#${k}`),
  );
  const contractTags = contract.keywords.filter((k) => k.startsWith('$'));
```
All four oracles to touch: `naiveCorrelatePair` (line 97), `naiveCachedEntitySimilarity` (line 76 — mirror any confidence-ladder change, e.g. bare-caps 0.85), `naiveCorrelateNewsPair` (line 137), `naiveCorrelateNewsSocialPair` (line 169). **Never delete or loosen golden-fixture/D-03 assertions** — add NEW bridged-match assertions alongside.

---

### `tests/unit/fixtures.ts` + `tests/unit/correlation.test.ts` + `tests/unit/index.test.ts` (tests) — form updates

**Fixture pattern** (`tests/unit/fixtures.ts` lines 67-87) — cashtag fixtures lock the current `$`-form; update keywords to bare (`'btc'`) while keeping texts unchanged:
```typescript
export const cashtagOnlyContract: MarketContract = {
  id: 'cashtag-btc',
  // ...
  keywords: ['$btc'],   // → ['btc']
};
export const cashtagOnlySignal: SocialSignal = {
  id: 'sig-cashtag',
  text: '$BTC to the moon',
  keywords: ['$btc'],   // → ['btc']
```

**Assertion sites to update in lockstep:**
- `tests/unit/correlation.test.ts:17-20` — `expect(result).toContain('$btc')` → `toContain('btc')`
- `tests/unit/index.test.ts:116-119` — `idx.candidates(['$btc'])` → `idx.candidates(['btc'])` (keep a legacy strip-$ case if `keywordSimilarity` keeps the bridge)

---

### `tests/unit/source-health.test.ts` (test) — new coverage describe block

**Analog:** self — the `computeCorrelatedCounts` block (lines 109-149) is the template: local `match(source)` builder, empty-input case, grouping case.

**Builder pattern to copy** (lines 110-133):
```typescript
describe('computeCorrelatedCounts', () => {
  function match(source: NewsSource): NewsCorrelationMatch {
    return {
      contract: { /* minimal contract literal */ },
      news: {
        id: `${source}:1`,
        source,
        headline: 'h',
        url: `https://example.com/${source}/1`,
        publishedAt: new Date(NOW).toISOString(),
        keywords: [],
      },
      confidence: 0.8,
      matchedKeywords: ['btc'],
      correlatedAt: NOW,
    };
  }
```
New `describe('computeBridgingCoverage')` mirrors this plus a `news` builder (copy the `item(source, id)` helper from lines 152-161) and asserts `{ total, bridged }` per source, including the "item present but not bridged" and "no matches → all bridged: 0" cases.

---

### New bridging tests (`tests/unit/`, Wave 0)

**Analog:** `tests/unit/correlation-equivalence.test.ts` for oracle/structure style; `tests/unit/fixtures.ts` for fixture literals. Required golden assertions (Pitfall 3 gates):
- `extractEntities('V')` → no ticker entity (length gate)
- `extractEntities('ALL CAPS ON US')` → no ticker entities (STOP_WORDS gate)
- `extractEntities('XPON')` → no entity (KNOWN_TICKERS gate)
- `extractEntities('AMZN — Stock Indicator')` → `{ normalized: 'amzn', type: 'ticker' }` (unified key)
- `keywordSimilarity(['$amzn'], ['amzn'])` → 1 (legacy strip-$ bridge)
- Indexed-path superset: every bridged pair found via `getIncrementalIndex(..., { includeEntityKeywords: true }).candidates(...)` (Pitfall 2)

## Shared Patterns

### Extraction-time canonicalization + compare-time legacy bridge
**Source:** `src/utils/keywords.ts:30-58`, `src/utils/entities.ts:201-215`
**Apply to:** all keyword/entity producers and the similarity functions
```typescript
// Emit bare lowercase at extraction; strip '$' at compare for legacy data.
const norm = (k: string) => (k.startsWith('$') ? k.slice(1) : k);
```

### Superset invariant (index ≡ naive)
**Source:** `src/services/engine/correlation.ts:111-122` (`candidateKeywords` doc + helper)
**Apply to:** every keyword-form change — both `getIncrementalIndex(..., {includeEntityKeywords:true})` and the pairwise loops must consume the same `extractKeywords`/`extractEntityKeywords` output.

### Oracle lockstep
**Source:** `tests/unit/correlation-equivalence.test.ts:97-190`
**Apply to:** any production scoring change — update `naiveCorrelatePair`, `naiveCachedEntitySimilarity`, `naiveCorrelateNewsPair`, `naiveCorrelateNewsSocialPair` in the same edit; never weaken golden/D-03 assertions.

### Pure projection for derived health stats
**Source:** `src/utils/source-health.ts:55-84` (`computeCorrelatedCounts`, `computeFetchedCounts`)
**Apply to:** `computeBridgingCoverage` — pure function, no storage I/O, unit-testable, memo-friendly.

### Fixed-literal regexes only (ReDoS, ASVS V5)
**Source:** `src/utils/entities.ts:172-194` (`escapeRegex`, `matchKeyword`), `src/services/collectors/news.ts:85-105` (`extractStockSymbols`)
**Apply to:** the new bare-caps stage — compile-time literal `/\b([A-Z]{2,6})\b/g` + set membership; never `new RegExp(feedData)`.

### Confidence ladder
**Source:** `src/utils/entities.ts:201-357` (cashtag 0.95, crypto 0.9, person 0.85, org 0.8, hashtag 0.6, topic 0.3)
**Apply to:** bare-caps ticker entities at 0.85 (A3); mirror in oracle fixtures.

## No Analog Found

None — every file in scope is a modification of existing code with a verified in-file or sibling analog. No new production files are created this phase.

## Metadata

**Analog search scope:** `src/utils/`, `src/services/engine/`, `src/services/collectors/`, `src/dashboard/components/`, `src/dashboard/App.tsx`, `tests/unit/`
**Files scanned:** 12 primary + grep sweeps across `tests/unit/**` and `src/dashboard/**`
**Pattern extraction date:** 2026-08-27