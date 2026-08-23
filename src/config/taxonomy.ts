/**
 * Single-source category taxonomy (Phase 5 — Market-Driven News).
 *
 * This module is the ONE place that defines the category taxonomy used by
 * the classifier, the aggregation module, and the dashboard. No keyword list
 * or precedence order is hardcoded anywhere else — everything imports from here.
 *
 * v1 = 3 categories (finance / politics / technology), reusing the labels from
 * `CONFIG.scrape.redditCategories`. Precedence is deterministic:
 * politics > finance > technology (D-04). First match wins.
 */

/** The three news categories in v1 (D-003). */
export type NewsCategory = 'finance' | 'politics' | 'technology';

/** A single category rule: its id, display label, and matching keywords. */
export interface CategoryRule {
  id: NewsCategory;
  /** Display label — reuses the `redditCategories` label text. */
  label: string;
  /** Lowercase keyword/entity list used for substring matching. */
  keywords: string[];
}

/**
 * Deterministic precedence order (D-004): politics > finance > technology.
 * `classifyCategory` iterates this order and returns the first match.
 */
export const CATEGORY_ORDER: NewsCategory[] = ['politics', 'finance', 'technology'];

/** Keyword/entity rules per category. First match in CATEGORY_ORDER wins. */
export const CATEGORY_RULES: Record<NewsCategory, CategoryRule> = {
  politics: {
    id: 'politics',
    label: '🏛️ Politics',
    keywords: [
      'election',
      'senate',
      'congress',
      'president',
      'geopolitics',
      'war',
      'tariff',
      'government',
      'vote',
      'campaign',
      'legislation',
      'diplomat',
      'sanction',
      'foreign policy',
    ],
  },
  finance: {
    id: 'finance',
    label: '💰 Finance & Stock Market',
    keywords: [
      'stock',
      'fed',
      'rate',
      'earnings',
      'inflation',
      'bitcoin',
      'market',
      'crypto',
      'bond',
      'recession',
      'gdp',
      'dow',
      'nasdaq',
      's&p',
      'oil price',
      'interest rate',
    ],
  },
  technology: {
    id: 'technology',
    label: '💻 Technology',
    keywords: [
      'ai',
      'chip',
      'semiconductor',
      'software',
      'startup',
      'tech',
      'nvidia',
      'apple',
      'google',
      'microsoft',
      'openai',
      'data center',
      'cloud',
      'cyber',
    ],
  },
};

/** Version constant — bump when rules change so future code can re-classify. */
export const TAXONOMY_VERSION = 1;

/**
 * Classify a headline into exactly one category via deterministic precedence.
 * Lowercases the headline, iterates CATEGORY_ORDER, returns the first category
 * whose keywords match. Falls back to 'finance' (the app's focus) when nothing
 * matches.
 */
export function classifyCategory(headline: string): NewsCategory {
  const text = headline.toLowerCase();
  for (const category of CATEGORY_ORDER) {
    const rule = CATEGORY_RULES[category];
    if (rule.keywords.some((kw) => text.includes(kw))) {
      return category;
    }
  }
  return 'finance';
}
