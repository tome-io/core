import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import {
  getNativeProgressFolderDiagnostics,
  isNativeFolderLocation,
  pickNativeDirectory,
} from '../../modules/expo-progress-folder/src';

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 150);
}

export function bookFilename(book: {
  title: string;
  author?: string;
  authors?: string[];
  format?: string;
}): string {
  const base = [book.title, book.author || book.authors?.[0]].filter(Boolean).join(' - ');
  const ext = book.format ? `.${book.format.toLowerCase()}` : '.bin';
  return sanitize(base || 'book') + ext;
}

export function bookMimeType(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase();
  if (extension === 'epub') return 'application/epub+zip';
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'mobi') return 'application/x-mobipocket-ebook';
  if (extension === 'azw3') return 'application/vnd.amazon.ebook';
  return 'application/octet-stream';
}

/** True when the chosen location is an Android SAF content:// tree. */
export function isSafLocation(location: string | null | undefined): boolean {
  return !!location && location.startsWith('content:');
}

export function isExternalFolderLocation(
  location: string | null | undefined
): boolean {
  return isSafLocation(location) || isNativeFolderLocation(location);
}

export function folderLocationLabel(location: string): string {
  if (isNativeFolderLocation(location)) {
    try {
      return new URL(location).searchParams.get('name') || 'Selected folder';
    } catch {
      return 'Selected folder';
    }
  }
  if (isSafLocation(location)) {
    return decodeURIComponent(location.split('/').pop() || location);
  }
  return location;
}

export interface FolderLocationDescription {
  label: string;
  detail: string;
  kind: 'cloud' | 'device' | 'unknown';
}

function androidProviderLabel(authority: string | null): string {
  if (authority === 'com.google.android.apps.docs.storage') return 'Google Drive';
  if (authority === 'com.android.externalstorage.documents') return 'On-device storage';
  if (authority === 'com.android.providers.downloads.documents') return 'Downloads';
  if (authority === 'com.android.providers.media.documents') return 'Media storage';
  return 'Android document provider';
}

export async function describeFolderLocation(
  location: string
): Promise<FolderLocationDescription> {
  if (isSafLocation(location)) {
    const diagnostics = await getNativeProgressFolderDiagnostics(location);
    const provider = androidProviderLabel(diagnostics.authority);
    const kind = diagnostics.storageKind ?? 'unknown';
    const kindLabel =
      kind === 'cloud' ? 'Cloud storage' : kind === 'device' ? 'On-device storage' : 'Storage provider';
    return {
      label: diagnostics.displayName || folderLocationLabel(location),
      detail: provider === kindLabel ? kindLabel : `${provider} · ${kindLabel}`,
      kind,
    };
  }
  if (isNativeFolderLocation(location)) {
    return {
      label: folderLocationLabel(location),
      detail: 'Files folder',
      kind: 'unknown',
    };
  }
  return {
    label: folderLocationLabel(location),
    detail: 'Tomeio app storage · On-device storage',
    kind: 'device',
  };
}

// Supplying an initial URI prevents Android DocumentsUI from reopening at the
// unrelated folder most recently used by another picker in the app.
export const ANDROID_PRIMARY_STORAGE_ROOT =
  'content://com.android.externalstorage.documents/root/primary';

export async function pickDownloadFolder(
  initialDirectoryUri?: string | null
): Promise<{ uri: string } | null> {
  if (Platform.OS === 'ios') {
    return pickNativeDirectory(initialDirectoryUri);
  }
  if (Platform.OS !== 'android') {
    throw new Error('Choosing a custom folder is available on iOS and Android.');
  }
  const { StorageAccessFramework } = FileSystem;
  const permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync(
    initialDirectoryUri ?? ANDROID_PRIMARY_STORAGE_ROOT
  );
  if (!permissions.granted) return null;
  return { uri: permissions.directoryUri };
}
