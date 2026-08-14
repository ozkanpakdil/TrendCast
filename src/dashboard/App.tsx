/**
 * Dashboard App — the main new tab page.
 *
 * Full-page React app showing aggregated hypes, news, market odds, and
 * correlations. This is the primary UI for TrendCast.
 *
 * Phase 3 additions:
 *   - Dark/light theme toggle
 *   - Watchlist tab (user-tracked markets)
 *   - History tab (historical charts)
 *   - Data export buttons (CSV/JSON)
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  Header: logo, last collection, collect, theme, export     │
 *   ├──────────────┬───────────────┬────────────────────────────┤
 *   │  Hype Feed   │  Market Odds  │  News Feed                  │
 *   │  (social)    │  (prediction) │  (BBC/CNN)                  │
 *   ├──────────────┴───────────────┴────────────────────────────┤
 *   │  Correlation Panel (signal→market, news→market)           │
 *   ├────────────────────────────────────────────────────────────┤
 *   │  Watchlist · History Charts                                │
 *   └──────────────────────────────────────────────────────────┘
 */

import { useState, useEffect, useCallback } from 'react';
import { HypeFeed } from './components/HypeFeed';
import { NewsFeed } from './components/NewsFeed';
import { MarketOdds } from './components/MarketOdds';
import { CorrelationPanel } from './components/CorrelationPanel';
import { HistoryChart } from './components/HistoryChart';
import { Watchlist } from './components/Watchlist';
import { useSnapshot } from './hooks/useSnapshot';
import { useCorrelations } from './hooks/useCorrelations';
import { DEFAULT_SETTINGS } from '@/types';
import type { ExtensionSettings, ThemeMode } from '@/types';
import { browser } from '@/messaging/browser';
import { CONFIG } from '@/config';
import { sendMessage } from '@/messaging';
import { downloadExport } from '@/utils/export';

// Build-time version stamp injected by Vite's define.
// Format: "0.1.0+2026-08-14T13:21:00Z" — version + build timestamp.
const BUILD_VERSION = import.meta.env.BUILD_VERSION ?? 'dev';

type Tab = 'feed' | 'markets' | 'news' | 'correlations' | 'watchlist' | 'history';

export function App() {
  const { snapshot, loading, collecting, lastCollectionAt, triggerCollection } = useSnapshot();
  const { correlations, loading: corrLoading, runCorrelation } = useCorrelations();
  const [activeTab, setActiveTab] = useState<Tab>('feed');
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [exporting, setExporting] = useState(false);

  // Load settings + theme
  useEffect(() => {
    browser.storage.local.get(CONFIG.storage.settings).then((result) => {
      const s = result[CONFIG.storage.settings] as ExtensionSettings | undefined;
      if (s) {
        setSettings(s);
        setTheme(s.theme ?? 'dark');
      }
    });
  }, []);

  // Apply theme to document root
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.remove('dark');
      root.classList.add('light');
    } else {
      root.classList.remove('light');
      root.classList.add('dark');
    }
  }, [theme]);

  // Auto-run correlation when snapshot updates
  useEffect(() => {
    if (snapshot && (snapshot.markets.length > 0 || snapshot.signals.length > 0)) {
      runCorrelation();
    }
  }, [snapshot, runCorrelation]);

  const toggleTheme = useCallback(async () => {
    const newTheme: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    const updated = { ...settings, theme: newTheme };
    setSettings(updated);
    try {
      await browser.storage.local.set({ [CONFIG.storage.settings]: updated });
    } catch (err) {
      console.error('[TrendCast] Failed to save theme:', err);
    }
  }, [theme, settings]);

  const handleExport = useCallback(async (format: 'csv' | 'json') => {
    setExporting(true);
    try {
      const result = await sendMessage('EXPORT_DATA', { format });
      if (result && typeof result === 'object' && 'data' in result) {
        const { data, filename } = result as { data: string; filename: string };
        const mimeType = format === 'csv' ? 'text/csv' : 'application/json';
        downloadExport(data, filename, mimeType);
      }
    } catch (err) {
      console.error('[TrendCast] Export failed:', err);
    } finally {
      setExporting(false);
    }
  }, []);

  const lastCollectionText = lastCollectionAt
    ? new Date(lastCollectionAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'Never';

  const stats = snapshot
    ? {
        markets: snapshot.markets.length,
        signals: snapshot.signals.length,
        news: snapshot.news.length,
      }
    : { markets: 0, signals: 0, news: 0 };

  // Theme-aware class helpers
  const isDark = theme === 'dark';
  const bgClass = isDark ? 'bg-slate-950 text-slate-100' : 'bg-light-bg text-light-text';
  const headerBg = isDark ? 'bg-slate-900/95 border-slate-800' : 'bg-light-surface/95 border-light-border';
  const footerBorder = isDark ? 'border-slate-800 text-slate-600' : 'border-light-border text-light-muted';
  const tabActive = 'text-brand-400 border-brand-400';
  const tabInactive = isDark
    ? 'text-slate-400 border-transparent hover:text-slate-200'
    : 'text-light-muted border-transparent hover:text-light-text';
  const sectionTitle = isDark ? 'text-slate-400' : 'text-light-muted';
  const btnSecondary = isDark
    ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
    : 'bg-slate-200 hover:bg-slate-300 text-slate-700';

  return (
    <div className={`min-h-screen ${bgClass} font-sans`}>
      {/* Header */}
      <header className={`sticky top-0 z-10 ${headerBg} backdrop-blur border-b`}>
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📊</span>
            <div>
              <h1 className="text-xl font-bold text-brand-400">TrendCast</h1>
              <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-light-muted'}`}>
                Sentiment × Markets · {stats.markets} markets · {stats.signals} signals · {stats.news} news
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className={`text-xs ${isDark ? 'text-slate-500' : 'text-light-muted'}`}>
              <span className="opacity-60">v{BUILD_VERSION}</span>
              {' · '}
              Last: <span className={isDark ? 'text-slate-300' : 'text-light-text'}>{lastCollectionText}</span>
            </div>

            {/* Export dropdown */}
            <div className="relative group">
              <button
                disabled={exporting}
                className={`text-xs px-3 py-2 rounded ${btnSecondary} disabled:opacity-50 transition-colors`}
                title="Export data"
              >
                {exporting ? '⟳' : '⬇'} Export
              </button>
              <div className={`absolute right-0 top-full mt-1 hidden group-hover:block z-20 rounded-lg border shadow-lg ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-light-border'}`}>
                <button
                  onClick={() => handleExport('csv')}
                  className={`block w-full text-left px-4 py-2 text-sm hover:bg-brand-500/10 ${isDark ? 'text-slate-300' : 'text-light-text'}`}
                >
                  📄 CSV
                </button>
                <button
                  onClick={() => handleExport('json')}
                  className={`block w-full text-left px-4 py-2 text-sm hover:bg-brand-500/10 ${isDark ? 'text-slate-300' : 'text-light-text'}`}
                >
                  📋 JSON
                </button>
              </div>
            </div>

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className={`text-lg px-2 py-1 rounded ${btnSecondary} transition-colors`}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle theme"
            >
              {isDark ? '☀️' : '🌙'}
            </button>

            {/* Collect Now */}
            <button
              onClick={triggerCollection}
              disabled={collecting}
              className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              {collecting ? '⟳ Collecting…' : '↻ Collect Now'}
            </button>
          </div>
        </div>

        {/* Tab navigation */}
        <nav className="max-w-7xl mx-auto px-6 flex gap-1 overflow-x-auto">
          {([
            ['feed', '🔥 Hype Feed'],
            ['markets', '📈 Markets'],
            ['news', '📰 News'],
            ['correlations', '🔗 Correlations'],
            ['watchlist', '⭐ Watchlist'],
            ['history', '📊 History'],
          ] as [Tab, string][]).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab ? tabActive : tabInactive
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className={isDark ? 'text-slate-500' : 'text-light-muted'}>Loading…</div>
          </div>
        ) : (
          <>
            {activeTab === 'feed' && (
              <section>
                <h2 className={`text-sm font-bold uppercase tracking-wider mb-3 ${sectionTitle}`}>
                  🔥 Trending Hypes — Virality Heatmap
                </h2>
                <HypeFeed
                  signals={snapshot?.signals ?? []}
                  highlightThreshold={settings.highlightThreshold}
                />
              </section>
            )}

            {activeTab === 'markets' && (
              <section>
                <h2 className={`text-sm font-bold uppercase tracking-wider mb-3 ${sectionTitle}`}>
                  📈 Prediction Market Odds — Volume Heatmap
                </h2>
                <MarketOdds markets={snapshot?.markets ?? []} />
              </section>
            )}

            {activeTab === 'news' && (
              <section>
                <h2 className={`text-sm font-bold uppercase tracking-wider mb-3 ${sectionTitle}`}>
                  📰 Latest News
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <NewsFeed news={snapshot?.news ?? []} />
                </div>
              </section>
            )}

            {activeTab === 'correlations' && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className={`text-sm font-bold uppercase tracking-wider ${sectionTitle}`}>
                    🔗 Correlated Signals & News
                  </h2>
                  <button
                    onClick={runCorrelation}
                    disabled={corrLoading}
                    className={`text-xs px-3 py-1.5 rounded ${btnSecondary} disabled:opacity-50 transition-colors`}
                  >
                    {corrLoading ? '⟳ Analyzing…' : '↻ Re-analyze'}
                  </button>
                </div>
                <CorrelationPanel
                  matches={correlations?.matches ?? []}
                  newsMatches={correlations?.newsMatches ?? []}
                  newsSocialMatches={correlations?.newsSocialMatches ?? []}
                />
              </section>
            )}

            {activeTab === 'watchlist' && (
              <section>
                <h2 className={`text-sm font-bold uppercase tracking-wider mb-3 ${sectionTitle}`}>
                  ⭐ Your Watchlist
                </h2>
                <Watchlist markets={snapshot?.markets ?? []} />
              </section>
            )}

            {activeTab === 'history' && (
              <section>
                <h2 className={`text-sm font-bold uppercase tracking-wider mb-3 ${sectionTitle}`}>
                  📊 Historical Trends
                </h2>
                <HistoryChart />
              </section>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className={`border-t mt-12 py-6 text-center text-xs ${footerBorder}`}>
        TrendCast · 100% client-side · No API keys · Uses your browser sessions
      </footer>
    </div>
  );
}