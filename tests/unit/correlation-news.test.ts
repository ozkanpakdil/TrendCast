import { describe, it, expect } from 'vitest';
import { buildMarketDrivenNews } from '@/background/correlationNews';
import { mockContract, newsItem, newsMatch } from './fixtures';
import type { MarketContract, WatchlistEntry } from '@/types';

/** A finance contract with high volume. */
const financeContract: MarketContract = {
  ...mockContract,
  id: 'fin-1',
  question: 'Will the Fed cut rates in Q3?',
  volume24h: 50_000,
};

/** A politics contract with low volume (below minVolume). */
const politicsContract: MarketContract = {
  ...mockContract,
  id: 'pol-1',
  question: 'Will the Senate pass the tariff bill?',
  volume24h: 2_000,
};

/** A tech contract with high volume. */
const techContract: MarketContract = {
  ...mockContract,
  id: 'tech-1',
  question: 'Will Nvidia announce a new AI chip?',
  volume24h: 80_000,
};

const watchlist: WatchlistEntry[] = [
  { contractId: 'pol-1', platform: 'polymarket', question: politicsContract.question, addedAt: Date.now() },
];

describe('buildMarketDrivenNews', () => {
  it('includes a market at/above minVolume and excludes a below-minVolume non-watchlisted market (D-05)', () => {
    const matches = [
      newsMatch(financeContract, newsItem('yahoo', 'Fed raises rates to fight inflation')),
      newsMatch(techContract, newsItem('yahoo', 'AI chip startup raises funding')),
    ];
    const view = buildMarketDrivenNews(matches, [], 10_000, 20);
    const all = [...view.categories.finance, ...view.categories.politics, ...view.categories.technology];
    const ids = all.map((i) => i.contract.id);
    expect(ids).toContain('fin-1');
    expect(ids).toContain('tech-1');
  });

  it('includes a watchlisted market with volume below minVolume (D-05)', () => {
    const matches = [newsMatch(politicsContract, newsItem('yahoo', 'Senate passes tariff bill on tech imports'))];
    const view = buildMarketDrivenNews(matches, watchlist, 10_000, 20);
    const all = [...view.categories.finance, ...view.categories.politics, ...view.categories.technology];
    expect(all.map((i) => i.contract.id)).toContain('pol-1');
  });

  it('omits a below-minVolume non-watchlisted market', () => {
    const lowVol: MarketContract = { ...politicsContract, id: 'low-1' };
    const matches = [newsMatch(lowVol, newsItem('yahoo', 'Senate passes tariff bill'))];
    const view = buildMarketDrivenNews(matches, [], 10_000, 20);
    const all = [...view.categories.finance, ...view.categories.politics, ...view.categories.technology];
    expect(all.map((i) => i.contract.id)).not.toContain('low-1');
  });

  it('derives direction from Yes price + mean news sentiment (D-07)', () => {
    // Yes price 0.65 (>0.5) + positive sentiment → 'up'
    const upContract: MarketContract = { ...financeContract, id: 'up-1', outcomes: [{ label: 'Yes', price: 0.65 }, { label: 'No', price: 0.35 }] };
    const upView = buildMarketDrivenNews(
      [newsMatch(upContract, newsItem('yahoo', 'market gains strongly'))],
      [],
      10_000,
      20,
    );
    expect(upView.categories.finance[0].direction).toBe('up');

    // Yes price 0.3 (<0.5) + negative sentiment → 'down'
    const downContract: MarketContract = { ...financeContract, id: 'down-1', outcomes: [{ label: 'Yes', price: 0.3 }, { label: 'No', price: 0.7 }] };
    const downView = buildMarketDrivenNews(
      [newsMatch(downContract, newsItem('yahoo', 'inflation rises sharply'))],
      [],
      10_000,
      20,
    );
    expect(downView.categories.finance[0].direction).toBe('down');

    // Conflicting signals → 'mixed' (Yes price >0.5 but negative sentiment)
    const mixedContract: MarketContract = { ...financeContract, id: 'mixed-1', outcomes: [{ label: 'Yes', price: 0.65 }, { label: 'No', price: 0.35 }] };
    const mixedView = buildMarketDrivenNews(
      [newsMatch(mixedContract, newsItem('yahoo', 'inflation rises sharply'))],
      [],
      10_000,
      20,
    );
    expect(mixedView.categories.finance[0].direction).toBe('mixed');
  });

  it('groups items by category, deriving category from majority news category (D-09)', () => {
    const matches = [
      newsMatch(financeContract, newsItem('yahoo', 'Fed raises rates to fight inflation')),
      newsMatch(techContract, newsItem('yahoo', 'AI chip startup raises funding')),
      newsMatch(politicsContract, newsItem('yahoo', 'Senate passes tariff bill on tech imports')),
    ];
    const view = buildMarketDrivenNews(matches, watchlist, 10_000, 20);
    expect(view.categories.finance.map((i) => i.contract.id)).toContain('fin-1');
    expect(view.categories.technology.map((i) => i.contract.id)).toContain('tech-1');
    expect(view.categories.politics.map((i) => i.contract.id)).toContain('pol-1');
  });

  it('sorts by volume descending and caps per category (D-08/D-14)', () => {
    const matches = [
      newsMatch({ ...financeContract, id: 'fin-a', volume24h: 30_000 }, newsItem('yahoo', 'Fed raises rates')),
      newsMatch({ ...financeContract, id: 'fin-b', volume24h: 90_000 }, newsItem('yahoo', 'Fed cuts rates')),
      newsMatch({ ...financeContract, id: 'fin-c', volume24h: 60_000 }, newsItem('yahoo', 'Fed holds rates')),
    ];
    const view = buildMarketDrivenNews(matches, [], 10_000, 2);
    const finance = view.categories.finance;
    expect(finance.map((i) => i.contract.id)).toEqual(['fin-b', 'fin-c']);
    expect(finance.length).toBe(2);
  });

  it('includes a watchlisted contract with no volume (D-05)', () => {
    const noVol: MarketContract = { ...politicsContract, id: 'novol-1', volume24h: undefined };
    const view = buildMarketDrivenNews(
      [newsMatch(noVol, newsItem('yahoo', 'Senate passes tariff bill'))],
      [{ contractId: 'novol-1', platform: 'polymarket', question: noVol.question, addedAt: Date.now() }],
      10_000,
      20,
    );
    const all = [...view.categories.finance, ...view.categories.politics, ...view.categories.technology];
    expect(all.map((i) => i.contract.id)).toContain('novol-1');
  });

  it('backfills a NewsItem without category on read (Pitfall 2)', () => {
    const noCatNews = newsItem('yahoo', 'Senate passes tariff bill on tech imports');
    delete (noCatNews as { category?: string }).category;
    const view = buildMarketDrivenNews([newsMatch(politicsContract, noCatNews)], watchlist, 10_000, 20);
    expect(view.categories.politics.map((i) => i.contract.id)).toContain('pol-1');
  });

  it('sets builtAt and returns empty categories when no matches', () => {
    const view = buildMarketDrivenNews([], [], 10_000, 20);
    expect(view.builtAt).toBeGreaterThan(0);
    expect(view.categories.finance).toEqual([]);
    expect(view.categories.politics).toEqual([]);
    expect(view.categories.technology).toEqual([]);
  });
});
