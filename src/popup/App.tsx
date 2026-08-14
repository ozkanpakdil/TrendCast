/**
 * Main popup application component.
 *
 * Tabs:
 *   - Dashboard: overview of correlated markets + social signals
 *   - Markets: browse cached prediction market contracts
 *   - Settings: configure API keys, polling interval, enabled platforms
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Dashboard } from './components/Dashboard';
import { MarketsView } from './components/MarketsView';
import { Settings } from './components/Settings';
import { useCachedMarkets } from './hooks/useCachedMarkets';
import { useSettings } from './hooks/useSettings';

type Tab = 'dashboard' | 'markets' | 'settings';

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const { markets, loading: marketsLoading, refresh } = useCachedMarkets();
  const { settings, updateSettings } = useSettings();

  return (
    <div className="flex flex-col h-[500px] w-[380px] bg-slate-900 text-slate-100 font-sans">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <span className="text-xl">📊</span>
          <h1 className="text-base font-bold text-brand-400">HypeMarket</h1>
        </div>
        <button
          onClick={refresh}
          className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 transition-colors"
          title="Refresh market data"
        >
          {marketsLoading ? '⟳ Loading…' : '↻ Refresh'}
        </button>
      </header>

      {/* Tab navigation */}
      <nav className="flex border-b border-slate-700 bg-slate-800">
        {(['dashboard', 'markets', 'settings'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-xs font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'text-brand-400 border-b-2 border-brand-400 bg-slate-900'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </nav>

      {/* Tab content */}
      <main className="flex-1 overflow-y-auto p-3">
        {activeTab === 'dashboard' && <Dashboard markets={markets} settings={settings} />}
        {activeTab === 'markets' && <MarketsView markets={markets} loading={marketsLoading} />}
        {activeTab === 'settings' && (
          <Settings settings={settings} onUpdate={updateSettings} />
        )}
      </main>

      {/* Footer */}
      <footer className="px-4 py-2 bg-slate-800 border-t border-slate-700 text-[10px] text-slate-500 text-center">
        HypeMarket v0.1.0 · Sentiment × Prediction Markets
      </footer>
    </div>
  );
}