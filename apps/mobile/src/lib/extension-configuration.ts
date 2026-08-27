import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  ExtensionConfigField,
  ExtensionConfigValue,
  ExtensionManifest,
} from '@tomeio/extension-protocol';

import { secureDelete, secureGet, secureSet } from './secure';

const CONFIG_PREFIX = 'extension_config_v1';

function storageKey(extensionId: string, fieldKey: string): string {
  return `${CONFIG_PREFIX}.${extensionId}.${fieldKey}`;
}

function defaultValue(field: ExtensionConfigField): ExtensionConfigValue | undefined {
  return field.default;
}

export async function readExtensionConfiguration(
  manifest: ExtensionManifest
): Promise<Record<string, ExtensionConfigValue>> {
  const entries = await Promise.all(
    (manifest.config ?? []).map(async (field) => {
      const key = storageKey(manifest.id, field.key);
      const stored =
        field.type === 'password' ? await secureGet(key) : await AsyncStorage.getItem(key);
      if (stored == null) return [field.key, defaultValue(field)] as const;
      if (field.type === 'checkbox') return [field.key, stored === 'true'] as const;
      if (field.type === 'number') {
        const number = Number(stored);
        return [field.key, Number.isFinite(number) ? number : defaultValue(field)] as const;
      }
      return [field.key, stored] as const;
    })
  );

  return Object.fromEntries(
    entries.filter((entry): entry is readonly [string, ExtensionConfigValue] => entry[1] != null)
  );
}

export async function writeExtensionConfiguration(
  manifest: ExtensionManifest,
  values: Record<string, ExtensionConfigValue>
): Promise<void> {
  await Promise.all(
    (manifest.config ?? []).map(async (field) => {
      const key = storageKey(manifest.id, field.key);
      const value = values[field.key];
      if (value == null || value === '') {
        if (field.type === 'password') await secureDelete(key);
        else await AsyncStorage.removeItem(key);
        return;
      }
      const serialized = String(value);
      if (field.type === 'password') await secureSet(key, serialized);
      else await AsyncStorage.setItem(key, serialized);
    })
  );
}

export async function removeExtensionConfiguration(manifest: ExtensionManifest): Promise<void> {
  await Promise.all(
    (manifest.config ?? []).map(async (field) => {
      const key = storageKey(manifest.id, field.key);
      if (field.type === 'password') await secureDelete(key);
      else await AsyncStorage.removeItem(key);
    })
  );
}

export function missingRequiredConfiguration(
  manifest: ExtensionManifest,
  values: Record<string, ExtensionConfigValue>
): string[] {
  return (manifest.config ?? [])
    .filter((field) => field.required)
    .filter((field) => {
      const value = values[field.key];
      return value == null || (typeof value === 'string' && !value.trim());
    })
    .map((field) => field.key);
}
