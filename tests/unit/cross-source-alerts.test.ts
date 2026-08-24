/**
 * Unit tests for the cross-source consensus alert engine
 * `evaluateCrossSourceAlerts` (Phase 10, D-01..D-09).
 *
 * Verifies: NOT watchlist-scoped (fires with an empty watchlist), requires
 * >=3 distinct source types, requires a social+news mix, clusters matches by
 * shared entity keyword, derives direction from mean sentiment, applies
 * global + per-topic cooldowns, persists to alertHistory, and is gated only
 * by `alertsEnabled`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CONFIG } from '@/config';
import { evaluateCrossSourceAlerts } from '@/background/alerts';
import type {
  AlertRecord,
  CorrelationResult,
  ExtensionSettings,
  NewsItem,
  SocialSignal,
} from '@/types';

// ── In-memory browser.storage.local mock ─────────────────────────
const store = new Map<string, unknown>();

vi.mock('@/messaging/browser', () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const out: Record<string, unknown> = {};
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) out[k] = store.get(k);
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        }),
      },
    },
  },
}));

const NOW = 1_000_000_000_000;

function news(source: NewsItem['source'], headline: string): NewsItem {
  return {
    id: `news-${source}-${Math.random()}`,
    source,
    headline,
    url: `https://example.com/${source}`,
    publishedAt: new Date(NOW).toISOString(),
    keywords: ['bitcoin'],
  };
}

function signal(platform: SocialSignal['platform'], sentiment: number, text: string): SocialSignal {
  return {
    id: `sig-${platform}-${Math.random()}`,
    platform,
    text,
    author: 'author',
    metrics: { likes: 10, shares: 2, comments: 1 },
    timestamp: new Date(NOW).toISOString(),
    keywords: ['bitcoin'],
    sentiment,
    virality: 50,
  };
}

function settings(partial: Partial<ExtensionSettings> = {}): ExtensionSettings {
  return {
    collectionIntervalMinutes: 60,
    enabledSources: {
      polymarket: true, kalshi: true, x: true, reddit: true, tiktok: false,
      bbc: true, cnn: true, yahoo: true, googleFinance: true, seekingalpha: true, investing: true,
    },
    highlightThreshold: 60,
    overrideNewTab: true,
    theme: 'dark',
    maxHistoryEntries: 168,
    correlationEngine: 'heuristic',
    embeddingModel: 'Xenova/all-MiniLM-L6-v2',
    sentimentModel: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
    zeroShotModel: 'Xenova/distilbert-base-uncased-mnli',
    nerModel: 'Xenova/bert-base-NER-uncased',
    llmModel: 'HuggingFaceTB/SmolLM2-135M-Instruct',
    redditSubreddits: ['investing'],
    alertsEnabled: true,
    alertCooldownMinutes: 60,
    ...partial,
  };
}

function result(partial: Partial<CorrelationResult> = {}): CorrelationResult {
  return {
    matches: [],
    newsMatches: [],
    newsSocialMatches: [],
    ...partial,
  };
}

function readHistory(): AlertRecord[] {
  return (store.get(CONFIG.storage.alertHistory) as AlertRecord[]) ?? [];
}

beforeEach(() => {
  store.clear();
});

describe('evaluateCrossSourceAlerts', () => {
  it('returns [] when alerts are disabled (D-09)', async () => {
    const out = await evaluateCrossSourceAlerts(result(), settings({ alertsEnabled: false }), NOW);
    expect(out).toEqual([]);
  });

  it('returns [] when there are no newsSocialMatches', async () => {
    const out = await evaluateCrossSourceAlerts(result(), settings(), NOW);
    expect(out).toEqual([]);
  });

  it('fires a crossSource alert with an EMPTY watchlist (D-06)', async () => {
    // 2 social (reddit + x) + 3 news (bbc, cnn, seekingalpha) all on "bitcoin".
    const matches = [
      { news: news('bbc', 'Bitcoin rallies to new high'), signal: signal('reddit', 0.8, 'Bitcoin is pumping'), confidence: 0.9, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news('cnn', 'Bitcoin adoption grows'), signal: signal('x', 0.6, 'Bitcoin everywhere'), confidence: 0.8, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news('seekingalpha', 'Bitcoin ETF inflows'), signal: signal('reddit', 0.7, 'Bitcoin ETF'), confidence: 0.7, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
    ];
    const out = await evaluateCrossSourceAlerts(result({ newsSocialMatches: matches }), settings(), NOW);
    expect(out).toHaveLength(1);
    const alert = out[0]!;
    expect(alert.kind).toBe('crossSource');
    expect(alert.topicLabel).toBe('Bitcoin');
    const sourceTypes = alert.sourceTypes!;
    expect(sourceTypes).toContain('reddit');
    expect(sourceTypes).toContain('x');
    expect(sourceTypes).toContain('bbc');
    expect(sourceTypes).toContain('cnn');
    expect(sourceTypes).toContain('seekingalpha');
    expect(sourceTypes.length).toBeGreaterThanOrEqual(CONFIG.alerts.minConsensusSourceTypes);
    expect(alert.direction).toBe('bullish');
    // Top match (highest confidence) is the bbc/reddit pair → URLs populated.
    expect(alert.topNewsUrl).toBe('https://example.com/bbc');
    expect(alert.topSignalUrl).toBeUndefined(); // signal() helper sets no url
  });

  it('does NOT fire when fewer than 3 distinct source types (D-01)', async () => {
    // Only 2 distinct source types (reddit + bbc).
    const matches = [
      { news: news('bbc', 'Bitcoin up'), signal: signal('reddit', 0.8, 'Bitcoin'), confidence: 0.9, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news('bbc', 'Bitcoin again'), signal: signal('reddit', 0.6, 'Bitcoin'), confidence: 0.8, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
    ];
    const out = await evaluateCrossSourceAlerts(result({ newsSocialMatches: matches }), settings(), NOW);
    expect(out).toEqual([]);
  });

  it('does NOT fire when 3 posts share ONE source type + 1 news (D-02 dedupe)', async () => {
    // 3 reddit signals + 1 bbc news → distinct source types = {reddit, bbc} = 2.
    const matches = [
      { news: news('bbc', 'Bitcoin up'), signal: signal('reddit', 0.8, 'Bitcoin'), confidence: 0.9, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news('bbc', 'Bitcoin up'), signal: signal('reddit', 0.7, 'Bitcoin'), confidence: 0.8, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news('bbc', 'Bitcoin up'), signal: signal('reddit', 0.6, 'Bitcoin'), confidence: 0.7, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news('bbc', 'Bitcoin up'), signal: signal('reddit', 0.5, 'Bitcoin'), confidence: 0.6, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
    ];
    const out = await evaluateCrossSourceAlerts(result({ newsSocialMatches: matches }), settings(), NOW);
    expect(out).toEqual([]);
  });

  it('does NOT fire when all source types are social (no news) (D-01)', async () => {
    // x + reddit + tiktok = 3 distinct source types but ALL social.
    // News sources are unknown (not in NEWS_SOURCES) so they don't count.
    const unknownNews = 'unknown' as NewsItem['source'];
    const matches = [
      { news: news(unknownNews, 'Bitcoin up'), signal: signal('x', 0.8, 'Bitcoin'), confidence: 0.9, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news(unknownNews, 'Bitcoin up'), signal: signal('reddit', 0.7, 'Bitcoin'), confidence: 0.8, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news(unknownNews, 'Bitcoin up'), signal: signal('tiktok', 0.6, 'Bitcoin'), confidence: 0.7, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
    ];
    const out = await evaluateCrossSourceAlerts(result({ newsSocialMatches: matches }), settings(), NOW);
    expect(out).toEqual([]);
  });

  it('dedupes sourceTypes to the distinct types in a mixed cluster (D-02)', async () => {
    // Multiple posts from the same source type should count once.
    const matches = [
      { news: news('bbc', 'Bitcoin up'), signal: signal('reddit', 0.8, 'Bitcoin'), confidence: 0.9, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news('cnn', 'Bitcoin up'), signal: signal('reddit', 0.7, 'Bitcoin'), confidence: 0.8, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news('seekingalpha', 'Bitcoin up'), signal: signal('x', 0.6, 'Bitcoin'), confidence: 0.7, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
    ];
    const out = await evaluateCrossSourceAlerts(result({ newsSocialMatches: matches }), settings(), NOW);
    expect(out).toHaveLength(1);
    const sourceTypes = out[0]!.sourceTypes!;
    expect(sourceTypes).toHaveLength(5); // reddit, x, bbc, cnn, seekingalpha
    expect(sourceTypes.filter((s) => s === 'reddit')).toHaveLength(1);
  });

  it('does NOT fire when there is no social+news mix (D-01)', async () => {
    // 3 distinct source types but ALL news (no social).
    const matches = [
      { news: news('bbc', 'Bitcoin up'), signal: signal('reddit', 0.8, 'Bitcoin'), confidence: 0.9, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news('cnn', 'Bitcoin up'), signal: signal('reddit', 0.8, 'Bitcoin'), confidence: 0.9, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news('seekingalpha', 'Bitcoin up'), signal: signal('reddit', 0.8, 'Bitcoin'), confidence: 0.9, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
    ];
    // Force all matches to be news-only by using only news sources in the mix.
    // Here the signal platform is reddit (social) so it WOULD mix — instead
    // simulate a news-only scenario by making the "signal" a news source.
    const newsOnly = matches.map((m) => ({
      ...m,
      signal: { ...m.signal, platform: 'bbc' as SocialSignal['platform'] },
    }));
    const out = await evaluateCrossSourceAlerts(result({ newsSocialMatches: newsOnly }), settings(), NOW);
    expect(out).toEqual([]);
  });

  it('persists the alert to alertHistory (D-08)', async () => {
    const matches = [
      { news: news('bbc', 'Bitcoin up'), signal: signal('reddit', 0.8, 'Bitcoin'), confidence: 0.9, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news('cnn', 'Bitcoin up'), signal: signal('x', 0.6, 'Bitcoin'), confidence: 0.8, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news('seekingalpha', 'Bitcoin up'), signal: signal('reddit', 0.7, 'Bitcoin'), confidence: 0.7, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
    ];
    await evaluateCrossSourceAlerts(result({ newsSocialMatches: matches }), settings(), NOW);
    const history = readHistory();
    expect(history).toHaveLength(1);
    expect(history[0].kind).toBe('crossSource');
  });

  it('fires MULTIPLE distinct consensus topics in one sweep (WR-02)', async () => {
    // Two independent topics (bitcoin + nvidia), each with >=3 distinct source
    // types and a social+news mix. The global cooldown must NOT suppress the
    // second topic within the same sweep.
    const matches = [
      // bitcoin cluster
      { news: news('bbc', 'Bitcoin rallies to new high'), signal: signal('reddit', 0.8, 'Bitcoin is pumping'), confidence: 0.9, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news('cnn', 'Bitcoin adoption grows'), signal: signal('x', 0.6, 'Bitcoin everywhere'), confidence: 0.8, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news('seekingalpha', 'Bitcoin ETF inflows'), signal: signal('reddit', 0.7, 'Bitcoin ETF'), confidence: 0.7, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      // nvidia cluster
      { news: news('yahoo', 'Nvidia beats earnings'), signal: signal('reddit', 0.8, 'Nvidia is flying'), confidence: 0.9, matchedKeywords: ['nvidia'], correlatedAt: NOW },
      { news: news('investing', 'Nvidia stock surges'), signal: signal('x', 0.6, 'Nvidia up'), confidence: 0.8, matchedKeywords: ['nvidia'], correlatedAt: NOW },
      { news: news('googleFinance', 'Nvidia hits record'), signal: signal('reddit', 0.7, 'Nvidia record'), confidence: 0.7, matchedKeywords: ['nvidia'], correlatedAt: NOW },
    ];
    const out = await evaluateCrossSourceAlerts(result({ newsSocialMatches: matches }), settings(), NOW);
    expect(out).toHaveLength(2);
    const labels = out.map((a) => a.topicLabel).sort();
    expect(labels).toEqual(['Bitcoin', 'Nvidia']);
  });

  it('respects the per-topic cooldown (D-08)', async () => {
    const matches = [
      { news: news('bbc', 'Bitcoin up'), signal: signal('reddit', 0.8, 'Bitcoin'), confidence: 0.9, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news('cnn', 'Bitcoin up'), signal: signal('x', 0.6, 'Bitcoin'), confidence: 0.8, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news('seekingalpha', 'Bitcoin up'), signal: signal('reddit', 0.7, 'Bitcoin'), confidence: 0.7, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
    ];
    // First call fires.
    await evaluateCrossSourceAlerts(result({ newsSocialMatches: matches }), settings(), NOW);
    // Second call within cooldown does not fire.
    const out = await evaluateCrossSourceAlerts(result({ newsSocialMatches: matches }), settings(), NOW + 1000);
    expect(out).toEqual([]);
  });

  it('derives direction from mean sentiment (D-03)', async () => {
    const matches = [
      { news: news('bbc', 'Bitcoin up'), signal: signal('reddit', -0.8, 'Bitcoin crash'), confidence: 0.9, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news('cnn', 'Bitcoin up'), signal: signal('x', -0.6, 'Bitcoin down'), confidence: 0.8, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news('seekingalpha', 'Bitcoin up'), signal: signal('reddit', -0.7, 'Bitcoin bear'), confidence: 0.7, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
    ];
    const out = await evaluateCrossSourceAlerts(result({ newsSocialMatches: matches }), settings(), NOW);
    expect(out).toHaveLength(1);
    expect(out[0]!.direction).toBe('bearish');
  });

  it('fires a mixed crossSource alert when mean sentiment is ~0 (D-03)', async () => {
    // Mean sentiment = (0.1 + -0.1 + 0.0) / 3 ≈ 0 → mixed.
    const matches = [
      { news: news('bbc', 'Bitcoin up'), signal: signal('reddit', 0.1, 'Bitcoin'), confidence: 0.9, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news('cnn', 'Bitcoin up'), signal: signal('x', -0.1, 'Bitcoin'), confidence: 0.8, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news('seekingalpha', 'Bitcoin up'), signal: signal('reddit', 0.0, 'Bitcoin'), confidence: 0.7, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
    ];
    const out = await evaluateCrossSourceAlerts(result({ newsSocialMatches: matches }), settings(), NOW);
    expect(out).toHaveLength(1);
    expect(out[0]!.direction).toBe('mixed');
  });

  it('respects the per-topic cooldown across calls (D-08)', async () => {
    const matches = [
      { news: news('bbc', 'Bitcoin up'), signal: signal('reddit', 0.8, 'Bitcoin'), confidence: 0.9, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news('cnn', 'Bitcoin up'), signal: signal('x', 0.6, 'Bitcoin'), confidence: 0.8, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news('seekingalpha', 'Bitcoin up'), signal: signal('reddit', 0.7, 'Bitcoin'), confidence: 0.7, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
    ];
    // First call fires.
    await evaluateCrossSourceAlerts(result({ newsSocialMatches: matches }), settings(), NOW);
    // Second call within the 60-min cooldown does not fire.
    const out = await evaluateCrossSourceAlerts(result({ newsSocialMatches: matches }), settings(), NOW + 60_000);
    expect(out).toEqual([]);
  });

  it('returns [] when alertsEnabled is false even with consensus (D-09)', async () => {
    const matches = [
      { news: news('bbc', 'Bitcoin up'), signal: signal('reddit', 0.8, 'Bitcoin'), confidence: 0.9, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news('cnn', 'Bitcoin up'), signal: signal('x', 0.6, 'Bitcoin'), confidence: 0.8, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
      { news: news('seekingalpha', 'Bitcoin up'), signal: signal('reddit', 0.7, 'Bitcoin'), confidence: 0.7, matchedKeywords: ['bitcoin'], correlatedAt: NOW },
    ];
    const out = await evaluateCrossSourceAlerts(
      result({ newsSocialMatches: matches }),
      settings({ alertsEnabled: false }),
      NOW,
    );
    expect(out).toEqual([]);
  });
});
