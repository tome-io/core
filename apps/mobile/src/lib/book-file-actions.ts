import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import type { LibraryBook } from './library';

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

function sourceUri(book: LibraryBook): string {
  const uri = book.local?.uri ?? book.fileUri;
  if (!uri || book.moonReader?.availableLocally === false) {
    throw new Error('Download this book before opening its source file.');
  }
  return uri;
}

function mimeType(book: LibraryBook): string {
  const format = book.local?.format ?? book.format ?? '';
  return MIME_TYPES[format.toLowerCase()] ?? 'application/octet-stream';
}

function safeFilename(book: LibraryBook): string {
  const extension = (book.local?.format ?? book.format ?? 'book').toLowerCase();
  const title = book.title.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
  return `${title || 'book'}.${extension}`;
}

async function shareableFileUri(book: LibraryBook): Promise<string> {
  const uri = sourceUri(book);
  if (uri.startsWith('file:')) return uri;
  if (!FileSystem.cacheDirectory) throw new Error('The app cache is unavailable.');
  const cachedUri = `${FileSystem.cacheDirectory}${safeFilename(book)}`;
  await FileSystem.deleteAsync(cachedUri, { idempotent: true });
  await FileSystem.copyAsync({ from: uri, to: cachedUri });
  return cachedUri;
}

export async function openBookWithAnotherApp(book: LibraryBook): Promise<void> {
  if (Platform.OS === 'web') {
    throw new Error('Opening local books with another app is unavailable on web.');
  }
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('No compatible app is available to open this book.');
  }
  await Sharing.shareAsync(await shareableFileUri(book), {
    dialogTitle: `Open ${book.title} with`,
    mimeType: mimeType(book),
  });
}

export async function showBookInFiles(book: LibraryBook): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('Showing a book in the file manager is available on Android only.');
  }
  const uri = sourceUri(book);
  const contentUri = uri.startsWith('content:') ? uri : await FileSystem.getContentUriAsync(uri);
  await IntentLauncher.startActivityAsync('android.intent.action.OPEN_DOCUMENT', {
    category: 'android.intent.category.OPENABLE',
    type: mimeType(book),
    flags: 1,
    extra: { 'android.provider.extra.INITIAL_URI': contentUri },
  });
}
