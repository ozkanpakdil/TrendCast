/**
 * Lexicon-based sentiment analysis — no external NLP library needed.
 *
 * Uses a curated positive/negative word lexicon plus basic negation
 * handling ("not good", "never great") and intensity modifiers
 * ("very bad", "extremely bullish").
 *
 * Returns a sentiment score in [-1, +1] where:
 *   -1 = very negative
 *    0 = neutral
 *   +1 = very positive
 */

// ── Lexicons ──────────────────────────────────────────────────────

const POSITIVE_WORDS = new Set([
  // General positive
  'good', 'great', 'excellent', 'amazing', 'awesome', 'fantastic',
  'wonderful', 'best', 'love', 'loved', 'loving', 'like', 'liked',
  'happy', 'glad', 'pleased', 'excited', 'thrilled', 'delighted',
  'perfect', 'brilliant', 'superb', 'outstanding', 'remarkable',
  'incredible', 'fabulous', 'marvelous', 'splendid', 'phenomenal',
  'positive', 'win', 'winning', 'won', 'wins', 'victory', 'success',
  'successful', 'succeed', 'succeeded', 'triumph', 'gain', 'gained',
  'gains', 'profit', 'profitable', 'bullish', 'surge', 'surged',
  'soar', 'soared', 'soaring', 'rally', 'rallied', 'boom', 'booming',
  'growth', 'growing', 'grow', 'grew', 'strong', 'stronger', 'robust',
  'optimistic', 'hopeful', 'confident', 'bull', 'mooning', 'pump',
  'pumped', 'pumping', 'breakthrough', 'improve', 'improved', 'improving',
  'improvement', 'boost', 'boosted', 'up', 'rise', 'rose', 'risen',
  'rising', 'upgrade', 'upgraded', 'beat', 'beats', 'beaten', 'exceed',
  'exceeded', 'exceeds', 'surpass', 'surpassed', 'outperform', 'outperformed',
  'support', 'supported', 'supports', 'endorse', 'endorsed', 'approve',
  'approved', 'praise', 'praised', 'recommend', 'recommended', 'magnificent',
  'generous', 'kind', 'brave', 'heroic', 'noble', 'honest', 'genuine',
  'authentic', 'innovative', 'revolutionary', 'disruptive', 'game-changer',
  'undervalued', 'cheap', 'bargain', 'opportunity', 'promising', 'bright',
  'shining', 'glorious', 'blessed', 'lucky', 'fortunate', 'grateful',
  'thankful', 'proud', 'inspired', 'motivated', 'empowered', 'fearless',
  'unstoppable', 'dominant', 'leading', 'champion', 'legendary', 'epic',
  'massive', 'huge', 'enormous', 'tremendous', 'colossal', 'victorious',
  'hyped', 'hype', 'viral', 'trending', 'fire', 'lit', 'based', 'w',
  'stonks', 'diamond', 'hands', 'tendies', 'rocket', '🚀', 'moon',
  'lfg', 'letsgo', 'gm', 'wagmi', 'bullish', 'long', 'accumulate',
  'buy', 'bought', 'holding', 'hodl', 'hodling', 'strongbuy',
]);

const NEGATIVE_WORDS = new Set([
  // General negative
  'bad', 'terrible', 'awful', 'horrible', 'worst', 'hate', 'hated',
  'sad', 'angry', 'furious', 'disappointed', 'disappointing', 'disappoint',
  'disgusting', 'disgust', 'disgusted', 'pathetic', 'useless', 'worthless',
  'fail', 'failed', 'failing', 'failure', 'loser', 'lose', 'lost', 'losing',
  'loss', 'losses', 'defeat', 'defeated', 'crash', 'crashed', 'crashing',
  'plunge', 'plunged', 'plunging', 'tank', 'tanked', 'tanking', 'dump',
  'dumped', 'dumping', 'bearish', 'bear', 'decline', 'declined', 'declining',
  'fall', 'fell', 'fallen', 'falling', 'drop', 'dropped', 'dropping',
  'weak', 'weaker', 'weakest', 'fragile', 'vulnerable', 'exposed', 'risk',
  'risky', 'danger', 'dangerous', 'threat', 'threatened', 'threatening',
  'fear', 'fearful', 'afraid', 'scared', 'terrified', 'panicked', 'panic',
  'worried', 'worried', 'anxious', 'concerned', 'concerning', 'troubling',
  'troubled', 'disturbing', 'disturbed', 'alarming', 'alarmed', 'dire',
  'grim', 'bleak', 'gloomy', 'dismal', 'depressing', 'depressed', 'hopeless',
  'desperate', 'despair', 'agony', 'suffering', 'suffer', 'suffered',
  'painful', 'pain', 'hurt', 'hurt', 'damaged', 'damage', 'destroyed',
  'destroy', 'destruction', 'ruin', 'ruined', 'collapse', 'collapsed',
  'collapsing', 'bankrupt', 'bankruptcy', 'insolvent', 'default', 'defaulted',
  'fraud', 'fraudulent', 'scam', 'scammed', 'scammer', 'corrupt', 'corruption',
  'scandal', 'scandalous', 'controversy', 'controversial', 'criticism',
  'criticized', 'criticize', 'condemn', 'condemned', 'reject', 'rejected',
  'oppose', 'opposed', 'opposing', 'against', 'attack', 'attacked',
  'assault', 'assaulted', 'violence', 'violent', 'war', 'conflict',
  'crisis', 'disaster', 'catastrophe', 'catastrophic', 'tragedy', 'tragic',
  'dead', 'death', 'died', 'killed', 'fatal', 'lethal', 'sick', 'illness',
  'disease', 'outbreak', 'epidemic', 'pandemic', 'inflation', 'recession',
  'depression', 'stagnation', 'stagnant', 'slump', 'slumped', 'downturn',
  'meltdown', 'bloodbath', 'massacre', 'carnage', 'capitulation', 'sell',
  'sell', 'selling', 'sold', 'short', 'shorting', 'put', 'bear', 'ngmi',
  'rekt', 'wrecked', 'liquidated', 'liquidation', 'margin', 'call', 'bagholder',
  'fud', 'fake', 'false', 'lie', 'lied', 'lying', 'deception', 'deceive',
  'deceived', 'manipulation', 'manipulated', 'rigged', 'hacked', 'breach',
  'breached', 'leak', 'leaked', 'exposed', 'vulnerable', 'compromised',
]);

// Intensity modifiers boost the next word's weight
const INTENSIFIERS = new Set([
  'very', 'extremely', 'incredibly', 'remarkably', 'exceptionally',
  'particularly', 'especially', 'highly', 'deeply', 'profoundly',
  'absolutely', 'utterly', 'completely', 'totally', 'entirely',
  'so', 'really', 'quite', 'truly', 'genuinely', 'literally',
]);

// Diminishers reduce the next word's weight
const DIMINISHERS = new Set([
  'slightly', 'somewhat', 'kinda', 'kind of', 'sort of', 'barely',
  'hardly', 'scarcely', 'marginally', 'moderately', 'fairly', 'rather',
]);

// Negation words flip the sentiment of the following word(s)
const NEGATIONS = new Set([
  'not', 'no', 'never', 'none', "n't", 'cannot', "can't", "won't",
  "don't", "doesn't", "didn't", "isn't", "wasn't", "aren't", "weren't",
  "shouldn't", "wouldn't", "couldn't", "hadn't", "hasn't", "haven't",
  'neither', 'nor', 'without', 'lacks', 'lacking', 'lacked',
]);

// ── Tokenizer ─────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length > 0);
}

// ── Sentiment Analysis ────────────────────────────────────────────

export interface SentimentResult {
  /** Overall sentiment score in [-1, +1]. */
  score: number;
  /** Number of positive tokens found. */
  positiveCount: number;
  /** Number of negative tokens found. */
  negativeCount: number;
  /** Total sentiment-bearing tokens. */
  totalTokens: number;
  /** The dominant sentiment label. */
  label: 'positive' | 'negative' | 'neutral';
}

/**
 * Analyze the sentiment of a text string using a lexicon-based approach
 * with negation and intensity handling.
 *
 * @param text - The text to analyze.
 * @returns A SentimentResult with score in [-1, +1].
 */
export function analyzeSentiment(text: string): SentimentResult {
  const tokens = tokenize(text);
  let score = 0;
  let positiveCount = 0;
  let negativeCount = 0;
  let totalTokens = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    let weight = 1.0;

    // Check for negation in the previous 1-2 tokens
    let negated = false;
    for (let j = Math.max(0, i - 2); j < i; j++) {
      if (NEGATIONS.has(tokens[j])) {
        negated = true;
        break;
      }
    }

    // Check for intensifier/diminisher in the previous token
    if (i > 0) {
      if (INTENSIFIERS.has(tokens[i - 1])) {
        weight = 1.5;
      } else if (DIMINISHERS.has(tokens[i - 1])) {
        weight = 0.5;
      }
    }

    if (POSITIVE_WORDS.has(token)) {
      totalTokens++;
      if (negated) {
        score -= weight * 0.5;
        negativeCount++;
      } else {
        score += weight;
        positiveCount++;
      }
    } else if (NEGATIVE_WORDS.has(token)) {
      totalTokens++;
      if (negated) {
        score += weight * 0.5;
        positiveCount++;
      } else {
        score -= weight;
        negativeCount++;
      }
    }
  }

  // Normalize to [-1, +1] using a soft tanh-like squashing
  const normalized = totalTokens > 0 ? Math.tanh(score / Math.sqrt(totalTokens)) : 0;

  let label: SentimentResult['label'] = 'neutral';
  if (normalized > 0.15) label = 'positive';
  else if (normalized < -0.15) label = 'negative';

  return {
    score: Math.max(-1, Math.min(1, normalized)),
    positiveCount,
    negativeCount,
    totalTokens,
    label,
  };
}

/**
 * Quick helper: just get the score in [-1, +1].
 */
export function sentimentScore(text: string): number {
  return analyzeSentiment(text).score;
}