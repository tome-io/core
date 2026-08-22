import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/**
 * SDK 57's expo-secure-store has no web implementation (the native module is an
 * empty stub on web), so every call throws there. These wrappers degrade to
 * plain AsyncStorage when the Keychain isn't available.
 */

let secureAvailable: boolean | null = null;

async function available(): Promise<boolean> {
  if (secureAvailable === null) {
    try {
      secureAvailable = await SecureStore.isAvailableAsync();
    } catch {
      secureAvailable = false;
    }
  }
  return secureAvailable;
}

const PREFIX = 'secure_';

export async function secureGet(key: string): Promise<string | null> {
  if (await available()) {
    return SecureStore.getItemAsync(key);
  }
  return AsyncStorage.getItem(PREFIX + key);
}

export async function secureSet(key: string, value: string): Promise<void> {
  if (await available()) {
    await SecureStore.setItemAsync(key, value);
  } else {
    await AsyncStorage.setItem(PREFIX + key, value);
  }
}

export async function secureDelete(key: string): Promise<void> {
  if (await available()) {
    await SecureStore.deleteItemAsync(key);
  } else {
    await AsyncStorage.removeItem(PREFIX + key);
  }
}
