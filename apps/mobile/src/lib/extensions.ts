import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ExtensionRegistry,
  type ExtensionRegistryStore,
  type InstalledExtension,
} from '@readoi/extension-runtime';
import { officialExtensionManifests } from '@readoi/official-extensions';

const EXTENSION_REGISTRY_KEY = 'third_party_extensions_v1';

class AsyncStorageExtensionStore implements ExtensionRegistryStore {
  async read(): Promise<InstalledExtension[]> {
    const value = await AsyncStorage.getItem(EXTENSION_REGISTRY_KEY);
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      throw new Error('The saved third-party extension registry is invalid.');
    }
    return parsed as InstalledExtension[];
  }

  async write(extensions: InstalledExtension[]): Promise<void> {
    await AsyncStorage.setItem(EXTENSION_REGISTRY_KEY, JSON.stringify(extensions));
  }
}

export const extensionRegistry = new ExtensionRegistry(
  new AsyncStorageExtensionStore(),
  officialExtensionManifests
);
