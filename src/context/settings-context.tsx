import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext } from 'react';

import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '@/lib/settings';
import { secureDelete } from '@/lib/secure';

export interface SettingsContextValue {
  settings: Settings;
  ready: boolean;
  /** Patch settings, persist them, and clear the zlib session when credentials change. */
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
export async function forgetMirror() {
  await AsyncStorage.removeItem('zlib_domain');
}

export async function clearZlibSession() {
  await secureDelete('zlib_remix_userid');
  await secureDelete('zlib_remix_userkey');
}
