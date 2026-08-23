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

import { useState, useEffect, useCallback, useRef } from 'react';
import { HypeFeed } from './components/HypeFeed';
import { NewsFeed } from './components/NewsFeed';
import { MarketOdds } from './components/MarketOdds';
import { CorrelationPanel } from './components/CorrelationPanel';
import { CorrelationStatsBar } from './components/CorrelationStatsBar';
import { SourceHealthIndicator } from './components/SourceHealthIndicator';
import { CorrelationRunHistory } from './components/CorrelationRunHistory';
import { HistoryChart } from './components/HistoryChart';
import { Watchlist } from './components/Watchlist';
import { AlertsTab } from './components/AlertsTab';
import { MarketDrivenNews } from './components/MarketDrivenNews';
import { FAQContent } from './components/FAQContent';
import { Settings } from '../popup/components/Settings';
import { useSnapshot } from './hooks/useSnapshot';
import { useCorrelations } from './hooks/useCorrelations';
import { useAlerts } from './hooks/useAlerts';
import { useMarketNews } from './hooks/useMarketNews';
import { DEFAULT_SETTINGS } from '@/types';
import type { ExtensionSettings, ThemeMode, CorrelationEngine } from '@/types';
import { CONFIG } from '@/config';
import { browser } from '@/messaging/browser';
import { sendMessage } from '@/messaging';
import { downloadExport } from '@/utils/export';
import { computeCorrelatedCounts } from '@/utils/source-health';

// Build-time version stamp injected by Vite's define.
// Format: "0.1.0+2026-08-14T13:21:00Z" — version + build timestamp.
const BUILD_VERSION = import.meta.env.BUILD_VERSION ?? 'dev';

type Tab = 'feed' | 'markets' | 'news' | 'correlations' | 'watchlist' | 'alerts' | 'market-news' | 'history' | 'community' | 'faq' | 'settings';

/** Human-readable label for ML correlation phases. */
function phaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    'loading-model': 'Loading model…',
    'embedding-contracts': 'Embedding contracts',
    'embedding-signals': 'Embedding signals',
    'embedding-news': 'Embedding news',
    'comparing-signals': 'Comparing signals→markets',
    'comparing-news': 'Comparing news→markets',
    'comparing-news-social': 'Comparing news→social',
    'classifying-signals': 'Classifying signal sentiment',
    'classifying-news': 'Classifying news sentiment',
    'classifying-news-social': 'Classifying news→social',
    'zero-shot-signals': 'Zero-shot classifying signals',
    'zero-shot-news': 'Zero-shot classifying news',
    'zero-shot-news-social': 'Zero-shot classifying news→social',
    'ner-extracting-contracts': 'Extracting contract entities',
    'ner-extracting-signals': 'Extracting signal entities',
    'ner-extracting-news': 'Extracting news entities',
    'ner-comparing-signals': 'Comparing signals→markets',
    'ner-comparing-news': 'Comparing news→markets',
    'ner-comparing-news-social': 'Comparing news→social',
    'llm-generating-signals': 'LLM scoring signals',
    'llm-generating-news': 'LLM scoring news',
    'llm-generating-news-social': 'LLM scoring news→social',
    'done': 'Done',
  };
  return labels[phase] ?? phase;
}

export function App() {
  const { snapshot, loading, error: snapshotError, collecting, lastCollectionAt, triggerCollection } = useSnapshot();
  const { correlations, loading: corrLoading, error: corrError, progress: corrProgress, elapsedMs, runCorrelation, cancelCorrelation, runStats, runHistory } = useCorrelations();
  const { alerts, loading: alertsLoading, error: alertsError, clearAlerts } = useAlerts();
  const { view: marketNewsView, loading: marketNewsLoading } = useMarketNews();
  const [activeTab, setActiveTab] = useState<Tab>('feed');
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [exporting, setExporting] = useState(false);

  // Load settings + theme
  useEffect(() => {
    browser.storage.local.get(CONFIG.storage.settings).then((result) => {
      const s = result[CONFIG.storage.settings] as Partial<ExtensionSettings> | undefined;
      // Merge with defaults so newly-added fields (e.g. redditSubreddits)
      // are always present even if the user has older saved settings.
      const merged = { ...DEFAULT_SETTINGS, ...s };
      setSettings(merged);
      setTheme(merged.theme ?? 'dark');
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

  // Pre-compute correlations when the dashboard first loads with data.
  // The background worker already pre-computes after collection, but this
  // ensures fresh correlations are available even if the background worker
  // was idle (e.g., user opened a new tab between alarm intervals).
  // The useCorrelations hook loads cached results from storage on mount,
  // so this effect only fires a background re-compute if needed.
  const corrInitRef = useRef(false);
  useEffect(() => {
    // Only run once per dashboard session, and only if we have data
    if (corrInitRef.current) return;
    if (!snapshot) return;
    if (snapshot.markets.length === 0 && snapshot.signals.length === 0) return;
    corrInitRef.current = true;
    // Fire and forget — the hook loads cached results from storage first,
    // and this ensures a fresh computation in the background.
    const initModel =
      settings.correlationEngine === 'embedding' ? settings.embeddingModel
      : settings.correlationEngine === 'sentiment' ? settings.sentimentModel
      : settings.correlationEngine === 'zeroshot' ? settings.zeroShotModel
      : settings.correlationEngine === 'ner' ? settings.nerModel
      : settings.correlationEngine === 'llm' ? settings.llmModel
      : settings.embeddingModel;
    runCorrelation(settings.correlationEngine, initModel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

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

  // Update settings and persist to storage
  const updateSettings = useCallback((partial: Partial<ExtensionSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      browser.storage.local.set({ [CONFIG.storage.settings]: next });
      return next;
    });
  }, []);

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
            ['alerts', '🔔 Alerts'],
            ['market-news', '📰 Market News'],
            ['history', '📊 History'],
            ['community', '💬 Community'],
            ['faq', '❓ FAQ'],
            ['settings', '⚙️ Settings'],
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
                <HypeFeed
                  signals={snapshot?.signals ?? []}
                  highlightThreshold={settings.highlightThreshold}
                />
              </section>
            )}

            {activeTab === 'markets' && (
              <section>
                <MarketOdds markets={snapshot?.markets ?? []} />
              </section>
            )}

            {activeTab === 'news' && (
              <section>
                <h2 className={`text-sm font-bold uppercase tracking-wider mb-3 ${sectionTitle}`}>
                  📰 Latest News
                </h2>
                <SourceHealthIndicator
                  health={snapshot?.sourceHealth ?? {}}
                  correlatedCounts={computeCorrelatedCounts(correlations?.newsMatches ?? [])}
                  isDark={isDark}
                  loading={loading}
                  error={snapshotError}
                />
                <NewsFeed news={snapshot?.news ?? []} />
              </section>
            )}

            {activeTab === 'correlations' && (
              <section>
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h2 className={`text-sm font-bold uppercase tracking-wider ${sectionTitle}`}>
                    🔗 Correlated Signals & News
                  </h2>
                  <div className="flex items-center gap-2">
                    {/* Engine selector */}
                    <select
                      value={settings.correlationEngine}
                      onChange={(e) => {
                        const engine = e.target.value as CorrelationEngine;
                        setSettings({ ...settings, correlationEngine: engine });
                        browser.storage.local.set({
                          [CONFIG.storage.settings]: { ...settings, correlationEngine: engine },
                        });
                      }}
                      className={`text-xs px-2 py-1.5 rounded border ${
                        isDark
                          ? 'bg-slate-800 border-slate-700 text-slate-300'
                          : 'bg-white border-light-border text-light-text'
                      } focus:outline-none focus:border-brand-400`}
                      title="Correlation engine"
                    >
                      <option value="heuristic">🧮 Heuristic</option>
                      <option value="embedding">🧠 Embedding</option>
                      <option value="sentiment">📊 Sentiment</option>
                      <option value="zeroshot">🎯 Zero-Shot(Slow)</option>
                      <option value="ner">🏷️ ML NER(Slow)</option>
                      <option value="llm">🤖 LLM(Slowest)</option>
                    </select>

                    {/* Model selector (shown for ML engines) */}
                    {settings.correlationEngine === 'embedding' && (
                      <select
                        value={settings.embeddingModel}
                        onChange={(e) => {
                          const model = e.target.value as ExtensionSettings['embeddingModel'];
                          setSettings({ ...settings, embeddingModel: model });
                          browser.storage.local.set({
                            [CONFIG.storage.settings]: { ...settings, embeddingModel: model },
                          });
                        }}
                        className={`text-xs px-2 py-1.5 rounded border ${
                          isDark
                            ? 'bg-slate-800 border-slate-700 text-slate-300'
                            : 'bg-white border-light-border text-light-text'
                        } focus:outline-none focus:border-brand-400`}
                        title="Embedding model"
                      >
                        {CONFIG.ml.embeddingModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    )}

                    {settings.correlationEngine === 'sentiment' && (
                      <select
                        value={settings.sentimentModel}
                        onChange={(e) => {
                          const model = e.target.value as ExtensionSettings['sentimentModel'];
                          setSettings({ ...settings, sentimentModel: model });
                          browser.storage.local.set({
                            [CONFIG.storage.settings]: { ...settings, sentimentModel: model },
                          });
                        }}
                        className={`text-xs px-2 py-1.5 rounded border ${
                          isDark
                            ? 'bg-slate-800 border-slate-700 text-slate-300'
                            : 'bg-white border-light-border text-light-text'
                        } focus:outline-none focus:border-brand-400`}
                        title="Sentiment model"
                      >
                        {CONFIG.ml.sentimentModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    )}

                    {settings.correlationEngine === 'zeroshot' && (
                      <select
                        value={settings.zeroShotModel}
                        onChange={(e) => {
                          const model = e.target.value as ExtensionSettings['zeroShotModel'];
                          setSettings({ ...settings, zeroShotModel: model });
                          browser.storage.local.set({
                            [CONFIG.storage.settings]: { ...settings, zeroShotModel: model },
                          });
                        }}
                        className={`text-xs px-2 py-1.5 rounded border ${
                          isDark
                            ? 'bg-slate-800 border-slate-700 text-slate-300'
                            : 'bg-white border-light-border text-light-text'
                        } focus:outline-none focus:border-brand-400`}
                        title="Zero-shot model"
                      >
                        {CONFIG.ml.zeroShotModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    )}

                    {settings.correlationEngine === 'ner' && (
                      <select
                        value={settings.nerModel}
                        onChange={(e) => {
                          const model = e.target.value as ExtensionSettings['nerModel'];
                          setSettings({ ...settings, nerModel: model });
                          browser.storage.local.set({
                            [CONFIG.storage.settings]: { ...settings, nerModel: model },
                          });
                        }}
                        className={`text-xs px-2 py-1.5 rounded border ${
                          isDark
                            ? 'bg-slate-800 border-slate-700 text-slate-300'
                            : 'bg-white border-light-border text-light-text'
                        } focus:outline-none focus:border-brand-400`}
                        title="NER model"
                      >
                        {CONFIG.ml.nerModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    )}

                    {settings.correlationEngine === 'llm' && (
                      <select
                        value={settings.llmModel}
                        onChange={(e) => {
                          const model = e.target.value as ExtensionSettings['llmModel'];
                          setSettings({ ...settings, llmModel: model });
                          browser.storage.local.set({
                            [CONFIG.storage.settings]: { ...settings, llmModel: model },
                          });
                        }}
                        className={`text-xs px-2 py-1.5 rounded border ${
                          isDark
                            ? 'bg-slate-800 border-slate-700 text-slate-300'
                            : 'bg-white border-light-border text-light-text'
                        } focus:outline-none focus:border-brand-400`}
                        title="LLM model"
                      >
                        {CONFIG.ml.llmModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    )}

                    {/* Re-analyze / Cancel button */}
                    {corrLoading ? (
                      <button
                        onClick={cancelCorrelation}
                        className={`text-xs px-3 py-1.5 rounded ${
                          isDark
                            ? 'bg-red-900/80 text-red-200 hover:bg-red-800'
                            : 'bg-red-100 text-red-700 hover:bg-red-200'
                        } transition-colors whitespace-nowrap`}
                        title="Cancel ML correlation"
                      >
                        ✕ Cancel
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          const model =
                            settings.correlationEngine === 'embedding'
                              ? settings.embeddingModel
                              : settings.correlationEngine === 'sentiment'
                              ? settings.sentimentModel
                              : settings.correlationEngine === 'zeroshot'
                              ? settings.zeroShotModel
                              : settings.correlationEngine === 'ner'
                              ? settings.nerModel
                              : settings.correlationEngine === 'llm'
                              ? settings.llmModel
                              : settings.embeddingModel;
                          runCorrelation(settings.correlationEngine, model);
                        }}
                        className={`text-xs px-3 py-1.5 rounded ${btnSecondary} transition-colors whitespace-nowrap`}
                      >
                        ↻ Re-analyze
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress bar + timer for ML engines */}
                {corrLoading && corrProgress && (
                  <div className={`mb-3 p-3 rounded-lg border text-xs ${
                    isDark ? 'bg-slate-900/80 border-slate-700' : 'bg-slate-50 border-light-border'
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className={`font-medium ${isDark ? 'text-slate-300' : 'text-light-text'}`}>
                        {corrProgress.engine === 'embedding' ? '🧠 Embedding' : corrProgress.engine === 'sentiment' ? '📊 Sentiment' : corrProgress.engine === 'zeroshot' ? '🎯 Zero-Shot' : corrProgress.engine === 'ner' ? '🏷️ NER' : '🤖 LLM'} · {corrProgress.model}
                      </span>
                      <span className={`tabular-nums ${isDark ? 'text-slate-400' : 'text-light-muted'}`}>
                        ⏱ {Math.floor(elapsedMs / 1000)}s
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-light-muted'} whitespace-nowrap`}>
                        {phaseLabel(corrProgress.phase)}
                      </span>
                      <div className={`flex-1 h-2 rounded-full overflow-hidden ${
                        isDark ? 'bg-slate-800' : 'bg-slate-200'
                      }`}>
                        <div
                          className="h-full bg-brand-500 rounded-full transition-all duration-300"
                          style={{
                            width: `${corrProgress.total > 0 ? Math.min(100, (corrProgress.current / corrProgress.total) * 100) : 0}%`,
                          }}
                        />
                      </div>
                      <span className={`text-[10px] tabular-nums ${isDark ? 'text-slate-400' : 'text-light-muted'} whitespace-nowrap`}>
                        {corrProgress.current}/{corrProgress.total}
                      </span>
                    </div>
                  </div>
                )}

                {/* Loading indicator without progress (heuristic or waiting for worker) */}
                {corrLoading && !corrProgress && (
                  <div className={`mb-3 p-3 rounded-lg border text-xs ${
                    isDark ? 'bg-slate-900/80 border-slate-700' : 'bg-slate-50 border-light-border'
                  }`}>
                    <div className="flex items-center gap-2">
                      <span className="animate-spin inline-block w-3 h-3 border-2 border-brand-500 border-t-transparent rounded-full" />
                      <span className={isDark ? 'text-slate-300' : 'text-light-text'}>
                        {settings.correlationEngine === 'heuristic'
                          ? 'Computing correlations…'
                          : 'Loading ML model… this may take a while on first run.'}
                      </span>
                      {settings.correlationEngine !== 'heuristic' && (
                        <span className={`ml-auto tabular-nums ${isDark ? 'text-slate-400' : 'text-light-muted'}`}>
                          ⏱ {Math.floor(elapsedMs / 1000)}s
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {corrError && (
                  <div
                    className={`mb-3 p-3 rounded-lg border text-xs ${
                      isDark
                        ? 'bg-red-950/50 border-red-800 text-red-300'
                        : 'bg-red-50 border-red-300 text-red-700'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-base shrink-0">⚠️</span>
                      <div className="space-y-1.5">
                        <p className="font-semibold">ML Engine Error</p>
                        <p>{corrError}</p>
                        <p className={`text-[10px] ${isDark ? 'text-red-400/70' : 'text-red-600/70'}`}>
                          Choose a different engine or model from the dropdown above, or switch to
                          🧮 Heuristic which requires no downloads.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {!corrError && settings.correlationEngine !== 'heuristic' && (
                  <p className={`text-[10px] mb-3 ${isDark ? 'text-slate-500' : 'text-light-muted'}`}>
                    ⚠️ ML engine selected — first run downloads the model ({settings.correlationEngine === 'embedding' ? '~23–33 MB' : settings.correlationEngine === 'sentiment' ? '~67–134 MB' : settings.correlationEngine === 'zeroshot' ? '~67–110 MB' : settings.correlationEngine === 'ner' ? '~110–340 MB' : '~270 MB–2.3 GB'}) and may take longer. Model is cached for subsequent runs.
                  </p>
                )}

                <CorrelationStatsBar stats={runStats} isDark={isDark} />

                <SourceHealthIndicator
                  health={snapshot?.sourceHealth ?? {}}
                  correlatedCounts={computeCorrelatedCounts(correlations?.newsMatches ?? [])}
                  isDark={isDark}
                  loading={loading}
                  error={snapshotError}
                />

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

            {activeTab === 'alerts' && (
              <section>
                <h2 className={`text-sm font-bold uppercase tracking-wider mb-3 ${sectionTitle}`}>
                  🔔 Correlation Alerts
                </h2>
                <AlertsTab
                  alerts={alerts}
                  loading={alertsLoading}
                  error={alertsError}
                  onClear={clearAlerts}
                  isDark={isDark}
                />
              </section>
            )}

            {activeTab === 'market-news' && (
              <section>
                <h2 className={`text-sm font-bold uppercase tracking-wider mb-3 ${sectionTitle}`}>
                  📰 Market News
                </h2>
                <MarketDrivenNews
                  view={marketNewsView}
                  loading={marketNewsLoading}
                  isDark={isDark}
                />
              </section>
            )}

            {activeTab === 'history' && (
              <section className="space-y-6">
                <div>
                  <h2 className={`text-sm font-bold uppercase tracking-wider mb-3 ${sectionTitle}`}>
                    📊 Historical Trends
                  </h2>
                  <HistoryChart />
                </div>

                <div>
                  <CorrelationRunHistory
                    history={runHistory}
                    isDark={isDark}
                    onClear={() => {
                      // Force re-read from storage by updating state
                      // The hook already manages this state
                    }}
                  />
                </div>
              </section>
            )}

            {activeTab === 'community' && (
              <section className="max-w-2xl mx-auto py-8 space-y-6">
                <div className="text-center space-y-2">
                  <h2 className={`text-2xl font-bold ${isDark ? 'text-slate-100' : 'text-light-text'}`}>
                    💬 Join the TrendCast Community
                  </h2>
                  <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-light-muted'}`}>
                    Connect with other users, share insights, report bugs, and stay updated on new features.
                  </p>
                </div>

                {/* Telegram card */}
                <div className={`rounded-xl border p-6 space-y-3 ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-light-surface border-light-border'}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">💬</span>
                    <div>
                      <h3 className={`text-lg font-bold ${isDark ? 'text-slate-100' : 'text-light-text'}`}>Telegram Group</h3>
                      <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-light-muted'}`}>General chat · Announcements · Quick questions</p>
                    </div>
                  </div>
                  <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-light-muted'}`}>
                    Join our public Telegram group to discuss prediction markets, social sentiment trends,
                    and feature requests with other TrendCast users.
                  </p>
                  <a
                    href={CONFIG.community.telegram}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block px-5 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium transition-colors"
                  >
                    💬 Join on Telegram →
                  </a>
                </div>

                {/* GitHub Issues card */}
                <div className={`rounded-xl border p-6 space-y-3 ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-light-surface border-light-border'}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">🐛</span>
                    <div>
                      <h3 className={`text-lg font-bold ${isDark ? 'text-slate-100' : 'text-light-text'}`}>GitHub Issues</h3>
                      <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-light-muted'}`}>Bug reports · Feature requests</p>
                    </div>
                  </div>
                  <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-light-muted'}`}>
                    Found a bug or have a feature idea? Open an issue on GitHub. This is the best way
                    to track and resolve problems.
                  </p>
                  <a
                    href={CONFIG.community.githubIssues}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-block px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${btnSecondary}`}
                  >
                    🐛 Report on GitHub →
                  </a>
                </div>

                {/* Privacy note */}
                <div className={`rounded-lg p-4 text-xs text-center ${isDark ? 'bg-slate-900/50 text-slate-500' : 'bg-light-surface/50 text-light-muted'}`}>
                  🔒 TrendCast is 100% client-side. These links open external sites in a new tab.
                  No data is ever sent to Telegram, GitHub, or any server.
                </div>
              </section>
            )}

            {activeTab === 'faq' && (
              <section>
                <FAQContent isDark={isDark} />
              </section>
            )}

            {activeTab === 'settings' && (
              <section className="max-w-2xl mx-auto">
                <h2 className={`text-sm font-bold uppercase tracking-wider mb-4 ${sectionTitle}`}>
                  ⚙️ Settings
                </h2>
                <div className={`rounded-xl border p-6 ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-light-surface border-light-border'}`}>
                  <Settings settings={settings} onUpdate={updateSettings} />
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className={`border-t mt-12 py-6 text-center text-xs space-y-1 ${footerBorder}`}>
        <div>TrendCast · 100% client-side · No API keys · Uses your browser sessions</div>
        <div>
          <a
            href={CONFIG.community.telegram}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-400 hover:text-brand-300 transition-colors"
          >
            💬 Join the community on Telegram
          </a>
        </div>
      </footer>
    </div>
  );
}