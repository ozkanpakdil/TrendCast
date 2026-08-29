/**
 * Settings component — configure collection interval, enabled sources,
 * and highlight threshold.
 *
 * No API keys needed — the extension is 100% client-side.
 */

import React, { useState } from 'react';
import type { ExtensionSettings, CorrelationEngine } from '@/types';
import { CONFIG } from '@/config';

interface SettingsProps {
  settings: ExtensionSettings;
  onUpdate: (partial: Partial<ExtensionSettings>) => void;
}

export function Settings({ settings, onUpdate }: SettingsProps) {
  return (
    <div className="space-y-4">
      {/* Collection interval */}
      <Section title="Collection">
        <label className="block">
          <span className="text-xs text-slate-400">Collection interval (minutes)</span>
          <input
            type="number"
            min={5}
            max={1440}
            value={settings.collectionIntervalMinutes}
            onChange={(e) =>
              onUpdate({ collectionIntervalMinutes: parseInt(e.target.value) || 60 })
            }
            className="w-full mt-1 px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded focus:outline-none focus:border-brand-400"
          />
          <span className="text-[10px] text-slate-500 mt-0.5 block">
            How often the background worker collects data (default: 60 = hourly)
          </span>
        </label>
      </Section>

      {/* Correlation Engine */}
      <Section title="Correlation Engine">
        <p className="text-[10px] text-slate-500 mb-2">
          Choose how TrendCast matches social signals and news to prediction markets.
          ML models run locally in your browser — no API keys, no server calls.
          Models download on first use (~10–120 MB depending on model) and are cached.
        </p>

        {/* Engine selector */}
        <div className="space-y-1.5">
          {(
            [
              ['heuristic', '🧮 Heuristic (NER + keywords)', 'Fast, no download'],
              ['embedding', '🧠 Embedding (semantic similarity)', 'Best semantic matching'],
              ['sentiment', '📊 Sentiment (transformer classifier)', 'Sentiment-aware matching'],
              ['ner', '🏷️ ML NER (transformer entity extraction)', 'Best entity extraction'],
              ['llm', '🤖 LLM (text generation)', 'LLM-based correlation'],
            ] as [CorrelationEngine, string, string][]
          ).map(([engine, label, desc]) => (
            <label
              key={engine}
              className={`flex items-start gap-2 text-xs py-1.5 px-2 rounded cursor-pointer transition-colors ${
                settings.correlationEngine === engine
                  ? 'bg-brand-500/20 border border-brand-400'
                  : 'bg-slate-800 hover:bg-slate-750 border border-transparent'
              }`}
            >
              <input
                type="radio"
                name="correlationEngine"
                checked={settings.correlationEngine === engine}
                onChange={() => onUpdate({ correlationEngine: engine })}
                className="accent-brand-500 mt-0.5"
              />
              <span>
                <span className="text-slate-300 block">{label}</span>
                <span className="text-[10px] text-slate-500">{desc}</span>
              </span>
            </label>
          ))}
        </div>

        {/* Embedding model selector */}
        {settings.correlationEngine === 'embedding' && (
          <div className="mt-2 pl-4 border-l-2 border-brand-400/30">
            <span className="text-[10px] text-slate-500 block mb-1">Embedding model:</span>
            <select
              value={settings.embeddingModel}
              onChange={(e) =>
                onUpdate({ embeddingModel: e.target.value as ExtensionSettings['embeddingModel'] })
              }
              className="w-full px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded focus:outline-none focus:border-brand-400"
            >
              {CONFIG.ml.embeddingModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Sentiment model selector */}
        {settings.correlationEngine === 'sentiment' && (
          <div className="mt-2 pl-4 border-l-2 border-brand-400/30">
            <span className="text-[10px] text-slate-500 block mb-1">Sentiment model:</span>
            <select
              value={settings.sentimentModel}
              onChange={(e) =>
                onUpdate({ sentimentModel: e.target.value as ExtensionSettings['sentimentModel'] })
              }
              className="w-full px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded focus:outline-none focus:border-brand-400"
            >
              {CONFIG.ml.sentimentModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* NER model selector */}
        {settings.correlationEngine === 'ner' && (
          <div className="mt-2 pl-4 border-l-2 border-brand-400/30">
            <span className="text-[10px] text-slate-500 block mb-1">NER model:</span>
            <select
              value={settings.nerModel}
              onChange={(e) =>
                onUpdate({ nerModel: e.target.value as ExtensionSettings['nerModel'] })
              }
              className="w-full px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded focus:outline-none focus:border-brand-400"
            >
              {CONFIG.ml.nerModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* LLM model selector */}
        {settings.correlationEngine === 'llm' && (
          <div className="mt-2 pl-4 border-l-2 border-brand-400/30">
            <span className="text-[10px] text-slate-500 block mb-1">LLM model:</span>
            <select
              value={settings.llmModel}
              onChange={(e) =>
                onUpdate({ llmModel: e.target.value as ExtensionSettings['llmModel'] })
              }
              className="w-full px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded focus:outline-none focus:border-brand-400"
            >
              {CONFIG.ml.llmModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <p className="text-[10px] text-slate-500 mt-2">
          ⚠️ ML models download on first use. The first correlation run with an ML
          engine will be slower as the model loads. Subsequent runs use the cached model.
        </p>
      </Section>

      {/* Data sources */}
      <Section title="Data Sources">
        <p className="text-[10px] text-slate-500 mb-2">
          Enable or disable data sources. TikTok is collected automatically via
          a background tab; X requires you to visit the site for the content
          script to scrape data.
        </p>
        <div className="space-y-1.5">
          {(
            [
              ['polymarket', '🔵 Polymarket'],
              ['kalshi', '🟢 Kalshi'],
              ['x', '𝕏 X (Twitter)'],
              ['reddit', '👽 Reddit'],
              ['tiktok', '🎵 TikTok'],
              ['bbc', '📰 BBC News'],
              ['cnn', '📰 CNN'],
              ['seekingalpha', '📰 Seeking Alpha'],
              ['investing', '📰 Investing.com'],
              ['usaStocksIndicator', '📰 Stock Indicator'],
              ['stockScreener', '📰 Breakout'],
              ['stockScreener2', '📰 VCP'],
            ] as [keyof ExtensionSettings['enabledSources'], string][]
          ).map(([source, label]) => (
            <label
              key={source}
              className="flex items-center justify-between text-xs py-1 px-2 rounded bg-slate-800 hover:bg-slate-750 transition-colors cursor-pointer"
            >
              <span className="text-slate-300">{label}</span>
              <input
                type="checkbox"
                checked={settings.enabledSources[source]}
                onChange={(e) =>
                  onUpdate({
                    enabledSources: {
                      ...settings.enabledSources,
                      [source]: e.target.checked,
                    },
                  })
                }
                className="accent-brand-500"
              />
            </label>
          ))}
        </div>
      </Section>

      {/* Reddit Subreddits */}
      <Section title="Reddit Subreddits">
        <p className="text-[10px] text-slate-500 mb-2">
          Choose which subreddits to collect trending posts from. Pick a preset
          category or manually add/remove subreddits. TrendCast focuses on
          finance &amp; stock market correlation by default.
        </p>

        {/* Category presets */}
        <div className="space-y-1.5 mb-3">
          <span className="text-[10px] text-slate-500 block">Preset categories:</span>
          {Object.entries(CONFIG.scrape.redditCategories).map(([key, cat]) => {
            const catSubs = [...cat.subreddits];
            const activeSubs = settings.redditSubreddits ?? [];
            const isActive =
              activeSubs.length === catSubs.length &&
              catSubs.every((s) => activeSubs.includes(s));
            return (
              <button
                key={key}
                type="button"
                onClick={() => onUpdate({ redditSubreddits: catSubs })}
                className={`w-full text-left text-xs py-1.5 px-2 rounded transition-colors border ${
                  isActive
                    ? 'bg-brand-500/20 border-brand-400 text-slate-200'
                    : 'bg-slate-800 hover:bg-slate-750 border-transparent text-slate-300'
                }`}
              >
                {cat.label}
                <span className="text-[10px] text-slate-500 block ml-1">
                  r/{catSubs.join(', r/')}
                </span>
              </button>
            );
          })}
        </div>

        {/* Manual subreddit list */}
        <RedditSubEditor
          subreddits={settings.redditSubreddits ?? []}
          onChange={(redditSubreddits) => onUpdate({ redditSubreddits })}
        />
      </Section>

      {/* Highlight threshold */}
      <Section title="Display">
        <label className="block">
          <span className="text-xs text-slate-400">
            Highlight threshold: {settings.highlightThreshold}/100
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={settings.highlightThreshold}
            onChange={(e) =>
              onUpdate({ highlightThreshold: parseInt(e.target.value) })
            }
            className="w-full mt-1 accent-brand-500"
          />
          <span className="text-[10px] text-slate-500 mt-0.5 block">
            Social signals with virality above this score are highlighted in the dashboard
          </span>
        </label>

        {/* Theme toggle (Phase 3) */}
        <label className="flex items-center justify-between text-xs py-1 px-2 rounded bg-slate-800 cursor-pointer mt-2">
          <span className="text-slate-300">🌙 Dark mode</span>
          <input
            type="checkbox"
            checked={settings.theme === 'dark'}
            onChange={(e) => onUpdate({ theme: e.target.checked ? 'dark' : 'light' })}
            className="accent-brand-500"
          />
        </label>
        <p className="text-[10px] text-slate-500 mt-1">
          Toggle between dark and light dashboard themes.
        </p>
      </Section>

      {/* New tab override */}
      <Section title="New Tab">
        <label className="flex items-center justify-between text-xs py-1 px-2 rounded bg-slate-800 cursor-pointer">
          <span className="text-slate-300">Override new tab with dashboard</span>
          <input
            type="checkbox"
            checked={settings.overrideNewTab}
            onChange={(e) => onUpdate({ overrideNewTab: e.target.checked })}
            className="accent-brand-500"
          />
        </label>
        <p className="text-[10px] text-slate-500 mt-1">
          When enabled, opening a new tab shows the TrendCast dashboard.
          Disable to keep your browser&apos;s default new tab page.
        </p>
      </Section>

      {/* Correlation alerts (Phase 4) */}
      <Section title="Alerts">
        <label className="flex items-center justify-between text-xs py-1 px-2 rounded bg-slate-800 cursor-pointer">
          <span className="text-slate-300">🔔 Correlation alerts</span>
          <input
            type="checkbox"
            checked={settings.alertsEnabled}
            onChange={(e) => onUpdate({ alertsEnabled: e.target.checked })}
            className="accent-brand-500"
          />
        </label>
        <p className="text-[10px] text-slate-500 mt-1">
          Notify me when a watchlisted market shows a new or changed correlation.
        </p>

        <label className="block mt-3">
          <span className="text-xs text-slate-400">Alert cooldown (minutes)</span>
          <input
            type="number"
            min={1}
            max={1440}
            value={settings.alertCooldownMinutes}
            onChange={(e) =>
              onUpdate({ alertCooldownMinutes: parseInt(e.target.value) || 60 })
            }
            className="w-full mt-1 px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded focus:outline-none focus:border-brand-400"
          />
          <span className="text-[10px] text-slate-500 mt-0.5 block">
            Minimum time between alerts for the same market (default: 60).
          </span>
        </label>
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
        {title}
      </h3>
      {children}
    </div>
  );
}

/**
 * Inline editor for the user's custom subreddit list.
 * Shows chips with remove buttons and an input to add new subreddits.
 */
function RedditSubEditor({
  subreddits,
  onChange,
}: {
  subreddits: string[];
  onChange: (subs: string[]) => void;
}) {
  const [input, setInput] = useState('');

  const addSub = () => {
    const cleaned = input
      .replace(/^r\//, '')
      .replace(/^\/r\//, '')
      .replace(/\s+/g, '')
      .trim();
    if (!cleaned) return;
    if (subreddits.some((s) => s.toLowerCase() === cleaned.toLowerCase())) {
      setInput('');
      return;
    }
    onChange([...subreddits, cleaned]);
    setInput('');
  };

  const removeSub = (sub: string) => {
    onChange(subreddits.filter((s) => s !== sub));
  };

  return (
    <div>
      <span className="text-[10px] text-slate-500 block mb-1">Active subreddits:</span>
      <div className="flex flex-wrap gap-1 mb-2 min-h-[28px]">
        {subreddits.length === 0 && (
          <span className="text-[10px] text-slate-600 italic">No subreddits configured</span>
        )}
        {subreddits.map((sub) => (
          <span
            key={sub}
            className="inline-flex items-center gap-1 text-[10px] bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-slate-300"
          >
            r/{sub}
            <button
              type="button"
              onClick={() => removeSub(sub)}
              className="text-slate-500 hover:text-red-400 transition-colors"
              aria-label={`Remove r/${sub}`}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addSub();
            }
          }}
          placeholder="e.g. options"
          className="flex-1 px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded focus:outline-none focus:border-brand-400"
        />
        <button
          type="button"
          onClick={addSub}
          className="px-2 py-1 text-xs bg-brand-500 hover:bg-brand-400 text-white rounded transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  );
}