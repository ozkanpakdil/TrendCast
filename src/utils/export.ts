/**
 * Data export utilities — CSV and JSON export of collected data.
 *
 * Allows users to download their collected markets, signals, news,
 * and correlations for external analysis or backup.
 */

import type {
  CorrelationMatch,
  MarketContract,
  NewsCorrelationMatch,
  NewsItem,
  SocialSignal,
} from '@/types';

interface ExportData {
  markets: MarketContract[];
  signals: SocialSignal[];
  news: NewsItem[];
  correlations: {
    matches: CorrelationMatch[];
    newsMatches: NewsCorrelationMatch[];
  };
}

/**
 * Escape a value for CSV (handle commas, quotes, newlines).
 */
function csvEscape(value: unknown): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert an array of objects to CSV format.
 */
function toCsv(rows: Record<string, unknown>[], headers: string[]): string {
  const headerLine = headers.join(',');
  const dataLines = rows.map((row) =>
    headers.map((h) => csvEscape(row[h])).join(','),
  );
  return [headerLine, ...dataLines].join('\n');
}

/**
 * Export all collected data as a multi-section CSV string.
 * Each data type is preceded by a section header comment.
 */
export function exportToCsv(data: ExportData): string {
  const sections: string[] = [];

  // Markets
  sections.push('# Markets');
  sections.push(
    toCsv(
      data.markets.map((m) => ({
        id: m.id,
        platform: m.platform,
        question: m.question,
        volume24h: m.volume24h ?? '',
        endDate: m.endDate ?? '',
        outcomes: m.outcomes.map((o) => `${o.label}:${(o.price * 100).toFixed(0)}%`).join(' | '),
        lastUpdated: m.lastUpdated,
      })),
      ['id', 'platform', 'question', 'volume24h', 'endDate', 'outcomes', 'lastUpdated'],
    ),
  );

  // Signals
  sections.push('\n# Social Signals');
  sections.push(
    toCsv(
      data.signals.map((s) => ({
        id: s.id,
        platform: s.platform,
        text: s.text,
        author: s.author,
        likes: s.metrics.likes,
        shares: s.metrics.shares,
        comments: s.metrics.comments,
        views: s.metrics.views ?? '',
        sentiment: s.sentiment.toFixed(3),
        virality: s.virality.toFixed(1),
        timestamp: s.timestamp,
        keywords: s.keywords.join(' | '),
      })),
      ['id', 'platform', 'text', 'author', 'likes', 'shares', 'comments', 'views', 'sentiment', 'virality', 'timestamp', 'keywords'],
    ),
  );

  // News
  sections.push('\n# News');
  sections.push(
    toCsv(
      data.news.map((n) => ({
        id: n.id,
        source: n.source,
        headline: n.headline,
        summary: n.summary ?? '',
        url: n.url,
        publishedAt: n.publishedAt,
        keywords: n.keywords.join(' | '),
        category: n.category ?? '',
      })),
      ['id', 'source', 'headline', 'summary', 'url', 'publishedAt', 'keywords', 'category'],
    ),
  );

  // Correlations
  sections.push('\n# Correlations (Social → Market)');
  sections.push(
    toCsv(
      data.correlations.matches.map((c) => ({
        signalId: c.signal.id,
        signalPlatform: c.signal.platform,
        signalText: c.signal.text,
        contractId: c.contract.id,
        contractPlatform: c.contract.platform,
        contractQuestion: c.contract.question,
        confidence: c.confidence.toFixed(3),
        matchedKeywords: c.matchedKeywords.join(' | '),
        correlatedAt: c.correlatedAt,
      })),
      ['signalId', 'signalPlatform', 'signalText', 'contractId', 'contractPlatform', 'contractQuestion', 'confidence', 'matchedKeywords', 'correlatedAt'],
    ),
  );

  // News Correlations
  sections.push('\n# Correlations (News → Market)');
  sections.push(
    toCsv(
      data.correlations.newsMatches.map((c) => ({
        newsId: c.news.id,
        newsSource: c.news.source,
        newsHeadline: c.news.headline,
        contractId: c.contract.id,
        contractPlatform: c.contract.platform,
        contractQuestion: c.contract.question,
        confidence: c.confidence.toFixed(3),
        matchedKeywords: c.matchedKeywords.join(' | '),
        correlatedAt: c.correlatedAt,
      })),
      ['newsId', 'newsSource', 'newsHeadline', 'contractId', 'contractPlatform', 'contractQuestion', 'confidence', 'matchedKeywords', 'correlatedAt'],
    ),
  );

  return sections.join('\n');
}

/**
 * Export all collected data as a JSON string.
 */
export function exportToJson(data: ExportData): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      ...data,
    },
    null,
    2,
  );
}

/**
 * Trigger a browser download of the exported data.
 */
export function downloadExport(data: string, filename: string, mimeType: string): void {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}