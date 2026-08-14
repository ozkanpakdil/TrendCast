/**
 * Settings component — configure API keys, polling interval, enabled platforms.
 *
 * ⚠️ Pitfall: API keys are stored in chrome.storage.local, which is NOT
 *    encrypted. For production, consider using chrome.storage.session
 *    (MV3, in-memory only) or a native messaging host for key management.
 *    Never store keys in code or manifest.json.
 */

import React, { useState } from 'react';
import type { ExtensionSettings } from '@/types';

interface SettingsProps {
  settings: ExtensionSettings;
  onUpdate: (partial: Partial<ExtensionSettings>) => void;
}

export function Settings({ settings, onUpdate }: SettingsProps) {
  const [showKeys, setShowKeys] = useState(false);

  return (
    <div className="space-y-4">
      {/* Polling interval */}
      <Section title="Polling">
        <label className="block">
          <span className="text-xs text-slate-400">Refresh interval (minutes)</span>
          <input
            type="number"
            min={1}
            max={60}
            value={settings.pollIntervalMinutes}
            onChange={(e) => onUpdate({ pollIntervalMinutes: parseInt(e.target.value) || 5 })}
            className="w-full mt-1 px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded focus:outline-none focus:border-brand-400"
          />
        </label>
      </Section>

      {/* Enabled platforms */}
      <Section title="Social Platforms">
        <div className="space-y-1">
          {(['x', 'reddit', 'tiktok'] as const).map((platform) => (
            <label key={platform} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={settings.enabledPlatforms[platform]}
                onChange={(e) =>
                  onUpdate({
                    enabledPlatforms: {
                      ...settings.enabledPlatforms,
                      [platform]: e.target.checked,
                    },
                  })
                }
                className="rounded"
              />
              <span className="capitalize text-slate-300">{platform}</span>
            </label>
          ))}
        </div>
      </Section>

      {/* Notification threshold */}
      <Section title="Notifications">
        <label className="block">
          <span className="text-xs text-slate-400">
            Virality threshold: {settings.notificationThreshold}/100
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={settings.notificationThreshold}
            onChange={(e) =>
              onUpdate({ notificationThreshold: parseInt(e.target.value) })
            }
            className="w-full mt-1 accent-brand-500"
          />
        </label>
      </Section>

      {/* API keys */}
      <Section
        title="API Keys"
        action={
          <button
            onClick={() => setShowKeys(!showKeys)}
            className="text-[10px] text-brand-400 hover:underline"
          >
            {showKeys ? 'Hide' : 'Show'}
          </button>
        }
      >
        <p className="text-[10px] text-slate-500 mb-2">
          Keys are stored locally in your browser. Never shared or sent to any server
          except the respective API.
        </p>
        <div className="space-y-2">
          <KeyInput
            label="Reddit Client ID"
            value={settings.apiKeys.redditClientId ?? ''}
            hidden={!showKeys}
            onChange={(v) =>
              onUpdate({ apiKeys: { ...settings.apiKeys, redditClientId: v } })
            }
          />
          <KeyInput
            label="Reddit Client Secret"
            value={settings.apiKeys.redditClientSecret ?? ''}
            hidden={!showKeys}
            onChange={(v) =>
              onUpdate({ apiKeys: { ...settings.apiKeys, redditClientSecret: v } })
            }
          />
          <KeyInput
            label="X (Twitter) Bearer Token"
            value={settings.apiKeys.xBearer ?? ''}
            hidden={!showKeys}
            onChange={(v) =>
              onUpdate({ apiKeys: { ...settings.apiKeys, xBearer: v } })
            }
          />
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function KeyInput({
  label,
  value,
  hidden,
  onChange,
}: {
  label: string;
  value: string;
  hidden: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] text-slate-500">{label}</span>
      <input
        type={hidden ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Not set"
        className="w-full mt-0.5 px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded focus:outline-none focus:border-brand-400 font-mono"
      />
    </label>
  );
}