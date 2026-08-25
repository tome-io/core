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
const VALID_KEY = /^[a-zA-Z0-9._-]+$/;

function validatedKey(key: string): string {
  if (!VALID_KEY.test(key)) {
    throw new Error(
      'Secure storage keys may contain only letters, numbers, dots, dashes, and underscores.'
    );
  }
  return key;
}

export async function secureGet(key: string): Promise<string | null> {
  const storageKey = validatedKey(key);
  if (await available()) {
    return SecureStore.getItemAsync(storageKey);
  }
  return AsyncStorage.getItem(PREFIX + storageKey);
}

export async function secureSet(key: string, value: string): Promise<void> {
  const storageKey = validatedKey(key);
  if (await available()) {
    await SecureStore.setItemAsync(storageKey, value);
  } else {
    await AsyncStorage.setItem(PREFIX + storageKey, value);
  }
}

export async function secureDelete(key: string): Promise<void> {
  const storageKey = validatedKey(key);
  if (await available()) {
    await SecureStore.deleteItemAsync(storageKey);
  } else {
    await AsyncStorage.removeItem(PREFIX + storageKey);
  }
}
