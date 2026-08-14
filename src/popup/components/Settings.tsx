/**
 * Settings component — configure collection interval, enabled sources,
 * and highlight threshold.
 *
 * No API keys needed — the extension is 100% client-side.
 */

import React from 'react';
import type { ExtensionSettings } from '@/types';

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

      {/* Data sources */}
      <Section title="Data Sources">
        <p className="text-[10px] text-slate-500 mb-2">
          Enable or disable data sources. Social platforms (X, TikTok) require
          you to visit those sites for content scripts to scrape data.
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
          Disable to keep your browser's default new tab page.
        </p>
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