/**
 * Lightweight keyword extraction utility.
 *
 * Extracts hashtags (#foo), cashtags ($BTC), and plain keywords from text.
 * Used by both content scripts (social scraping) and the correlation engine.
 */

/** Common English stop words to filter out. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can',
  'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it',
  'we', 'they', 'what', 'which', 'who', 'when', 'where', 'why', 'how',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
  'than', 'too', 'very', 'just', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'about', 'against', 'between', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'from', 'up', 'down', 'out',
  'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here',
  'there', 'if', 'as', 'by', 'its', 'it', 'my', 'your', 'his', 'her',
]);

export function extractKeywords(text: string): string[] {
  const keywords = new Set<string>();

  // Extract hashtags: #word
  const hashtags = text.match(/#[\w]+/g) ?? [];
  hashtags.forEach((tag) => keywords.add(tag.slice(1).toLowerCase()));

  // Extract cashtags: $TICKER
  const cashtags = text.match(/\$[A-Z]{2,}/g) ?? [];
  cashtags.forEach((tag) => keywords.add(tag.toLowerCase()));

  // Extract plain words (3+ chars, not stop words)
  const words = text.match(/[a-zA-Z]{3,}/g) ?? [];
  words.forEach((word) => {
    const lower = word.toLowerCase();
    if (!STOP_WORDS.has(lower)) {
      keywords.add(lower);
    }
  });

  return Array.from(keywords);
}

/**
 * Calculate Jaccard similarity between two keyword sets.
 * Returns 0–1 score.
 */
export function keywordSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a.map((k) => k.toLowerCase()));
  const setB = new Set(b.map((k) => k.toLowerCase()));
  const intersection = new Set([...setA].filter((k) => setB.has(k)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}