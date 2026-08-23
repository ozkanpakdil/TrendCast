/**
 * Unit tests for the TikTok scraper in the socials content script.
 *
 * Verifies `detectPlatform` returns 'tiktok' only on tiktok.com (D-01), and
 * `scrapeTikTok` extracts, dedups, and caps trends with broad selectors,
 * returning [] gracefully when nothing matches.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the browser polyfill before importing the content script (which pulls
// in @/messaging → webextension-polyfill).
vi.mock('@/messaging/browser', () => ({
  browser: {
    runtime: {
      sendMessage: vi.fn(async () => undefined),
    },
  },
}));

import { detectPlatform, scrapeTikTok } from '@/content/socials';

/** Helper to set the window hostname for detectPlatform tests. */
function setHostname(hostname: string): void {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, hostname },
    writable: true,
    configurable: true,
  });
}

/** Helper to inject elements into the jsdom document. */
function setBodyHTML(html: string): void {
  document.body.innerHTML = html;
}

describe('detectPlatform', () => {
  afterEach(() => {
    setHostname('example.com');
  });

  it('returns tiktok when hostname includes tiktok.com', () => {
    setHostname('www.tiktok.com');
    expect(detectPlatform()).toBe('tiktok');
  });

  it('returns null for x.com', () => {
    setHostname('x.com');
    expect(detectPlatform()).toBeNull();
  });

  it('returns null for reddit.com', () => {
    setHostname('www.reddit.com');
    expect(detectPlatform()).toBeNull();
  });
});

describe('scrapeTikTok', () => {
  beforeEach(() => {
    setBodyHTML('');
  });

  afterEach(() => {
    setBodyHTML('');
  });

  it('extracts trend titles from broad defensive selectors with rank = index', () => {
    setBodyHTML(`
      <div data-e2e="trend-card">Fed rate cut</div>
      <div data-e2e="trend-card">Bitcoin surge</div>
      <div data-e2e="trend-card">AI breakthrough</div>
    `);
    const trends = scrapeTikTok();
    expect(trends.length).toBeGreaterThanOrEqual(3);
    expect(trends[0]).toEqual({ title: 'Fed rate cut', rank: 0 });
    expect(trends[1]).toEqual({ title: 'Bitcoin surge', rank: 1 });
  });

  it('dedups by title', () => {
    setBodyHTML(`
      <div data-e2e="trend-card">Fed rate cut</div>
      <div data-e2e="trend-card">Fed rate cut</div>
      <h3>Fed rate cut</h3>
    `);
    const trends = scrapeTikTok();
    const titles = trends.map((t) => t.title);
    expect(titles.filter((t) => t === 'Fed rate cut').length).toBe(1);
  });

  it('caps results at 30 trends', () => {
    const cards = Array.from(
      { length: 50 },
      (_, i) => `<div data-e2e="trend-card">Trend number ${i}</div>`,
    ).join('');
    setBodyHTML(cards);
    const trends = scrapeTikTok();
    expect(trends.length).toBeLessThanOrEqual(30);
  });

  it('returns [] when no selectors match (graceful degradation)', () => {
    setBodyHTML('<div><span>no trends here</span></div>');
    expect(scrapeTikTok()).toEqual([]);
  });

  it('skips empty/short titles (< 2 chars)', () => {
    setBodyHTML(`
      <div data-e2e="trend-card"></div>
      <div data-e2e="trend-card">x</div>
      <div data-e2e="trend-card">Real trend title</div>
    `);
    const trends = scrapeTikTok();
    const titles = trends.map((t) => t.title);
    expect(titles).not.toContain('');
    expect(titles).not.toContain('x');
    expect(titles).toContain('Real trend title');
  });
});
