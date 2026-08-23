/**
 * Hook to read and update extension settings from chrome.storage.
 * Settings now use the new client-side shape (no API keys).
 */

import { useState, useEffect, useCallback } from 'react';
import { browser } from '@/messaging/browser';
import { CONFIG } from '@/config';
import type { ExtensionSettings } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';
import { deepMergeSettings } from '@/utils/settings';

export function useSettings() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);

  const load = useCallback(async () => {
    const result = await browser.storage.local.get(CONFIG.storage.settings);
    const stored = result[CONFIG.storage.settings] as Partial<ExtensionSettings> | undefined;
    // Deep-merge so newly-added fields (e.g. seekingalpha/investing source flags)
    // are always present even if the user has older saved settings, while explicit
    // user preferences are preserved.
    setSettings(deepMergeSettings(DEFAULT_SETTINGS, stored));
  }, []);

  const updateSettings = useCallback(async (partial: Partial<ExtensionSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      browser.storage.local.set({ [CONFIG.storage.settings]: next });
      return next;
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { settings, updateSettings };
}