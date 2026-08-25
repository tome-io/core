import * as FileSystem from 'expo-file-system/legacy';

import {
  createNativeProgressFolderFile,
  getNativeProgressFolderDiagnostics,
  hasNativeProgressFolder,
  listNativeProgressFolderFiles,
  readNativeProgressFolderFile,
  writeNativeProgressFolderFile,
  type ProgressFolderDiagnostics,
  type ProgressFolderFile,
} from '../../modules/expo-progress-folder/src';
import { filenameFromUri } from './book-metadata';

const GOOGLE_DRIVE_AUTHORITY = 'com.google.android.apps.docs.storage';

function isGoogleDriveFolder(uri: string): boolean {
  return uri.includes(`content://${GOOGLE_DRIVE_AUTHORITY}/`);
}

function requireSupportedProvider(directoryUri: string): void {
  if (isGoogleDriveFolder(directoryUri) && !hasNativeProgressFolder()) {
    throw new Error(
      'Google Drive progress sync requires the installed Readio development build. Run `bun run android` from the repository root; Expo Go cannot load the native Drive folder module.'
    );
  }
}

export async function listProgressFolderFiles(
  directoryUri: string
): Promise<ProgressFolderFile[]> {
  requireSupportedProvider(directoryUri);
  if (hasNativeProgressFolder()) {
    return listNativeProgressFolderFiles(directoryUri);
  }

  const children = await FileSystem.StorageAccessFramework.readDirectoryAsync(directoryUri);
  const files = await Promise.all(
    children.map(async (uri) => {
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists || info.isDirectory) return null;
      return {
        name: filenameFromUri(uri),
        uri,
        size: typeof info.size === 'number' ? info.size : null,
        modifiedAt:
          typeof info.modificationTime === 'number'
            ? info.modificationTime * 1000
            : null,
        mimeType: null,
      };
    })
  );
  return files.filter((file): file is ProgressFolderFile => file !== null);
}

export async function readProgressFolderFile(fileUri: string): Promise<string> {
  if (hasNativeProgressFolder()) {
    return readNativeProgressFolderFile(fileUri);
  }
  return FileSystem.readAsStringAsync(fileUri);
}

export async function createProgressFolderFile(
  directoryUri: string,
  filename: string,
  contents: string
): Promise<string> {
  requireSupportedProvider(directoryUri);
  if (hasNativeProgressFolder()) {
    return createNativeProgressFolderFile(directoryUri, filename, contents);
  }

  const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
    directoryUri,
    filename,
    'application/json'
  );
  await FileSystem.writeAsStringAsync(fileUri, contents);
  return fileUri;
}

export async function writeProgressFolderFile(
  fileUri: string,
  contents: string
): Promise<void> {
  if (hasNativeProgressFolder()) {
    await writeNativeProgressFolderFile(fileUri, contents);
    return;
  }
  await FileSystem.writeAsStringAsync(fileUri, contents);
}

export async function validateProgressFolder(
  directoryUri: string
): Promise<ProgressFolderDiagnostics | null> {
  requireSupportedProvider(directoryUri);
  if (hasNativeProgressFolder()) {
    const diagnostics = await getNativeProgressFolderDiagnostics(directoryUri);
    if (!diagnostics.isTreeUri) {
      throw new Error('The selected location is not an Android folder tree.');
    }
    if (!diagnostics.persistedReadPermission || !diagnostics.persistedWritePermission) {
      throw new Error('Reader does not have persistent read and write access to this folder.');
    }
    if (diagnostics.providerError) {
      throw new Error(`The file provider reported: ${diagnostics.providerError}`);
    }
    return diagnostics;
  }
  await listProgressFolderFiles(directoryUri);
  return null;
}
