import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

import type { LibraryBook } from './library';

const MOON_READER_PACKAGES = [
  'com.flyersoft.moonreaderp',
  'com.flyersoft.moonreader',
] as const;

const MIME_TYPES: Record<string, string> = {
  azw3: 'application/x-kindle-application',
  cbr: 'application/x-cbr',
  cbz: 'application/x-cbz',
  djvu: 'application/djvu',
  epub: 'application/epub+zip',
  fb2: 'application/x-fb2',
  mobi: 'application/x-mobipocket-ebook',
  pdf: 'application/pdf',
};

export async function openInMoonReader(book: LibraryBook): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('Opening books in Moon+ Reader is available on Android only.');
  }
  const sourceUri = book.local?.uri ?? book.fileUri;
  if (!sourceUri || book.moonReader?.availableLocally === false) {
    throw new Error('Download this book before opening it in Moon+ Reader.');
  }
  const contentUri = sourceUri.startsWith('content:')
    ? sourceUri
    : await FileSystem.getContentUriAsync(sourceUri);
  const format = book.local?.format ?? book.format ?? '';
  const type = MIME_TYPES[format.toLowerCase()] ?? 'application/octet-stream';
  let lastError: unknown = null;

  for (const packageName of MOON_READER_PACKAGES) {
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        packageName,
        className: `${packageName}.ActivityMain`,
        data: contentUri,
        type,
        category: 'android.intent.category.DEFAULT',
        flags: 1,
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Moon+ Reader could not open this file: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}
