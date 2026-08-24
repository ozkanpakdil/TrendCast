/**
 * Unit tests for the alert engine `evaluateAlerts` (D-01..D-06).
 *
 * Verifies dedup (no sustained-match alerts), no confidence threshold,
 * market-level new detection, direction from sentiment + yesPrice delta,
 * prior yesPrice from alertState, meaningful-band flip, watchlist scoping,
 * global + per-market throttle, and the history cap.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CONFIG } from '@/config';
import { evaluateAlerts, dispatchAlerts, updateBadge, clearAlerts, broadcastAlerts, getAlertHistory } from '@/background/alerts';
import { BUDGET_KEYS } from '@/utils/storage';
import type {
  AlertRecord,
  AlertState,
  CorrelationResult,
  ExtensionSettings,
  MarketContract,
  SocialSignal,
  WatchlistEntry,
} from '@/types';

// ── In-memory browser.storage.local mock ─────────────────────────
const store = new Map<string, unknown>();
const badgeText = { text: '' };
const sentMessages: unknown[] = [];
const createdNotifications: unknown[] = [];
let permissionLevel = 'granted';

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
    notifications: {
      getPermissionLevel: vi.fn(async () => permissionLevel),
      create: vi.fn(async (id: string, options: unknown) => {
        createdNotifications.push({ id, options });
        return id;
      }),
    },
    action: {
      setBadgeText: vi.fn(async (details: { text: string }) => {
        badgeText.text = details.text;
      }),
    },
    runtime: {
      sendMessage: vi.fn(async (msg: unknown) => {
        sentMessages.push(msg);
      }),
      getURL: vi.fn((path: string) => `moz-extension://test/${path}`),
    },
  },
}));

const NOW = 1_000_000_000_000;

function contract(partial: Partial<MarketContract> = {}): MarketContract {
  return {
    id: 'btc-100k',
    platform: 'polymarket',
    question: 'Will Bitcoin close above $100k on Dec 31?',
    outcomes: [
      { label: 'Yes', price: 0.65 },
      { label: 'No', price: 0.35 },
    ],
    endDate: '2025-12-31T23:59:59Z',
    keywords: ['bitcoin', 'btc'],
    lastUpdated: NOW,
    ...partial,
  };
}

function signal(sentiment: number, text = 'Bitcoin is going up'): SocialSignal {
  return {
    id: `sig-${sentiment}-${Math.random()}`,
    platform: 'reddit',
    text,
    author: 'r/crypto',
    metrics: { likes: 10, shares: 2, comments: 1 },
    timestamp: new Date(NOW).toISOString(),
    keywords: ['bitcoin'],
    sentiment,
    virality: 50,
  };
}

function watchlist(contractId = 'btc-100k'): WatchlistEntry[] {
  return [{ contractId, platform: 'polymarket', question: 'Will Bitcoin close above $100k?', addedAt: NOW }];
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

function state(partial: Partial<AlertState> = {}): AlertState {
  return {
    lastNotified: {},
    priorYesPrice: {},
    lastGlobalAlertAt: 0,
    ...partial,
  };
}

function seedState(s: AlertState): void {
  store.set(CONFIG.storage.alertState, s);
}

function seedHistory(h: AlertRecord[]): void {
  store.set(CONFIG.storage.alertHistory, h);
}

function readHistory(): AlertRecord[] {
  return (store.get(CONFIG.storage.alertHistory) as AlertRecord[]) ?? [];
}

beforeEach(() => {
  store.clear();
  badgeText.text = '';
  sentMessages.length = 0;
  createdNotifications.length = 0;
  permissionLevel = 'granted';
});

describe('evaluateAlerts', () => {
  it('returns [] when alerts are disabled', async () => {
    const out = await evaluateAlerts(result(), [], settings({ alertsEnabled: false }), NOW);
    expect(out).toEqual([]);
  });

  it('returns [] when the watchlist is empty', async () => {
    const out = await evaluateAlerts(result(), [], settings(), NOW);
    expect(out).toEqual([]);
  });

  it('returns [] when there are no correlated matches', async () => {
    const out = await evaluateAlerts(result(), watchlist(), settings(), NOW);
    expect(out).toEqual([]);
  });

  it('alerts on a brand-new watchlisted market (D-03)', async () => {
    const out = await evaluateAlerts(
      result({ matches: [{ contract: contract(), signal: signal(0.8), confidence: 0.9, matchedKeywords: ['bitcoin'], correlatedAt: NOW }] }),
      watchlist(),
      settings(),
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0].contractId).toBe('btc-100k');
    expect(out[0].direction).toBe('mixed'); // no prior yes price → no delta
    expect(out[0].topSignalText).toBe('Bitcoin is going up');
  });

  it('does NOT alert on a sustained match (D-01)', async () => {
    // Prior state already has this market notified with the same yes price.
    seedState(state({ lastNotified: { 'btc-100k': NOW - 1000 }, priorYesPrice: { 'btc-100k': 0.65 } }));
    const out = await evaluateAlerts(
      result({ matches: [{ contract: contract(), signal: signal(0.8), confidence: 0.9, matchedKeywords: ['bitcoin'], correlatedAt: NOW }] }),
      watchlist(),
      settings(),
      NOW,
    );
    // Same yes price, no meaningful band flip → no alert.
    expect(out).toEqual([]);
  });

  it('has NO confidence threshold gate (D-02)', async () => {
    // Even a low-confidence match on a new market alerts.
    const out = await evaluateAlerts(
      result({ matches: [{ contract: contract(), signal: signal(0.8), confidence: 0.1, matchedKeywords: ['bitcoin'], correlatedAt: NOW }] }),
      watchlist(),
      settings(),
      NOW,
    );
    expect(out).toHaveLength(1);
  });

  it('derives direction from sentiment + yes-price delta (D-04)', async () => {
    seedState(state({ priorYesPrice: { 'btc-100k': 0.5 } }));
    const c = contract({ outcomes: [{ label: 'Yes', price: 0.7 }, { label: 'No', price: 0.3 }] });
    const out = await evaluateAlerts(
      result({ matches: [{ contract: c, signal: signal(0.8), confidence: 0.9, matchedKeywords: ['bitcoin'], correlatedAt: NOW }] }),
      watchlist(),
      settings(),
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0].direction).toBe('bullish');
  });

  it('uses prior yesPrice from alertState (D-05)', async () => {
    seedState(state({ priorYesPrice: { 'btc-100k': 0.5 } }));
    const c = contract({ outcomes: [{ label: 'Yes', price: 0.7 }, { label: 'No', price: 0.3 }] });
    const out = await evaluateAlerts(
      result({ matches: [{ contract: c, signal: signal(0.8), confidence: 0.9, matchedKeywords: ['bitcoin'], correlatedAt: NOW }] }),
      watchlist(),
      settings(),
      NOW,
    );
    expect(out[0].direction).toBe('bullish');
  });

  it('applies the meaningful-band flip (D-06): small sentiment wobble does not alert', async () => {
    seedState(state({ lastNotified: { 'btc-100k': NOW - 60_000 }, priorYesPrice: { 'btc-100k': 0.65 } }));
    // sentiment 0.1 < band 0.2, price unchanged → no meaningful flip.
    const out = await evaluateAlerts(
      result({ matches: [{ contract: contract(), signal: signal(0.1), confidence: 0.9, matchedKeywords: ['bitcoin'], correlatedAt: NOW }] }),
      watchlist(),
      settings(),
      NOW,
    );
    expect(out).toEqual([]);
  });

  it('alerts when sentiment crosses the band (D-06)', async () => {
    // lastNotified 2h ago (past the 60-min cooldown), prior yes price set.
    seedState(state({ lastNotified: { 'btc-100k': NOW - 2 * 60 * 60_000 }, priorYesPrice: { 'btc-100k': 0.65 } }));
    const out = await evaluateAlerts(
      result({ matches: [{ contract: contract(), signal: signal(0.8), confidence: 0.9, matchedKeywords: ['bitcoin'], correlatedAt: NOW }] }),
      watchlist(),
      settings(),
      NOW,
    );
    expect(out).toHaveLength(1);
  });

  it('scopes alerts to the watchlist (ignores non-watchlisted markets)', async () => {
    const other = contract({ id: 'eth-100k', question: 'Will ETH hit $10k?' });
    const out = await evaluateAlerts(
      result({ matches: [{ contract: other, signal: signal(0.8), confidence: 0.9, matchedKeywords: ['eth'], correlatedAt: NOW }] }),
      watchlist(), // only btc-100k
      settings(),
      NOW,
    );
    expect(out).toEqual([]);
  });

  it('applies the global throttle', async () => {
    seedState(state({ lastGlobalAlertAt: NOW - 60_000 })); // 1 min ago < 5 min cooldown
    const out = await evaluateAlerts(
      result({ matches: [{ contract: contract(), signal: signal(0.8), confidence: 0.9, matchedKeywords: ['bitcoin'], correlatedAt: NOW }] }),
      watchlist(),
      settings(),
      NOW,
    );
    expect(out).toEqual([]);
  });

  it('applies the per-market cooldown', async () => {
    seedState(state({ lastNotified: { 'btc-100k': NOW - 60_000 }, priorYesPrice: { 'btc-100k': 0.65 } }));
    const out = await evaluateAlerts(
      result({ matches: [{ contract: contract(), signal: signal(0.8), confidence: 0.9, matchedKeywords: ['bitcoin'], correlatedAt: NOW }] }),
      watchlist(),
      settings({ alertCooldownMinutes: 120 }), // 2h cooldown > 1 min since last
      NOW,
    );
    expect(out).toEqual([]);
  });

  it('caps alert history at CONFIG.alerts.historyCap (Task 2)', async () => {
    // Seed history near the cap.
    const existing: AlertRecord[] = [];
    for (let i = 0; i < CONFIG.alerts.historyCap - 1; i++) {
      existing.push({
        id: `old-${i}`,
        kind: 'watchlist',
        contractId: 'btc-100k',
        platform: 'polymarket',
        question: 'q',
        direction: 'mixed',
        sentiment: 0,
        yesPrice: 0.65,
        confidence: 0.5,
        alertedAt: NOW - 100_000 - i,
      });
    }
    seedHistory(existing);
    seedState(state({ priorYesPrice: { 'btc-100k': 0.5 } }));
    const c = contract({ outcomes: [{ label: 'Yes', price: 0.7 }, { label: 'No', price: 0.3 }] });
    await evaluateAlerts(
      result({ matches: [{ contract: c, signal: signal(0.8), confidence: 0.9, matchedKeywords: ['bitcoin'], correlatedAt: NOW }] }),
      watchlist(),
      settings(),
      NOW,
    );
    expect(readHistory().length).toBeLessThanOrEqual(CONFIG.alerts.historyCap);
  });

  it('persists updated alertState and alertHistory', async () => {
    seedState(state({ priorYesPrice: { 'btc-100k': 0.5 } }));
    const c = contract({ outcomes: [{ label: 'Yes', price: 0.7 }, { label: 'No', price: 0.3 }] });
    await evaluateAlerts(
      result({ matches: [{ contract: c, signal: signal(0.8), confidence: 0.9, matchedKeywords: ['bitcoin'], correlatedAt: NOW }] }),
      watchlist(),
      settings(),
      NOW,
    );
    const persisted = store.get(CONFIG.storage.alertState) as AlertState;
    expect(persisted.lastNotified['btc-100k']).toBe(NOW);
    expect(persisted.priorYesPrice['btc-100k']).toBe(0.7);
    expect(readHistory()).toHaveLength(1);
  });
});

describe('BUDGET_KEYS (Task 2)', () => {
  it('includes alertState and alertHistory keys', () => {
    expect(BUDGET_KEYS).toContain(CONFIG.storage.alertState);
    expect(BUDGET_KEYS).toContain(CONFIG.storage.alertHistory);
  });
});

// ── Plan 04-02 Task 2: dispatch / badge / clear / broadcast ──────

function record(partial: Partial<AlertRecord> = {}): AlertRecord {
  return {
    id: 'btc-100k:1',
    kind: 'watchlist',
    contractId: 'btc-100k',
    platform: 'polymarket',
    question: 'Will Bitcoin close above $100k?',
    direction: 'bullish',
    sentiment: 0.8,
    yesPrice: 0.7,
    topSignalText: 'Bitcoin is going up',
    confidence: 0.9,
    alertedAt: NOW,
    ...partial,
  };
}

describe('dispatchAlerts', () => {
  it('does nothing for an empty list', async () => {
    await dispatchAlerts([]);
    expect(createdNotifications).toHaveLength(0);
  });

  it('creates a notification when permission is granted', async () => {
    await dispatchAlerts([record()]);
    expect(createdNotifications).toHaveLength(1);
    const { id, options } = createdNotifications[0] as { id: string; options: { type: string; title: string; message: string; iconUrl: string } };
    expect(id).toContain('trendcast-alert-');
    expect(options.type).toBe('basic');
    expect(options.title).toContain('bullish');
    expect(options.message).toBe('Bitcoin is going up');
    expect(options.iconUrl).toContain('icons/icon-128.png');
  });

  it('falls back to the badge when permission is denied', async () => {
    permissionLevel = 'denied';
    seedHistory([record({ alertedAt: Date.now() })]);
    await dispatchAlerts([record()]);
    expect(createdNotifications).toHaveLength(0);
    expect(badgeText.text).toBe('1');
  });
});

describe('updateBadge', () => {
  it('shows the count of alerts within the badge window', async () => {
    seedHistory([record({ alertedAt: NOW }), record({ id: 'b', alertedAt: NOW - 1000 })]);
    await updateBadge(NOW);
    expect(badgeText.text).toBe('2');
  });

  it('clears the badge when no alerts are within the window', async () => {
    seedHistory([record({ alertedAt: NOW - CONFIG.alerts.badgeWindowHours * 60 * 60 * 1000 - 1 })]);
    await updateBadge(NOW);
    expect(badgeText.text).toBe('');
  });
});

describe('clearAlerts', () => {
  it('resets history, state, badge, and broadcasts an empty list', async () => {
    seedHistory([record()]);
    seedState(state({ lastNotified: { 'btc-100k': NOW } }));
    await clearAlerts();
    expect(readHistory()).toEqual([]);
    expect((store.get(CONFIG.storage.alertState) as AlertState).lastNotified).toEqual({});
    expect(badgeText.text).toBe('');
    const msg = sentMessages[sentMessages.length - 1] as { type: string; payload: { alerts: AlertRecord[] } };
    expect(msg.type).toBe('ALERTS_UPDATED');
    expect(msg.payload.alerts).toEqual([]);
  });
});

describe('broadcastAlerts', () => {
  it('sends ALERTS_UPDATED with the given records', async () => {
    await broadcastAlerts([record()]);
    const msg = sentMessages[0] as { type: string; payload: { alerts: AlertRecord[] } };
    expect(msg.type).toBe('ALERTS_UPDATED');
    expect(msg.payload.alerts).toHaveLength(1);
  });
});

describe('getAlertHistory', () => {
  it('returns the persisted history', async () => {
    seedHistory([record()]);
    const history = await getAlertHistory();
    expect(history).toHaveLength(1);
  });
});
