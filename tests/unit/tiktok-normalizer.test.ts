/**
 * Unit tests for the TikTok trend normalizer.
 *
 * Verifies `normaliseTikTokTrend` maps a raw scraped TikTok trend to a
 * valid SocialSignal with platform 'tiktok', rank-based virality,
 * sentiment, a stable slug id, and a TikTok search URL.
 */

import { describe, it, expect } from 'vitest';
import { normaliseTikTokTrend } from '@/utils/tiktok';

describe('normaliseTikTokTrend', () => {
  it('returns a SocialSignal with platform tiktok, text, virality in [50,98], and keywords', () => {
    const signal = normaliseTikTokTrend({ title: 'Fed rate cut', rank: 0 });
    expect(signal.platform).toBe('tiktok');
    expect(signal.text).toBe('Fed rate cut');
    expect(signal.virality).toBeGreaterThanOrEqual(50);
    expect(signal.virality).toBeLessThanOrEqual(98);
    expect(signal.keywords).toContain('fed');
  });

  it('virality decreases as rank increases', () => {
    const top = normaliseTikTokTrend({ title: 'Trend A', rank: 0 });
    const lower = normaliseTikTokTrend({ title: 'Trend B', rank: 9 });
    expect(top.virality).toBeGreaterThan(lower.virality);
  });

  it('derives sentiment from analyzeSentiment (bullish title scores > 0)', () => {
    const signal = normaliseTikTokTrend({ title: 'Stocks surge to record high', rank: 0 });
    expect(signal.sentiment).toBeGreaterThan(0);
  });

  it('produces a stable slug id tiktok:<slugified-title>', () => {
    const signal = normaliseTikTokTrend({ title: 'Fed Rate Cut', rank: 0 });
    expect(signal.id).toBe('tiktok:fed-rate-cut');
  });

  it('produces a TikTok search URL', () => {
    const signal = normaliseTikTokTrend({ title: 'Fed rate cut', rank: 0 });
    expect(signal.url).toBe(
      `https://www.tiktok.com/search?q=${encodeURIComponent('Fed rate cut')}`,
    );
  });

  it('defaults metrics to zeros and author to Trending', () => {
    const signal = normaliseTikTokTrend({ title: 'Some trend', rank: 0 });
    expect(signal.metrics).toEqual({ likes: 0, shares: 0, comments: 0 });
    expect(signal.author).toBe('Trending');
  });
});
