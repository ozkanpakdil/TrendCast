/**
 * Lightweight Named Entity Recognition (NER) — no external library.
 *
 * Extracts entities from text using pattern matching:
 *   - Cashtags ($TICKER) → financial entities
 *   - Hashtags (#topic) → topic entities
 *   - Capitalized multi-word phrases → proper noun entities (persons, orgs, places)
 *   - Known tickers / political figures / organizations → curated entity lookups
 *
 * Entities are used by the correlation engine to match social signals
 * and news headlines to market contracts with higher precision than
 * simple keyword overlap.
 */

// ── Entity Types ──────────────────────────────────────────────────

export type EntityType =
  | 'ticker'      // $AAPL, $TSLA, $BTC
  | 'hashtag'     // #Election2024, #Bitcoin
  | 'person'      // Joe Biden, Donald Trump, Elon Musk
  | 'organization' // Apple, Tesla, OpenAI, SEC
  | 'location'    // USA, Ukraine, China, Gaza
  | 'event'       // Election, Super Bowl, Olympics
  | 'crypto'      // Bitcoin, Ethereum, Dogecoin
  | 'topic';      // General topic / keyword

export interface Entity {
  /** The entity text as it appears (original casing). */
  text: string;
  /** Lowercased normalized form for matching. */
  normalized: string;
  type: EntityType;
  /** Confidence weight [0–1] — higher = more certain. */
  confidence: number;
}

// ── Curated Knowledge Base ────────────────────────────────────────

const KNOWN_TICKERS = new Set([
  'aapl', 'msft', 'googl', 'goog', 'amzn', 'nvda', 'meta', 'tsla',
  'nflx', 'amd', 'intc', 'baba', 'jpm', 'v', 'wmt', 'dis', 'nke',
  'pypl', 'sq', 'shop', 'coin', 'hood', 'sofi', 'pltr', 'mstr',
  'btc', 'eth', 'sol', 'ada', 'doge', 'xrp', 'dot', 'matic', 'link',
  'uni', 'atom', 'ltc', 'bch', 'avax', 'shib', 'pepe', 'wif',
  'spx', 'qqq', 'spy', 'iwm', 'dia', 'vix',
]);

const KNOWN_PERSONS = new Map<string, string[]>([
  // normalized name → aliases
  ['trump', ['donald trump', 'trump', 'donald j trump', 'djt']],
  ['biden', ['joe biden', 'biden', 'joe r biden']],
  ['harris', ['kamala harris', 'harris', 'kamala']],
  ['obama', ['barack obama', 'obama']],
  ['musk', ['elon musk', 'musk', 'elon']],
  ['bezos', ['jeff bezos', 'bezos']],
  ['zuckerberg', ['mark zuckerberg', 'zuckerberg', 'zuck']],
  ['buffett', ['warren buffett', 'buffett', 'warren']],
  ['powell', ['jerome powell', 'powell', 'jay powell']],
  ['yellen', ['janet yellen', 'yellen']],
  ['putin', ['vladimir putin', 'putin']],
  ['zelensky', ['volodymyr zelensky', 'zelensky', 'zelenskyy']],
  ['netanyahu', ['benjamin netanyahu', 'netanyahu', 'bibi']],
  ['xi jinping', ['xi jinping', 'xi', 'jinping']],
  ['macron', ['emmanuel macron', 'macron']],
  ['desantis', ['ron desantis', 'desantis']],
  ['newsom', ['gavin newsom', 'newsom']],
  ['aoc', ['alexandria ocasio-cortez', 'aoc', 'ocasio-cortez']],
  ['sanders', ['bernie sanders', 'bernie', 'sanders']],
  ['gates', ['bill gates', 'gates']],
  ['sbf', ['sam bankman-fried', 'sbf', 'bankman-fried']],
  ['altman', ['sam altman', 'altman']],
  ['pichai', ['sundar pichai', 'pichai']],
  ['cook', ['tim cook', 'cook']],
  ['deSantis', ['ron desantis', 'desantis']],
]);

const KNOWN_ORGS = new Map<string, string[]>([
  ['apple', ['apple', 'apple inc']],
  ['microsoft', ['microsoft', 'msft', 'microsoft corp']],
  ['google', ['google', 'alphabet', 'googl', 'gcp']],
  ['amazon', ['amazon', 'amzn']],
  ['meta', ['meta', 'facebook', 'fb']],
  ['tesla', ['tesla', 'tsla']],
  ['nvidia', ['nvidia', 'nvda']],
  ['openai', ['openai', 'open ai']],
  ['sec', ['sec', 'securities and exchange commission']],
  ['fed', ['the fed', 'federal reserve', 'fed', 'fomc']],
  ['congress', ['congress', 'us congress', 'house', 'senate']],
  ['doj', ['doj', 'department of justice']],
  ['ftc', ['ftc', 'federal trade commission']],
  ['eu', ['eu', 'european union']],
  ['nato', ['nato']],
  ['un', ['un', 'united nations']],
  ['who', ['who', 'world health organization']],
  ['fifa', ['fifa']],
  ['nfl', ['nfl']],
  ['nba', ['nba']],
  ['ufc', ['ufc']],
]);

const KNOWN_LOCATIONS = new Set([
  'usa', 'us', 'u.s.', 'u.s.a.', 'america', 'united states',
  'uk', 'u.k.', 'britain', 'england', 'scotland', 'wales',
  'europe', 'eu', 'asia', 'africa', 'middle east',
  'china', 'russia', 'ukraine', 'israel', 'gaza', 'palestine',
  'iran', 'iraq', 'afghanistan', 'syria', 'lebanon', 'yemen',
  'taiwan', 'japan', 'south korea', 'north korea', 'korea',
  'india', 'pakistan', 'australia', 'canada', 'mexico',
  'brazil', 'argentina', 'venezuela', 'cuba', 'haiti',
  'germany', 'france', 'italy', 'spain', 'poland', 'sweden',
  'new york', 'california', 'texas', 'florida', 'washington',
  'wall street', 'silicon valley', 'hollywood',
]);

const KNOWN_CRYPTO = new Map<string, string[]>([
  ['bitcoin', ['bitcoin', 'btc', '$btc']],
  ['ethereum', ['ethereum', 'eth', '$eth', 'ether']],
  ['solana', ['solana', 'sol', '$sol']],
  ['cardano', ['cardano', 'ada', '$ada']],
  ['dogecoin', ['dogecoin', 'doge', '$doge']],
  ['xrp', ['xrp', 'ripple', '$xrp']],
  ['polkadot', ['polkadot', 'dot', '$dot']],
  ['polygon', ['polygon', 'matic', '$matic']],
  ['chainlink', ['chainlink', 'link', '$link']],
  ['uniswap', ['uniswap', 'uni', '$uni']],
  ['avalanche', ['avalanche', 'avax', '$avax']],
  ['litecoin', ['litecoin', 'ltc', '$ltc']],
  ['shiba inu', ['shiba inu', 'shib', '$shib']],
  ['pepe', ['pepe', '$pepe']],
  ['dogwifhat', ['dogwifhat', 'wif', '$wif']],
]);

const KNOWN_EVENTS = new Set([
  'election', 'elections', 'primary', 'primaries', 'caucus',
  'inauguration', 'impeachment', 'debate', 'debates',
  'super bowl', 'superbowl', 'olympics', 'world cup',
  'world series', 'nba finals', 'stanley cup',
  'g7', 'g20', 'cop', 'summit', 'nato summit',
  'rate decision', 'fed meeting', 'fomc', 'earnings',
  'earnings report', 'ipo', 'spac', 'merger', 'acquisition',
  'shutdown', 'default', 'recession', 'crash', 'rally',
  'halving', 'bull run', 'bear market', 'correction',
]);

// ── Stop words (don't treat as entities even if capitalized) ──────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to',
  'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are',
  'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do',
  'does', 'did', 'will', 'would', 'could', 'should', 'may',
  'might', 'must', 'can', 'this', 'that', 'these', 'those',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him',
  'her', 'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their',
  'what', 'which', 'who', 'when', 'where', 'why', 'how',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same',
  'so', 'than', 'too', 'very', 'just', 'now', 'here', 'there',
  'about', 'after', 'before', 'between', 'through', 'during',
  'above', 'below', 'up', 'down', 'out', 'off', 'over', 'under',
  'again', 'further', 'then', 'once', 'said', 'says', 'say',
  'one', 'two', 'three', 'first', 'second', 'new', 'old',
  'via', 'per', 'amid', 'despite', 'though', 'although',
  'if', 'unless', 'since', 'because', 'while', 'also',
]);

// ── Entity Extraction ─────────────────────────────────────────────

/**
 * Escape a string for safe use inside a RegExp.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Match a keyword in text using word boundaries.
 *
 * Short keywords (≤4 chars) are always matched with word boundaries to
 * avoid false positives (e.g., "us" matching inside "just", "uk" inside
 * "duke"). Longer keywords can safely use substring matching since they
 * are unlikely to appear as substrings of unrelated words.
 */
function matchKeyword(text: string, keyword: string): boolean {
  if (keyword.length <= 4) {
    return new RegExp(`\\b${escapeRegex(keyword)}\\b`, 'i').test(text);
  }
  return text.includes(keyword);
}

/**
 * Extract entities from a text string.
 *
 * @param text - The text to extract entities from.
 * @returns Array of unique entities, sorted by confidence (descending).
 */
export function extractEntities(text: string): Entity[] {
  const entities: Entity[] = [];
  const seen = new Set<string>(); // deduplicate by normalized form

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

  // 2. Hashtags: #topic
  const hashtagMatches = text.matchAll(/#([A-Za-z][A-Za-z0-9_]*)/g);
  for (const match of hashtagMatches) {
    const normalized = match[1].toLowerCase();
    if (!seen.has(normalized) && normalized.length > 1) {
      seen.add(normalized);
      entities.push({
        text: match[0],
        normalized,
        type: 'hashtag',
        confidence: 0.6,
      });
    }
  }

  // 3. Known entities (persons, orgs, crypto, events, locations)
  const lowerText = text.toLowerCase();

  // Persons
  for (const [canonical, aliases] of KNOWN_PERSONS) {
    for (const alias of aliases) {
      if (matchKeyword(lowerText, alias) && !seen.has(canonical)) {
        seen.add(canonical);
        entities.push({
          text: alias,
          normalized: canonical,
          type: 'person',
          confidence: 0.85,
        });
        break;
      }
    }
  }

  // Organizations
  for (const [canonical, aliases] of KNOWN_ORGS) {
    for (const alias of aliases) {
      if (matchKeyword(lowerText, alias) && !seen.has(canonical)) {
        seen.add(canonical);
        entities.push({
          text: alias,
          normalized: canonical,
          type: 'organization',
          confidence: 0.8,
        });
        break;
      }
    }
  }

  // Crypto
  for (const [canonical, aliases] of KNOWN_CRYPTO) {
    for (const alias of aliases) {
      if (matchKeyword(lowerText, alias) && !seen.has(canonical)) {
        seen.add(canonical);
        entities.push({
          text: alias,
          normalized: canonical,
          type: 'crypto',
          confidence: 0.9,
        });
        break;
      }
    }
  }

  // Events
  for (const event of KNOWN_EVENTS) {
    if (matchKeyword(lowerText, event) && !seen.has(event)) {
      seen.add(event);
      entities.push({
        text: event,
        normalized: event,
        type: 'event',
        confidence: 0.65,
      });
    }
  }

  // Locations
  for (const location of KNOWN_LOCATIONS) {
    if (matchKeyword(lowerText, location) && !seen.has(location)) {
      seen.add(location);
      entities.push({
        text: location,
        normalized: location,
        type: 'location',
        confidence: 0.7,
      });
    }
  }

  // 4. Capitalized multi-word phrases (proper nouns)
  // Match sequences of 2+ capitalized words: "Joe Biden", "Federal Reserve"
  const properNounMatches = text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g);
  for (const match of properNounMatches) {
    const phrase = match[1];
    const normalized = phrase.toLowerCase();
    if (!seen.has(normalized) && !STOP_WORDS.has(normalized)) {
      // Check if all words are non-stop-words
      const words = normalized.split(' ');
      const hasStopWord = words.some((w) => STOP_WORDS.has(w));
      if (!hasStopWord && words.length >= 2) {
        seen.add(normalized);
        entities.push({
          text: phrase,
          normalized,
          type: 'person',
          confidence: 0.5,
        });
      }
    }
  }

  // 5. Single capitalized words (potential proper nouns)
  const singleCapMatches = text.matchAll(/\b([A-Z][a-z]{2,})\b/g);
  for (const match of singleCapMatches) {
    const word = match[1];
    const normalized = word.toLowerCase();
    if (!seen.has(normalized) && !STOP_WORDS.has(normalized)) {
      // Only add if it's not at the start of a sentence (heuristic)
      const index = match.index ?? 0;
      const before = text.slice(Math.max(0, index - 2), index);
      if (!before.match(/[.!?]\s$/) && index > 0) {
        seen.add(normalized);
        entities.push({
          text: word,
          normalized,
          type: 'topic',
          confidence: 0.3,
        });
      }
    }
  }

  // Sort by confidence (descending), then by type
  entities.sort((a, b) => b.confidence - a.confidence);
  return entities;
}

/**
 * Extract just the normalized entity strings (for quick matching).
 */
export function extractEntityKeywords(text: string): string[] {
  return extractEntities(text).map((e) => e.normalized);
}

/**
 * Compute entity-based similarity between two texts.
 * Uses Jaccard similarity on the entity sets, weighted by entity confidence.
 *
 * @returns Similarity score in [0, 1].
 */
export function entitySimilarity(textA: string, textB: string): number {
  const entitiesA = extractEntities(textA);
  const entitiesB = extractEntities(textB);

  if (entitiesA.length === 0 || entitiesB.length === 0) return 0;

  const mapA = new Map(entitiesA.map((e) => [e.normalized, e.confidence]));
  const mapB = new Map(entitiesB.map((e) => [e.normalized, e.confidence]));

  // Weighted Jaccard: sum of min weights for intersection / sum of max weights for union
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