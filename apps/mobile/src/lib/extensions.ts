import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ExtensionLoader,
  ExtensionRegistry,
  type ExtensionRegistryStore,
  type InstalledExtension,
} from '@tomeio/extension-runtime';
import { officialExtensionManifests, officialExtensions } from '@tomeio/official-extensions';

import { fetchCommunityExtensions } from './community-extensions';
import { createMobileDeviceExtensionHost } from './device-extension-host';
import { koboExtensionHost } from './kobo-extension-host';

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

export async function refreshCommunityExtensionRegistry(): Promise<void> {
  extensionRegistry.setCommunity(await fetchCommunityExtensions());
}

export const extensionLoader = new ExtensionLoader({
  bundled: new Map(officialExtensions.map((extension) => [extension.manifest.id, extension])),
  host: new Map([['tomeio-sync-kobo', koboExtensionHost]]),
  device: createMobileDeviceExtensionHost(),
});
