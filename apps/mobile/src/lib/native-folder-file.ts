import * as FileSystem from 'expo-file-system/legacy';

import {
  copyNativeFileToLocal,
  isNativeFolderLocation,
} from '../../modules/expo-progress-folder/src';

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function safeFilename(uri: string, requested?: string): string {
  const encodedName = uri.split('?')[0]?.split('/').pop() || 'file';
  let fallback = encodedName;
  try {
    fallback = decodeURIComponent(encodedName);
  } catch {
    // Preserve the encoded path component if it is malformed.
  }
  const filename = (requested || fallback || 'file').replace(/[^a-z0-9._-]+/gi, '-');
  return `${stableHash(uri)}-${filename || 'file'}`;
}

export async function materializeNativeFolderFile(
  uri: string,
  requestedFilename?: string
): Promise<string> {
  if (!isNativeFolderLocation(uri)) return uri;
  if (!FileSystem.cacheDirectory) throw new Error('The app cache is unavailable.');
  const destination = `${FileSystem.cacheDirectory}native-folder/${safeFilename(
    uri,
    requestedFilename
  )}`;
  await copyNativeFileToLocal(uri, destination);
  return destination;
}
