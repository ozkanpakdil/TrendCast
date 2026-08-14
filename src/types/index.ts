/**
 * Core domain types for HypeMarket.
 *
 * These types are shared across the background worker, content scripts,
 * popup UI, and the correlation engine. Keeping them in one place prevents
 * drift between the data pipeline layers.
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

// ── Messaging ────────────────────────────────────────────────────

/**
 * Typed message envelope for background ↔ content ↔ popup communication.
 * Using a discriminated union ensures type-safe `runtime.sendMessage`.
 */
export type Message =
  | { type: 'GET_CONTRACT_CONTEXT'; payload: { url: string } }
  | { type: 'CONTRACT_CONTEXT_RESULT'; payload: { contract: MarketContract | null } }
  | { type: 'FETCH_MARKETS'; payload: { platform: MarketPlatform } }
  | { type: 'MARKETS_RESULT'; payload: { markets: MarketContract[] } }
  | { type: 'FETCH_SOCIAL_SIGNALS'; payload: { platform: SocialPlatform; keywords: string[] } }
  | { type: 'SOCIAL_SIGNALS_RESULT'; payload: { signals: SocialSignal[] } }
  | { type: 'CORRELATE'; payload: { contractId: string } }
  | { type: 'CORRELATION_RESULT'; payload: { matches: CorrelationMatch[] } }
  | { type: 'INJECT_OVERLAY'; payload: { matches: CorrelationMatch[] } }
  | { type: 'NOTIFY_SPIKE'; payload: { signal: SocialSignal; contract: MarketContract } };

export type MessageType = Message['type'];

// ── Settings ─────────────────────────────────────────────────────

export interface ExtensionSettings {
  /** Polling interval in minutes for background market data refresh. */
  pollIntervalMinutes: number;
  /** Enable/disable social platform scraping. */
  enabledPlatforms: {
    x: boolean;
    reddit: boolean;
    tiktok: boolean;
  };
  /** Minimum virality score to trigger a notification (0–100). */
  notificationThreshold: number;
  /** API keys (stored in chrome.storage.local — never in code). */
  apiKeys: {
    polymarket?: string;
    kalshi?: string;
    xBearer?: string;
    redditClientId?: string;
    redditClientSecret?: string;
  };
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  pollIntervalMinutes: 5,
  enabledPlatforms: { x: true, reddit: true, tiktok: false },
  notificationThreshold: 75,
  apiKeys: {},
};