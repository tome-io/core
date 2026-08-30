import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Settings {
  localLibraryLocation: string | null; // Local books and download destination
  libraryMirrorLocation: string | null; // Optional Android on-device book mirror
  libraryMirrorEnabled: boolean;
  folderPickerLocations: Record<FolderLocationSetting, string | null>;
  libraryCatalogFilter: string;
  libraryCatalogSort: string;
  savedCatalogFilter: string;
  savedCatalogSort: string;
}

export type FolderLocationSetting = 'localLibraryLocation' | 'libraryMirrorLocation';

const EMPTY_FOLDER_PICKER_LOCATIONS: Settings['folderPickerLocations'] = {
  localLibraryLocation: null,
  libraryMirrorLocation: null,
};

export const DEFAULT_SETTINGS: Settings = {
  localLibraryLocation: null,
  libraryMirrorLocation: null,
  libraryMirrorEnabled: false,
  folderPickerLocations: EMPTY_FOLDER_PICKER_LOCATIONS,
  libraryCatalogFilter: 'all',
  libraryCatalogSort: 'recent',
  savedCatalogFilter: 'all',
  savedCatalogSort: 'recent',
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
