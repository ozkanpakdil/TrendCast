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
 */
export type NewsSource = 'bbc' | 'cnn';

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
}

// ── Correlation ──────────────────────────────────────────────────

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
}

/**
 * A compact historical snapshot for charting.
 * Only stores aggregate counts + top items to keep storage small.
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
  | { type: 'CORRELATE_ALL'; payload: Record<string, never> }
  | { type: 'CORRELATION_RESULT'; payload: { matches: CorrelationMatch[]; newsMatches: NewsCorrelationMatch[] } }
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
  | { type: 'EXPORT_RESULT'; payload: { data: string; filename: string } };

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
  };
  /** Minimum virality score to highlight a signal (0–100). */
  highlightThreshold: number;
  /** Whether to override the new tab page with the TrendCast dashboard. */
  overrideNewTab: boolean;
  /** UI theme mode. */
  theme: ThemeMode;
  /** How many historical snapshots to retain (max). */
  maxHistoryEntries: number;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  collectionIntervalMinutes: 60, // hourly
  enabledSources: {
    polymarket: true,
    kalshi: true,
    x: true,
    reddit: true,
    tiktok: false,
    bbc: true,
    cnn: true,
  },
  highlightThreshold: 60,
  overrideNewTab: true,
  theme: 'dark',
  maxHistoryEntries: 168, // 7 days of hourly snapshots
};