/**
 * Hook to read and update extension settings from chrome.storage.
 */

import { useState, useEffect, useCallback } from 'react';
import { browser } from '@/messaging/browser';
import { CONFIG } from '@/config';
import type { ExtensionSettings } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';

export function useSettings() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);

  const load = useCallback(async () => {
    const result = await browser.storage.local.get(CONFIG.storage.settings);
    setSettings((result[CONFIG.storage.settings] as ExtensionSettings) ?? DEFAULT_SETTINGS);
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