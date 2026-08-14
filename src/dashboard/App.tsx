/**
 * Dashboard App — the main new tab page.
 *
 * Full-page React app showing aggregated hypes, news, market odds, and
 * correlations. This is the primary UI for HypeMarket.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  Header: logo, last collection time, collect button        │
 *   ├──────────────┬───────────────┬────────────────────────────┤
 *   │  Hype Feed   │  Market Odds  │  News Feed                  │
 *   │  (social)    │  (prediction) │  (BBC/CNN)                  │
 *   ├──────────────┴───────────────┴────────────────────────────┤
 *   │  Correlation Panel (signal→market, news→market)           │
 *   └──────────────────────────────────────────────────────────┘
 */

import { useState, useEffect } from 'react';
import { HypeFeed } from './components/HypeFeed';
import { NewsFeed } from './components/NewsFeed';
import { MarketOdds } from './components/MarketOdds';
import { CorrelationPanel } from './components/CorrelationPanel';
import { useSnapshot } from './hooks/useSnapshot';
import { useCorrelations } from './hooks/useCorrelations';
import { DEFAULT_SETTINGS } from '@/types';
import type { ExtensionSettings } from '@/types';
import { browser } from '@/messaging/browser';
import { CONFIG } from '@/config';

type Tab = 'feed' | 'markets' | 'news' | 'correlations';

export function App() {
  const { snapshot, loading, collecting, lastCollectionAt, triggerCollection } = useSnapshot();
  const { correlations, loading: corrLoading, runCorrelation } = useCorrelations();
  const [activeTab, setActiveTab] = useState<Tab>('feed');
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);

  // Load settings
  useEffect(() => {
    browser.storage.local.get(CONFIG.storage.settings).then((result) => {
      const s = result[CONFIG.storage.settings] as ExtensionSettings | undefined;
      if (s) setSettings(s);
    });
  }, []);

  // Auto-run correlation when snapshot updates
  useEffect(() => {
    if (snapshot && (snapshot.markets.length > 0 || snapshot.signals.length > 0)) {
      runCorrelation();
    }
  }, [snapshot, runCorrelation]);

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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📊</span>
            <div>
              <h1 className="text-xl font-bold text-brand-400">HypeMarket</h1>
              <p className="text-xs text-slate-500">
                Sentiment × Markets · {stats.markets} markets · {stats.signals} signals · {stats.news} news
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-xs text-slate-500">
              Last collection: <span className="text-slate-300 font-medium">{lastCollectionText}</span>
            </div>
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
        <nav className="max-w-7xl mx-auto px-6 flex gap-1">
          {([
            ['feed', '🔥 Hype Feed'],
            ['markets', '📈 Markets'],
            ['news', '📰 News'],
            ['correlations', '🔗 Correlations'],
          ] as [Tab, string][]).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'text-brand-400 border-brand-400'
                  : 'text-slate-400 border-transparent hover:text-slate-200'
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
            <div className="text-slate-500 text-lg">Loading…</div>
          </div>
        ) : (
          <>
            {activeTab === 'feed' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <section>
                  <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">
                    🔥 Trending Hypes
                  </h2>
                  <HypeFeed
                    signals={snapshot?.signals ?? []}
                    highlightThreshold={settings.highlightThreshold}
                  />
                </section>
              </div>
            )}

            {activeTab === 'markets' && (
              <section>
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">
                  📈 Prediction Market Odds
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  <MarketOdds markets={snapshot?.markets ?? []} />
                </div>
              </section>
            )}

            {activeTab === 'news' && (
              <section>
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">
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
                  <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider">
                    🔗 Correlated Signals & News
                  </h2>
                  <button
                    onClick={runCorrelation}
                    disabled={corrLoading}
                    className="text-xs px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 transition-colors"
                  >
                    {corrLoading ? '⟳ Analyzing…' : '↻ Re-analyze'}
                  </button>
                </div>
                <CorrelationPanel
                  matches={correlations?.matches ?? []}
                  newsMatches={correlations?.newsMatches ?? []}
                />
              </section>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 mt-12 py-6 text-center text-xs text-slate-600">
        HypeMarket · 100% client-side · No API keys · Uses your browser sessions
      </footer>
    </div>
  );
}