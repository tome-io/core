import AsyncStorage from '@react-native-async-storage/async-storage';
import { secureDelete, secureGet, secureSet } from './secure';

export interface Settings {
  email: string;
  password: string;
  remixUserId: string;
  remixUserKey: string;
  domain: string; // '' = auto
  preferredFormat: string; // '' = any
  localLibraryLocation: string | null; // Local books and download destination
  moonReaderBackupLocation: string | null; // Moon+ Reader backup folder only
  progressSyncLocation: string | null; // Provider-neutral shared progress folder
}

export const DEFAULT_SETTINGS: Settings = {
  email: '',
  password: '',
  remixUserId: '',
  remixUserKey: '',
  domain: '',
  preferredFormat: '',
  localLibraryLocation: null,
  moonReaderBackupLocation: null,
  progressSyncLocation: null,
};

const SETTINGS_KEY = 'app_settings_v1';
const ZLIB_PINNED_DOMAIN_KEY = 'zlib_pinned_domain';
// Fields stored outside AsyncStorage, in the device Keychain
export const SECURE_FIELDS = ['email', 'password', 'remixUserId', 'remixUserKey'] as const;
export type SecureField = (typeof SECURE_FIELDS)[number];

const SECURE_KEYS: Record<SecureField, string> = {
  email: 'zlib_email',
  password: 'zlib_password',
  remixUserId: 'remix_userid_paste',
  remixUserKey: 'remix_userkey_paste',
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
      if (!settings.localLibraryLocation && typeof parsed.downloadLocation === 'string') {
        settings.localLibraryLocation = parsed.downloadLocation;
      }
    }
  } catch {
    /* start fresh */
  }
  if (settings.domain) {
    await AsyncStorage.setItem(ZLIB_PINNED_DOMAIN_KEY, settings.domain);
  } else {
    await AsyncStorage.removeItem(ZLIB_PINNED_DOMAIN_KEY);
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
  if (settings.domain) {
    await AsyncStorage.setItem(ZLIB_PINNED_DOMAIN_KEY, settings.domain);
  } else {
    await AsyncStorage.removeItem(ZLIB_PINNED_DOMAIN_KEY);
  }

  for (const field of SECURE_FIELDS) {
    const value = settings[field] as string;
    if (value) {
      await secureSet(SECURE_KEYS[field], value);
    } else {
      await secureDelete(SECURE_KEYS[field]);
    }
  }
}
