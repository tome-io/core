import AsyncStorage from '@react-native-async-storage/async-storage';
import { secureDelete, secureGet, secureSet } from './secure';

export interface Settings {
  email: string;
  password: string;
  remixUserId: string;
  remixUserKey: string;
  domain: string; // '' = auto
  preferredFormat: string; // '' = any
  googleBooksKey: string; // optional, enables ratings on detail screen
  downloadLocation: string | null; // SAF directory URI (Android), null = app documents dir
}

export const DEFAULT_SETTINGS: Settings = {
  email: '',
  password: '',
  remixUserId: '',
  remixUserKey: '',
  domain: '',
  preferredFormat: '',
  googleBooksKey: '',
  downloadLocation: null,
};

const SETTINGS_KEY = 'app_settings_v1';
// Fields stored outside AsyncStorage, in the device Keychain
export const SECURE_FIELDS = ['email', 'password', 'remixUserId', 'remixUserKey', 'googleBooksKey'] as const;
export type SecureField = (typeof SECURE_FIELDS)[number];

const SECURE_KEYS: Record<SecureField, string> = {
  email: 'zlib_email',
  password: 'zlib_password',
  remixUserId: 'remix_userid_paste',
  remixUserKey: 'remix_userkey_paste',
  googleBooksKey: 'google_books_key',
};

export async function loadSettings(): Promise<Settings> {
  const settings: Settings = { ...DEFAULT_SETTINGS };
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
        if (!(key in parsed)) continue;
        if ((SECURE_FIELDS as readonly string[]).includes(key)) continue;
        (settings as any)[key] = parsed[key];
      }
    }
  } catch {
    /* start fresh */
  }
  for (const field of SECURE_FIELDS) {
    const v = await secureGet(SECURE_KEYS[field]);
    if (v != null) (settings as any)[field] = v;
  }
  return settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  const insecure: Record<string, unknown> = {};
  for (const key of Object.keys(settings)) {
    if ((SECURE_FIELDS as readonly string[]).includes(key)) continue;
    insecure[key] = (settings as any)[key];
  }
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(insecure));

  for (const field of SECURE_FIELDS) {
    const value = settings[field] as string;
    if (value) {
      await secureSet(SECURE_KEYS[field], value);
    } else {
      await secureDelete(SECURE_KEYS[field]);
    }
  }
}
