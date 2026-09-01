import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { openNativeProgressFolder } from '../../modules/expo-progress-folder/src';
import type { LibraryBook } from './library';
import { materializeNativeFolderFile } from './native-folder-file';

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

const IOS_UTIS: Record<string, string> = {
  epub: 'org.idpf.epub-container',
  pdf: 'com.adobe.pdf',
};

function sourceUri(book: LibraryBook): string {
  const uri = book.local?.uri ?? book.fileUri;
  if (
    !uri ||
    book.availableLocally === false ||
    book.moonReader?.availableLocally === false
  ) {
    throw new Error('Download this book before opening its source file.');
  }
  return uri;
}

function mimeType(book: LibraryBook): string {
  const format = book.local?.format ?? book.format ?? '';
  return MIME_TYPES[format.toLowerCase()] ?? 'application/octet-stream';
}

function iosUti(book: LibraryBook): string | undefined {
  const format = book.local?.format ?? book.format ?? '';
  return IOS_UTIS[format.toLowerCase()];
}

function safeFilename(book: LibraryBook): string {
  const extension = (book.local?.format ?? book.format ?? 'book').toLowerCase();
  const title = book.title.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
  return `${title || 'book'}.${extension}`;
}

async function shareableFileUri(book: LibraryBook): Promise<string> {
  const uri = sourceUri(book);
  if (uri.startsWith('file:')) return uri;
  const filename = safeFilename(book);
  const nativeUri = await materializeNativeFolderFile(uri, filename);
  if (nativeUri !== uri) return nativeUri;
  if (!FileSystem.cacheDirectory) throw new Error('The app cache is unavailable.');
  const cachedUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.deleteAsync(cachedUri, { idempotent: true });
  await FileSystem.copyAsync({ from: uri, to: cachedUri });
  return cachedUri;
}

export async function openBookWithAnotherApp(book: LibraryBook): Promise<void> {
  if (Platform.OS === 'web') {
    throw new Error('Opening local books with another app is unavailable on web.');
  }
  const fileUri = await shareableFileUri(book);
  if (Platform.OS === 'android') {
    const contentUri = fileUri.startsWith('content:')
      ? fileUri
      : await FileSystem.getContentUriAsync(fileUri);
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      type: mimeType(book),
      category: 'android.intent.category.DEFAULT',
      flags: 1,
    });
    return;
  }
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('No compatible app is available to open this book.');
  }
  await Sharing.shareAsync(fileUri, {
    dialogTitle: `Open ${book.title} with`,
    mimeType: mimeType(book),
    UTI: iosUti(book),
  });
}

export async function showBookInFiles(
  book: LibraryBook,
  libraryDirectoryUri?: string | null
): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('Showing a book in the file manager is available on Android only.');
  }
  const uri = book.local?.uri ?? book.fileUri;
  if (!uri?.startsWith('content:')) {
    throw new Error(
      'This book is stored inside Tomeio. Choose a Library folder in Settings to reveal downloaded books in Files.'
    );
  }
  await openNativeProgressFolder(libraryDirectoryUri ?? uri);
}

export function canShowBookInFiles(book: LibraryBook): boolean {
  const uri = book.local?.uri ?? book.fileUri;
  return (
    Platform.OS === 'android' &&
    book.availableLocally !== false &&
    book.moonReader?.availableLocally !== false &&
    !!uri?.startsWith('content:')
  );
}
