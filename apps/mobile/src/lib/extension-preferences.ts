import AsyncStorage from '@react-native-async-storage/async-storage';

const SEARCH_EXTENSION_KEY = 'search_extension_id_v1';
const ACQUISITION_EXTENSION_KEY = 'acquisition_extension_id_v1';
const DISCOVERY_EXTENSION_KEY = 'discovery_extension_id_v1';

export function readDiscoveryExtensionId(): Promise<string | null> {
  return AsyncStorage.getItem(DISCOVERY_EXTENSION_KEY);
}

export async function writeDiscoveryExtensionId(id: string | null): Promise<void> {
  if (id) await AsyncStorage.setItem(DISCOVERY_EXTENSION_KEY, id);
  else await AsyncStorage.removeItem(DISCOVERY_EXTENSION_KEY);
}

export function readSearchExtensionId(): Promise<string | null> {
  return AsyncStorage.getItem(SEARCH_EXTENSION_KEY);
}

export async function writeSearchExtensionId(id: string | null): Promise<void> {
  if (id) await AsyncStorage.setItem(SEARCH_EXTENSION_KEY, id);
  else await AsyncStorage.removeItem(SEARCH_EXTENSION_KEY);
}

export function readAcquisitionExtensionId(): Promise<string | null> {
  return AsyncStorage.getItem(ACQUISITION_EXTENSION_KEY);
}

export async function writeAcquisitionExtensionId(id: string | null): Promise<void> {
  if (id) await AsyncStorage.setItem(ACQUISITION_EXTENSION_KEY, id);
  else await AsyncStorage.removeItem(ACQUISITION_EXTENSION_KEY);
}
