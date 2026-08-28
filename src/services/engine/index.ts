/**
 * Shared inverted keyword index for the correlation engine.
 *
 * Replaces the O(n×m) nested-loop candidate scan with O(n×k) candidate
 * filtering: the index maps each keyword to the contract indices that carry
 * it, so a signal/news keyword set resolves to a deduplicated, order-preserving
 * superset of the contracts the naive loop would visit.
 *
 * Phase 3 (PERF-02): this is the enabler every engine (heuristic + ML) consumes
 * in later plans. It is dependency-free and built from the already-extracted
 * `keywords` arrays — the single tokenization source shared with the matcher
 * (never re-tokenize with a different function, anti-drift guard).
 */

import { extractEntityKeywords } from '@/utils/entities';

/** An item the index can be built from. */
export interface Indexable {
  id: string;
  keywords: string[];
  question?: string;
  text?: string;
}

/** Options for building an index. */
export interface InvertedIndexOptions {
  /** When true, also index entity-derived keywords from `question`/`text`. */
  includeEntityKeywords?: boolean;
}

/** Cap on distinct keywords indexed (T-3-02: bound index memory). */
const MAX_DISTINCT_KEYWORDS = 10_000;

/**
 * A hand-rolled `Map<keyword, number[]>` inverted index.
 *
 * Maps each keyword to the contract indices that carry it. `candidates()`
 * unions the postings lists for a signal/news keyword set, deduplicated and in
 * contract order — a superset of the naive-loop matches for keyword-overlap
 * engines.
 */
export class InvertedIndex {
  /** Inputs with fewer items than this skip the index and use the naive loop. */
  static readonly TINY_INPUT_THRESHOLD = 2;

  private readonly map = new Map<string, number[]>();

  /**
   * Build an index from items' pre-extracted keywords.
   *
   * Iterates items in order; for each item collects its token set (always
   * `item.keywords`, plus entity-derived keywords when `opts.includeEntityKeywords`
   * is set), deduplicates per item, and posts the item index into each keyword's
   * postings list. Contract order is preserved so `candidates()` returns indices
   * in the same order the naive loop would visit them.
   */
  /**
   * Build an index from items' pre-extracted keywords.
   *
   * Iterates items in order; for each item collects its token set (always
   * `item.keywords`, plus entity-derived keywords when `opts.includeEntityKeywords`
   * is set), deduplicates per item, and posts the item index into each keyword's
   * postings list. Contract order is preserved so `candidates()` returns indices
   * in the same order the naive loop would visit them.
   */
  static build(items: Indexable[], opts: InvertedIndexOptions = {}): InvertedIndex {
    const idx = new InvertedIndex();
    for (let i = 0; i < items.length; i++) {
      const tokens = InvertedIndex.collectTokens(items[i], opts);
      for (const k of tokens) {
        // T-3-02: cap the distinct keyword cardinality to bound index memory.
        if (!idx.map.has(k) && idx.map.size >= MAX_DISTINCT_KEYWORDS) continue;
        const list = idx.map.get(k);
        if (list) list.push(i);
        else idx.map.set(k, [i]);
      }
    }
    return idx;
  }

  /** Collect the deduplicated token set for a single item. */
  private static collectTokens(
    item: Indexable,
    opts: InvertedIndexOptions,
  ): Set<string> {
    const tokens = new Set<string>(item.keywords);
    if (opts.includeEntityKeywords) {
      const entityTokens = extractEntityKeywords(item.question ?? item.text ?? '');
      for (const t of entityTokens) tokens.add(t);
    }
    return tokens;
  }

  /** Candidate contract indices for a keyword set (deduped, contract order). */
  candidates(keywords: string[]): number[] {
    if (keywords.length === 0) return [];
    const seen = new Set<number>();
    for (const k of keywords) {
      const list = this.map.get(k);
      if (list) for (const i of list) seen.add(i);
    }
    // Contract order (ascending index) — the order the naive loop visits
    // items. Postings are unioned in keyword-iteration order, so sort to
    // honor the documented invariant (ties in downstream confidence scoring
    // otherwise break differently on the two engine paths).
    return [...seen].sort((a, b) => a - b);
  }

  /** Whether a keyword is indexed. */
  has(keyword: string): boolean {
    return this.map.has(keyword);
  }

  /** Number of distinct keywords indexed. */
  get size(): number {
    return this.map.size;
  }
}

/** FNV-1a 32-bit hash over a string, returned as a base-36 string. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.codePointAt(i) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Module-level incremental cache keyed by data version. */
const indexCache = new Map<string, InvertedIndex>();

/**
 * Return a cached index for a contract set, rebuilding only when the data
 * version (contract IDs + keyword content + build options) changes.
 *
 * The version hash is an FNV-1a hash over each contract's ID and its keyword
 * content plus the `includeEntityKeywords` flag. Including the keyword content
 * is essential: `mergeMarkets` can overwrite a contract's `keywords` while
 * keeping the same `id` (e.g. a question is re-extracted), so an ID-only key
 * would return a stale index and silently drop matches the naive loop produces
 * (PERF-02 equivalence). An unchanged set reuses the cached index; any change
 * to IDs, keywords, or build options rebuilds it.
 */
export function getIncrementalIndex(
  items: Indexable[],
  options?: InvertedIndexOptions,
): InvertedIndex {
  const version = fnv1a(
    items
      .map((i) => i.id + '\u0000' + i.keywords.join(','))
      .join('\u0000') +
      '\u0000' +
      (options?.includeEntityKeywords ? '1' : '0'),
  );
  const cached = indexCache.get(version);
  if (cached) return cached;
  const built = InvertedIndex.build(items, options);
  indexCache.set(version, built);
  return built;
}

/** Alias for the incremental cache helper (plan action text). */
export const getInvertedIndex = getIncrementalIndex;
