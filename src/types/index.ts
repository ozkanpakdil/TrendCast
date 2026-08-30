/**
 * Core domain types for TrendCast.
 *
 * ── Architecture Shift ────────────────────────────────────────────
 * TrendCast is 100% client-side. No external API calls with API keys.
 * The extension scrapes data using the user's own browser sessions:
 *   - Content scripts read the DOM when the user visits supported sites.
 *   - The background worker opens background tabs hourly to collect
 *     data from sites the user hasn't visited recently.
 *   - All collected data is stored in chrome.storage.local.
 *   - The new tab dashboard renders the aggregated, correlated view.
 *
 * These types are shared across the background worker, content scripts,
 * new tab dashboard, popup, and the correlation engine.
 */

// ── Prediction Markets ────────────────────────────────────────────

import type { NewsCategory } from '@/config/taxonomy';

/** Supported prediction market platforms. */
export type MarketPlatform = 'polymarket' | 'kalshi';

/** A single prediction market contract (normalised across platforms). */
export interface MarketContract {
  /** Platform-native identifier (e.g., Polymarket conditionId, Kalshi ticker). */
  id: string;
  platform: MarketPlatform;
  /** Human-readable question, e.g. "Will BTC close above $100k on Dec 31?" */
  question: string;
  /** Yes/No outcome prices as probabilities (0–1). */
  outcomes: MarketOutcome[];
  /** ISO 8601 expiry. */
  endDate: string;
  /** Current 24h volume in USD. */
  volume24h?: number;
  /** Liquidity in USD. */
  liquidity?: number;
  /** Raw slug or URL for linking back. */
  slug?: string;
  /** Direct link to the market page on the platform. */
  url?: string;
  /** Keywords extracted from the question for correlation matching. */
  keywords: string[];
  /** Last-updated timestamp (epoch ms). */
  lastUpdated: number;
}

export interface MarketOutcome {
  label: string; // "Yes" | "No" | custom
  price: number; // 0–1
}

// ── Social Signals ────────────────────────────────────────────────

export type SocialPlatform = 'x' | 'reddit' | 'tiktok';

/** A normalised social signal post/trend. */
export interface SocialSignal {
  id: string;
  platform: SocialPlatform;
  /** The post text or trend keyword. */
  text: string;
  author: string;
  /** Engagement metrics. */
  metrics: {
    likes: number;
    shares: number;
    comments: number;
    views?: number;
  };
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Hashtags / cashtags / keywords extracted from text. */
  keywords: string[];
  /** Sentiment score -1 (bearish) to +1 (bullish). */
  sentiment: number;
  /** Virality score 0–100 (normalised across platforms). */
  virality: number;
  /** Direct link to the post/trend on the platform. */
  url?: string;
}

// ── News ──────────────────────────────────────────────────────────

/**
 * News sources that don't require login.
 * BBC and CNN headlines are scraped from their public RSS/feed pages.
 * The stock-indicator sources (usaStocksIndicator, stockScreener,
 * stockScreener2) are RSS feeds from the user's own indicator projects.
 */
export type NewsSource =
  | 'bbc'
  | 'cnn'
  | 'yahoo'
  | 'googleFinance'
  | 'seekingalpha'
  | 'investing'
  | 'usaStocksIndicator'
  | 'stockScreener'
  | 'stockScreener2';

/**
 * Per-source fetch outcome recorded at collection time.
 * Persisted inside `CollectionSnapshot` so it survives MV3 worker restarts.
 */
export interface SourceHealthEntry {
  /** Epoch ms when this source was last fetched. */
  lastFetchedAt: number;
  /** Number of items returned by the last successful fetch. */
  itemCount: number;
  /** Consecutive failed/empty fetches (accumulates across cycles). */
  consecutiveFailures: number;
  /** Last error message, if the last fetch rejected. */
  lastError?: string;
  /** True when the last fetch returned 304 Not Modified (no new content). */
  lastUnchanged?: boolean;
}

/**
 * Health map keyed by the typed `NewsSource` union.
 * Never index with an unvalidated string (ASVS V5 input validation).
 */
export type SourceHealth = Partial<Record<NewsSource, SourceHealthEntry>>;

/**
 * Health map keyed by `SocialPlatform`, stored alongside the news
 * `SourceHealth`. Kept separate so the `NewsSource`-keyed union is
 * untouched (Phase 7, D-02).
 */
export type SocialSourceHealth = Partial<Record<SocialPlatform, SourceHealthEntry>>;

/** A normalised news headline. */
export interface NewsItem {
  id: string;
  source: NewsSource;
  headline: string;
  summary?: string;
  url: string;
  /** ISO 8601 publish timestamp. */
  publishedAt: string;
  /** Keywords extracted from the headline + summary. */
  keywords: string[];
  /** Image URL if available. */
  imageUrl?: string;
  /**
   * Category assigned at collection time (Phase 5). Optional so existing
   * stored records without the field don't crash the typecheck or UI; old
   * records are backfilled on read via `classifyCategory(headline)`.
   */
  category?: NewsCategory;
}

// ── Correlation ──────────────────────────────────────────────────

/**
 * Correlation engine strategy.
 *
 * - `heuristic` — NER + keyword overlap (default, no external deps).
 * - `embedding`  — sentence embeddings + cosine similarity (local ML).
 * - `sentiment`  — transformer-based sentiment classification (local ML).
 *
 * The `embedding` and `sentiment` strategies use Transformers.js to run
 * ML models fully client-side. No API keys, no network calls to LLM APIs.
 * The user picks the model and strategy from the popup settings UI.
 */
export type CorrelationEngine = 'heuristic' | 'embedding' | 'sentiment' | 'ner' | 'llm';

/**
 * Available local ML models for the `embedding` strategy.
 * All run in-browser via Transformers.js (ONNX Runtime Web).
 */
export type EmbeddingModel =
  | 'Xenova/all-MiniLM-L6-v2'
  | 'Xenova/bge-small-en-v1.5'
  | 'Xenova/gte-small';

/**
 * Available local ML models for the `sentiment` strategy.
 * All run in-browser via Transformers.js (ONNX Runtime Web).
 */
export type SentimentModel =
  | 'Xenova/distilbert-base-uncased-finetuned-sst-2-english'
  | 'Xenova/twitter-roberta-base-sentiment-latest'
  | 'Xenova/finbert'
  | 'Xenova/bert-base-multilingual-uncased-sentiment';

/**
 * Available local ML models for the `ner` strategy (ML-based named entity recognition).
 * These transformer models replace the regex-based entity extraction in the
 * heuristic engine with proper token classification (PER, ORG, LOC, MISC).
 * All run in-browser via Transformers.js (ONNX Runtime Web).
 */
export type NERModel =
  | 'Xenova/bert-base-NER-uncased'
  | 'Xenova/bert-large-NER-uncased';

/**
 * Available local LLM models for the `llm` strategy (text-generation).
 * These are small instruction-tuned LLMs that run in-browser via
 * Transformers.js (ONNX Runtime Web). They generate a structured
 * correlation assessment by prompting the LLM with the signal/news
 * text and contract question, asking it to score the relationship.
 *
 * ⚠️ These models are larger than embedding/sentiment models and
 * require WebGPU for acceptable performance. On CPU-only (WASM)
 * they will work but be very slow.
 *
 * Models ≥1 GB were removed in v0.1.6: every one of them exhausts the
 * browser WASM heap during benchmarking and can never complete a run.
 */
export type LLMModel =
  | 'HuggingFaceTB/SmolLM2-135M-Instruct'
  | 'HuggingFaceTB/SmolLM2-360M-Instruct'
  | 'onnx-community/Qwen2.5-0.5B-Instruct-ONNX';

/** A matched correlation between a social signal and a market contract. */
export interface CorrelationMatch {
  contract: MarketContract;
  signal: SocialSignal;
  /** 0–1 confidence score for the keyword/entity match. */
  confidence: number;
  /** Which keywords matched. */
  matchedKeywords: string[];
  /** Timestamp of correlation (epoch ms). */
  correlatedAt: number;
}

/** A matched correlation between a news item and a market contract. */
export interface NewsCorrelationMatch {
  contract: MarketContract;
  news: NewsItem;
  confidence: number;
  matchedKeywords: string[];
  correlatedAt: number;
}

/** A matched correlation between a news item and a social signal. */
export interface NewsSocialCorrelationMatch {
  news: NewsItem;
  signal: SocialSignal;
  confidence: number;
  matchedKeywords: string[];
  correlatedAt: number;
}

/**
 * A matched correlation between two news items from different sources
 * (CORR-06). Same-source pairs are skipped by the engines so a screener
 * feed never self-matches; the canonical use case is a VCP screener item
 * bridging to a Seeking Alpha story about the same ticker.
 */
export interface NewsNewsCorrelationMatch {
  newsA: NewsItem;
  newsB: NewsItem;
  confidence: number;
  matchedKeywords: string[];
  correlatedAt: number;
}

/** All correlation results from the engine. */
export interface CorrelationResult {
  requestId?: string;
  matches: CorrelationMatch[];
  newsMatches: NewsCorrelationMatch[];
  newsSocialMatches: NewsSocialCorrelationMatch[];
  /** CORR-06: news↔news matches (cross-source only). */
  newsNewsMatches: NewsNewsCorrelationMatch[];
  /**
   * Engine that produced these results.
   * If the requested engine failed, this will be the fallback engine used
   * (or 'heuristic' if no results were produced) and `error` will be set.
   */
  engine?: CorrelationEngine;
  /**
   * Error message if the requested correlation engine failed.
   * When set, the UI should show an error banner telling the user the
   * ML engine didn't work and suggesting they try a different engine
   * or switch to the heuristic engine.
   */
  error?: string;
  /** Epoch ms when the result was persisted (Phase 16, TRIG-01). */
  computedAt?: number;
  /** Model ID used (empty/omitted for heuristic). */
  model?: string;
  /** Per-source input sizes captured at run time (Phase 16, TRIG-01). */
  inputCounts?: { markets: number; signals: number; news: number };
}

/**
 * Statistics from a single correlation run.
 * Persisted to storage so the user can compare models over time.
 */
export interface CorrelationRunStats {
  /** Epoch ms when the run completed. */
  timestamp: number;
  /** Engine that produced the results. */
  engine: CorrelationEngine;
  /** Model ID used (empty for heuristic). */
  model: string;
  /** Number of signal→market matches. */
  matchCount: number;
  /** Number of news→market matches. */
  newsMatchCount: number;
  /** Number of news→social matches. */
  newsSocialMatchCount: number;
  /** Number of news↔news (cross-source) matches. */
  newsNewsMatchCount: number;
  /** Average confidence across all matches (0–1). */
  avgConfidence: number;
  /** Highest confidence score (0–1). */
  maxConfidence: number;
  /** Standard deviation of confidence scores (0–1). */
  confidenceSpread: number;
  /** Wall-clock time to complete the run (ms). */
  elapsedMs: number;
  /** Number of signals evaluated. */
  signalCount: number;
  /** Number of market contracts evaluated. */
  contractCount: number;
  /** Number of news items evaluated. */
  newsCount: number;
}

// ── Collection ────────────────────────────────────────────────────

/**
 * A collected "snapshot" from all sources at a point in time.
 * The background worker stores these in chrome.storage.local and the
 * new tab dashboard reads them.
 */
export interface CollectionSnapshot {
  /** When this snapshot was collected (epoch ms). */
  collectedAt: number;
  markets: MarketContract[];
  signals: SocialSignal[];
  news: NewsItem[];
  /** Per-source fetch health, recorded at collection time. */
  sourceHealth: SourceHealth;
}

/** A compact market reference for history detail panels. */
export interface HistoryMarketRef {
  id: string;
  platform: MarketPlatform;
  question: string;
  /** Best Yes price (0–1) if available. */
  yesPrice?: number;
  volume24h?: number;
  url?: string;
}

/** A compact social signal reference for history detail panels. */
export interface HistorySignalRef {
  id: string;
  platform: SocialPlatform;
  text: string;
  author: string;
  virality: number;
  sentiment: number;
  url?: string;
}

/** A compact news reference for history detail panels. */
export interface HistoryNewsRef {
  id: string;
  source: NewsSource;
  headline: string;
  url: string;
  publishedAt: string;
}

/**
 * A compact historical snapshot for charting.
 * Stores aggregate counts + top items (with links) for the detail panel.
 */
export interface HistoryEntry {
  /** Epoch ms. */
  timestamp: number;
  /** Number of markets collected. */
  marketCount: number;
  /** Number of signals collected. */
  signalCount: number;
  /** Number of news items collected. */
  newsCount: number;
  /** Number of correlations found. */
  correlationCount: number;
  /** Top 5 signal virality scores at this point. */
  topVirality: number[];
  /** Average sentiment at this point (-1 to +1). */
  avgSentiment: number;
  /** All markets collected at this point (for detail panel, capped at 50). */
  topMarkets?: HistoryMarketRef[];
  /** All social signals collected at this point (for detail panel, capped at 50). */
  topSignals?: HistorySignalRef[];
  /** All news items collected at this point (for detail panel, capped at 50). */
  topNews?: HistoryNewsRef[];
}

// ── Watchlist ─────────────────────────────────────────────────────

/**
 * A user-created watchlist of market contracts to track.
 * Stored in chrome.storage.local.
 */
export interface WatchlistEntry {
  /** The market contract ID (platform-native). */
  contractId: string;
  platform: MarketPlatform;
  /** The question text (cached for display even if market expires). */
  question: string;
  /** When the user added this to the watchlist (epoch ms). */
  addedAt: number;
  /**
   * Schema version for backfill-on-read. Old records without this field are
   * backfilled to `WATCHLIST_VERSION` on read via `backfillWatchlist`.
   */
  version?: number;
}

// ── Alerts (Phase 4: correlation alerts) ─────────────────────────

/** Direction of a market-level correlation alert. */
export type AlertDirection = 'bullish' | 'bearish' | 'mixed';

/**
 * Discriminator for the two alert kinds (Phase 10, D-04).
 *
 * - `watchlist`  — a watchlisted market shows a new or changed correlation.
 * - `crossSource` — a topic gains consensus across >=3 distinct source types
 *   (mixing social + news), even with an empty watchlist.
 */
export type AlertKind = 'watchlist' | 'crossSource';

/**
 * A single correlation alert record.
 * Persisted to `alertHistory` (capped at ~100) and shown in the
 * dashboard Alerts tab / notification body.
 */
export interface AlertRecord {
  /** Stable unique id (e.g. `${contractId}:${alertedAt}`). */
  id: string;
  /** Discriminator for watchlist vs cross-source alerts (D-04). */
  kind: AlertKind;
  /** The watchlisted market contract ID (watchlist alerts only). */
  contractId?: string;
  platform?: MarketPlatform;
  /** The market question text (cached for display; watchlist alerts only). */
  question?: string;
  /** Humanized topic label for cross-source alerts (D-05). */
  topicLabel?: string;
  /** Distinct source types that reached consensus (D-05). */
  sourceTypes?: string[];
  /** Market-level direction derived from sentiment + Yes-price delta. */
  direction: AlertDirection;
  /** Aggregate sentiment (-1..1) at alert time. */
  sentiment: number;
  /** Best Yes price (0–1) at alert time. */
  yesPrice: number;
  /** Text of the top correlated signal (if any). */
  topSignalText?: string;
  /** Direct link to the top correlated social post (if any). */
  topSignalUrl?: string;
  /** Headline of the top correlated news item (if any). */
  topNewsHeadline?: string;
  /** Direct link to the top correlated news item (if any). */
  topNewsUrl?: string;
  /** Confidence of the top correlated match (0–1). */
  confidence: number;
  /** Epoch ms when the alert fired. */
  alertedAt: number;
}

/**
 * Persisted alert engine state.
 * Survives the ephemeral MV3 service worker via chrome.storage.local.
 */
export interface AlertState {
  /** contractId → epoch ms of the last alert for that market. */
  lastNotified: Record<string, number>;
  /** contractId → last-seen Yes price (0–1) for direction delta. */
  priorYesPrice: Record<string, number>;
  /** Epoch ms of the last global alert (global throttle). */
  lastGlobalAlertAt: number;
}

// ── Theme ─────────────────────────────────────────────────────────

export type ThemeMode = 'dark' | 'light';

// ── Messaging ────────────────────────────────────────────────────

/**
 * Typed message envelope for background ↔ content ↔ popup communication.
 * Using a discriminated union ensures type-safe `runtime.sendMessage`.
 *
 * ── Client-side architecture ─────────────────────────────────────
 * Content scripts scrape the DOM and send results to the background.
 * The background orchestrates hourly collection by opening background
 * tabs, waiting for content scripts to scrape, then closing them.
 * The new tab dashboard reads collected data from chrome.storage.
 */
export type Message =
  // Content script → Background: report scraped data from the active page
  | { type: 'REPORT_MARKET_DATA'; payload: { markets: MarketContract[] } }
  | { type: 'REPORT_SOCIAL_DATA'; payload: { signals: SocialSignal[] } }
  | { type: 'REPORT_NEWS_DATA'; payload: { news: NewsItem[] } }
  // Content script → Background: report social-source health (Phase 7, D-02)
  | { type: 'REPORT_SOCIAL_HEALTH'; payload: { platform: SocialPlatform; entry: SourceHealthEntry } }
  // Content script (prediction markets) → Background: resolve contract from URL
  | { type: 'GET_CONTRACT_CONTEXT'; payload: { url: string } }
  | { type: 'CONTRACT_CONTEXT_RESULT'; payload: { contract: MarketContract | null } }
  // Popup / Dashboard → Background: trigger manual collection
  | { type: 'TRIGGER_COLLECTION'; payload: Record<string, never> }
  | { type: 'COLLECTION_COMPLETE'; payload: { snapshot: CollectionSnapshot } }
  // Popup / Dashboard → Background: get latest snapshot
  | { type: 'GET_LATEST_SNAPSHOT'; payload: Record<string, never> }
  | { type: 'LATEST_SNAPSHOT'; payload: { snapshot: CollectionSnapshot | null } }
  // Background → Content script: start scraping (sent when bg tab opens)
  | { type: 'START_SCRAPE'; payload: { source: string } }
  | { type: 'SCRAPE_RESULT'; payload: { source: string; data: unknown } }
  // Dashboard → Background: correlate all collected data
  | { type: 'CORRELATE_ALL'; payload: { engine?: CorrelationEngine; model?: string; requestId?: string } }
  | { type: 'CORRELATION_RESULT'; payload: CorrelationResult }
  // Background → Dashboard: progress update for ML correlation
  // `file` is only set during the `loading-model` phase (Phase 15, MLPROG-02)
  // and names the model file currently being downloaded.
  | { type: 'CORRELATION_PROGRESS'; payload: { requestId: string; phase: string; current: number; total: number; engine: string; model: string; file?: string } }
  // Dashboard → Background: cancel a running ML correlation
  | { type: 'CANCEL_CORRELATION'; payload: { requestId: string } }
  | { type: 'CANCEL_RESULT'; payload: { cancelled: boolean } }
  // Phase 15 (MLPROG-01): Dashboard → Background: is an ML run live?
  // Lets the UI detect a run whose service worker died mid-flight and
  // settle stale progress instead of spinning forever.
  | { type: 'CORRELATION_RUN_STATE'; payload: { requestId?: string } }
  | { type: 'CORRELATION_RUN_STATE_RESULT'; payload: { live: boolean; requestId: string | null; queued: boolean; activeRequestId: string | null } }
  // Overlay injection (socials content script)
  | { type: 'INJECT_OVERLAY'; payload: { matches: CorrelationMatch[] } }
  // Dashboard → Background: get historical snapshots for charting
  | { type: 'GET_HISTORY'; payload: { limit?: number } }
  | { type: 'HISTORY_RESULT'; payload: { history: HistoryEntry[] } }
  // Dashboard → Background: watchlist management
  | { type: 'ADD_TO_WATCHLIST'; payload: { entry: WatchlistEntry } }
  | { type: 'REMOVE_FROM_WATCHLIST'; payload: { contractId: string } }
  | { type: 'GET_WATCHLIST'; payload: Record<string, never> }
  | { type: 'WATCHLIST_RESULT'; payload: { watchlist: WatchlistEntry[] } }
  // Dashboard → Background: export collected data
  | { type: 'EXPORT_DATA'; payload: { format: 'csv' | 'json' } }
  | { type: 'EXPORT_RESULT'; payload: { data: string; filename: string } }
  // Background → Dashboard: alert records updated (Phase 4)
  | { type: 'ALERTS_UPDATED'; payload: { alerts: AlertRecord[] } }
  // Dashboard → Background: clear all alert records + reset badge
  | { type: 'CLEAR_ALERTS'; payload: Record<string, never> }
  // Dashboard / Popup → Background: get storage usage stats (Phase 4)
  | { type: 'GET_STORAGE_USAGE'; payload: Record<string, never> }
  | { type: 'STORAGE_USAGE_RESULT'; payload: { usage: { totalBytes: number; perKey: Record<string, number> } } };

export type MessageType = Message['type'];

// ── Settings ─────────────────────────────────────────────────────

export interface ExtensionSettings {
  /** Collection interval in minutes for background data gathering. */
  collectionIntervalMinutes: number;
  /** Enable/disable data sources. */
  enabledSources: {
    polymarket: boolean;
    kalshi: boolean;
    x: boolean;
    reddit: boolean;
    tiktok: boolean;
    bbc: boolean;
    cnn: boolean;
    yahoo: boolean;
    googleFinance: boolean;
    seekingalpha: boolean;
    investing: boolean;
    usaStocksIndicator: boolean;
    stockScreener: boolean;
    stockScreener2: boolean;
  };
  /** Minimum virality score to highlight a signal (0–100). */
  highlightThreshold: number;
  /** Whether to override the new tab page with the TrendCast dashboard. */
  overrideNewTab: boolean;
  /** UI theme mode. */
  theme: ThemeMode;
  /** How many historical snapshots to retain (max). */
  maxHistoryEntries: number;
  /** Which correlation engine strategy to use. */
  correlationEngine: CorrelationEngine;
  /** Which embedding model to use (when engine = 'embedding'). */
  embeddingModel: EmbeddingModel;
  /** Which sentiment model to use (when engine = 'sentiment'). */
  sentimentModel: SentimentModel;
  /** Which NER model to use (when engine = 'ner'). */
  nerModel: NERModel;
  /** Which LLM model to use (when engine = 'llm'). */
  llmModel: LLMModel;
  /**
   * Reddit subreddits to collect from (without the `r/` prefix).
   * Defaults to the finance preset. Users can customise from settings.
   */
  redditSubreddits: string[];
  /** Whether correlation alerts are enabled (Phase 4). */
  alertsEnabled: boolean;
  /** Per-market cooldown between alerts, in minutes (Phase 4). */
  alertCooldownMinutes: number;
  /**
   * Whether to stream debug logs to the local log server
   * (scripts/log-server.ts, ws://localhost:18080). Debug builds only —
   * the forwarder is stripped from production bundles regardless.
   */
  logServerEnabled: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  collectionIntervalMinutes: 60, // hourly
  enabledSources: {
    polymarket: true,
    kalshi: true,
    x: true,
    reddit: true,
    tiktok: true,
    bbc: true,
    cnn: true,
    yahoo: true,
    googleFinance: true,
    seekingalpha: true,
    investing: true,
    usaStocksIndicator: true,
    stockScreener: true,
    stockScreener2: true,
  },
  highlightThreshold: 60,
  overrideNewTab: true,
  theme: 'dark',
  maxHistoryEntries: 168, // 7 days of hourly snapshots
  correlationEngine: 'heuristic',
  embeddingModel: 'Xenova/all-MiniLM-L6-v2',
  sentimentModel: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
  nerModel: 'Xenova/bert-base-NER-uncased',
  llmModel: 'HuggingFaceTB/SmolLM2-135M-Instruct',
  redditSubreddits: ['investing', 'stocks', 'wallstreetbets', 'UKInvesting'],
  alertsEnabled: true,
  alertCooldownMinutes: 60,
  logServerEnabled: false,
};