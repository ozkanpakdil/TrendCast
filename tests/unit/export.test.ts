/**
 * Unit tests for export coverage (D-01, D-02, D-03).
 *
 * Verifies the `# News` CSV section gains a trailing `category` column while
 * all existing sections/columns stay unchanged (backward-compatible, append-only),
 * the JSON export includes `category` on news objects, and no separate
 * `# Market-Driven News` section is added.
 */

import { describe, it, expect } from 'vitest';
import { exportToCsv, exportToJson } from '@/utils/export';
import { mockContract, mockSignal, newsItem } from './fixtures';

// Local fixture shape mirroring the (private) ExportData interface.
interface ExportDataFixture {
  markets: typeof mockContract[];
  signals: typeof mockSignal[];
  news: ReturnType<typeof newsItem>[];
  correlations: {
    matches: { contract: typeof mockContract; signal: typeof mockSignal; confidence: number; matchedKeywords: string[]; correlatedAt: number }[];
    newsMatches: { contract: typeof mockContract; news: ReturnType<typeof newsItem>; confidence: number; matchedKeywords: string[]; correlatedAt: number }[];
  };
}

function fullData(): ExportDataFixture {
  return {
    markets: [mockContract],
    signals: [mockSignal],
    news: [newsItem('cnn', 'Bitcoin rally')],
    correlations: {
      matches: [
        { contract: mockContract, signal: mockSignal, confidence: 0.8, matchedKeywords: ['btc'], correlatedAt: 1 },
      ],
      newsMatches: [
        { contract: mockContract, news: newsItem('cnn', 'Bitcoin rally'), confidence: 0.8, matchedKeywords: ['btc'], correlatedAt: 1 },
      ],
    },
  };
}

function section(csv: string, header: string): string[] {
  const lines = csv.split('\n');
  const idx = lines.findIndex((l) => l === header);
  if (idx === -1) return [];
  // Return the column header + following data rows until the next section marker.
  const out: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('#')) break;
    out.push(lines[i]);
  }
  return out;
}

describe('exportToCsv — News category trailing column (D-02)', () => {
  it('has `category` as the LAST column of the # News header, prior columns unchanged', () => {
    const csv = exportToCsv(fullData() as unknown as ExportDataFixture);
    const newsSection = section(csv, '# News');
    expect(newsSection[0]).toBe('id,source,headline,summary,url,publishedAt,keywords,category');
  });

  it('exports the category value in the last column of a news row', () => {
    const data = fullData();
    data.news = [{ ...newsItem('cnn', 'Bitcoin rally'), category: 'finance' }];
    const csv = exportToCsv(data as unknown as ExportDataFixture);
    const newsSection = section(csv, '# News');
    const row = newsSection[1];
    expect(row).toContain(',finance');
    expect(row.split(',').pop()).toBe('finance');
  });

  it('exports an empty string for a news item with no category (no undefined)', () => {
    const csv = exportToCsv(fullData() as unknown as ExportDataFixture);
    const newsSection = section(csv, '# News');
    const row = newsSection[1];
    expect(row).not.toContain('undefined');
    expect(row.split(',').pop()).toBe('');
  });
});

describe('exportToCsv — backward compatibility (D-01)', () => {
  it('locks the # Markets header unchanged', () => {
    const csv = exportToCsv(fullData() as unknown as ExportDataFixture);
    expect(section(csv, '# Markets')[0]).toBe('id,platform,question,volume24h,endDate,outcomes,lastUpdated');
  });

  it('locks the # Social Signals header unchanged', () => {
    const csv = exportToCsv(fullData() as unknown as ExportDataFixture);
    expect(section(csv, '# Social Signals')[0]).toBe('id,platform,text,author,likes,shares,comments,views,sentiment,virality,timestamp,keywords');
  });

  it('locks the # Correlations (Social → Market) header unchanged', () => {
    const csv = exportToCsv(fullData() as unknown as ExportDataFixture);
    expect(section(csv, '# Correlations (Social → Market)')[0]).toBe('signalId,signalPlatform,signalText,contractId,contractPlatform,contractQuestion,confidence,matchedKeywords,correlatedAt');
  });

  it('locks the # Correlations (News → Market) header unchanged', () => {
    const csv = exportToCsv(fullData() as unknown as ExportDataFixture);
    expect(section(csv, '# Correlations (News → Market)')[0]).toBe('newsId,newsSource,newsHeadline,contractId,contractPlatform,contractQuestion,confidence,matchedKeywords,correlatedAt');
  });
});

describe('exportToJson (D-02)', () => {
  it('includes a category field on news objects', () => {
    const data = fullData();
    data.news = [{ ...newsItem('cnn', 'Bitcoin rally'), category: 'finance' }];
    const parsed = JSON.parse(exportToJson(data as unknown as ExportDataFixture)) as { news: Array<{ category?: string }> };
    expect(parsed.news[0].category).toBe('finance');
  });
});

describe('no separate market-driven section (D-03)', () => {
  it('does not contain a # Market-Driven News section', () => {
    const csv = exportToCsv(fullData() as unknown as ExportDataFixture);
    expect(csv).not.toContain('# Market-Driven News');
  });
});
