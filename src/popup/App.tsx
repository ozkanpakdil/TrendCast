/**
 * Main popup application component — simplified quick-launcher.
 *
 * The popup is now a quick-launcher that shows:
 *   - Last collection time
 *   - "Open Dashboard" button (opens the new tab dashboard)
 *   - "Collect Now" button (triggers manual collection)
 *   - Source toggles (enable/disable each data source)
 *   - Quick stats from the latest snapshot
 *
 * The full dashboard is in the new tab override (src/dashboard/).
 */

import { useState, useCallback } from 'react';
import { Settings } from './components/Settings';
import { useSettings } from './hooks/useSettings';
import { useSnapshot } from './hooks/useSnapshot';
import { browser } from '@/messaging/browser';

// Build-time version stamp injected by Vite's define.
const BUILD_VERSION = import.meta.env.BUILD_VERSION ?? 'dev';

type Tab = 'home' | 'settings';

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const { settings, updateSettings } = useSettings();
  const { snapshot, collecting, lastCollectionAt, triggerCollection } = useSnapshot();

  const openDashboard = useCallback(() => {
    browser.tabs.create({ url: 'chrome://newtab' });
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

  return (
    <div className="flex flex-col h-[500px] w-[380px] bg-slate-900 text-slate-100 font-sans">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <span className="text-xl">📊</span>
          <h1 className="text-base font-bold text-brand-400">TrendCast</h1>
        </div>
        <nav className="flex gap-1">
          {(['home', 'settings'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                activeTab === tab
                  ? 'bg-brand-500 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab === 'home' ? '🏠 Home' : '⚙️ Settings'}
            </button>
          ))}
        </nav>
      </header>

      {/* Tab content */}
      <main className="flex-1 overflow-y-auto p-4">
        {activeTab === 'home' && (
          <div className="space-y-4">
            {/* Open Dashboard button */}
            <button
              onClick={openDashboard}
              className="w-full py-3 px-4 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
            >
              <span className="text-lg">🚀</span>
              Open Dashboard
            </button>

            {/* Collection controls */}
            <div className="rounded-lg bg-slate-800 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Last collection:</span>
                <span className="text-xs text-slate-200 font-medium">{lastCollectionText}</span>
              </div>
              <button
                onClick={triggerCollection}
                disabled={collecting}
                className="w-full py-2 px-3 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-200 text-xs font-medium transition-colors"
              >
                {collecting ? '⟳ Collecting…' : '↻ Collect Now'}
              </button>
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-3 gap-2">
              <StatCard label="Markets" value={stats.markets} icon="📈" />
              <StatCard label="Signals" value={stats.signals} icon="🔥" />
              <StatCard label="News" value={stats.news} icon="📰" />
            </div>

            {/* Enabled sources summary */}
            <div className="rounded-lg bg-slate-800 p-3">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
                Active Sources
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(settings.enabledSources).map(([source, enabled]) => (
                  <span
                    key={source}
                    className={`text-[10px] px-2 py-1 rounded-full font-medium ${
                      enabled
                        ? 'bg-brand-500/20 text-brand-300'
                        : 'bg-slate-700 text-slate-500'
                    }`}
                  >
                    {source}
                  </span>
                ))}
              </div>
            </div>

            {/* Info */}
            <p className="text-[10px] text-slate-500 text-center leading-relaxed">
              TrendCast runs entirely in your browser. No API keys, no servers.
              <br />
              Data is collected hourly using your own browser sessions.
            </p>
          </div>
        )}

        {activeTab === 'settings' && (
          <Settings settings={settings} onUpdate={updateSettings} />
        )}
      </main>

      {/* Footer */}
      <footer className="px-4 py-2 bg-slate-800 border-t border-slate-700 text-[10px] text-slate-500 text-center">
        TrendCast v{BUILD_VERSION} · 100% client-side · No API keys
      </footer>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: string;
}) {
  return (
    <div className="bg-slate-800 rounded-lg p-2 text-center">
      <div className="text-lg">{icon}</div>
      <div className="text-lg font-bold text-slate-200">{value}</div>
      <div className="text-[10px] text-slate-500 uppercase">{label}</div>
    </div>
  );
}