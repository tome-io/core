import { createContext, useContext } from 'react';

import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '@/lib/settings';

export interface SettingsContextValue {
  settings: Settings;
  ready: boolean;
  /** Patch and persist application-level settings. Provider settings live with extensions. */
  update: (patch: Partial<Settings>) => Promise<void>;
}

export const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  ready: false,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update: async (_patch) => {},
});

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}

export { loadSettings, saveSettings };

/** Persisted outside the provider: which mirror last answered. */
