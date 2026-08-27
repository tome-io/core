import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Settings {
  localLibraryLocation: string | null; // Local books and download destination
  moonReaderBackupLocation: string | null; // Moon+ Reader backup folder only
  progressSyncLocation: string | null; // Provider-neutral shared progress folder
  folderPickerLocations: Record<FolderLocationSetting, string | null>;
}

export type FolderLocationSetting =
  | 'localLibraryLocation'
  | 'moonReaderBackupLocation'
  | 'progressSyncLocation';

const EMPTY_FOLDER_PICKER_LOCATIONS: Settings['folderPickerLocations'] = {
  localLibraryLocation: null,
  moonReaderBackupLocation: null,
  progressSyncLocation: null,
};

export const DEFAULT_SETTINGS: Settings = {
  localLibraryLocation: null,
  moonReaderBackupLocation: null,
  progressSyncLocation: null,
  folderPickerLocations: EMPTY_FOLDER_PICKER_LOCATIONS,
};

const SETTINGS_KEY = 'app_settings_v1';
export async function loadSettings(): Promise<Settings> {
  const settings: Settings = { ...DEFAULT_SETTINGS };
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
        if (!(key in parsed)) continue;
        (settings as any)[key] = parsed[key];
      }
      const storedPickerLocations =
        parsed.folderPickerLocations && typeof parsed.folderPickerLocations === 'object'
          ? parsed.folderPickerLocations
          : {};
      settings.folderPickerLocations = {
        ...EMPTY_FOLDER_PICKER_LOCATIONS,
        ...storedPickerLocations,
      };
      if (!settings.localLibraryLocation && typeof parsed.downloadLocation === 'string') {
        settings.localLibraryLocation = parsed.downloadLocation;
      }
    }
  } catch {
    /* start fresh */
  }
  return settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
