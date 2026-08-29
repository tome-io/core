import * as FileSystem from 'expo-file-system/legacy';

import {
  isNativeFolderLocation,
  listNativeDirectoryEntries,
  type FolderDirectoryEntry,
} from '../../modules/expo-progress-folder/src';

import { filenameFromUri } from './book-metadata';
import { fromLocalFile, type LibraryBook, type LocalFileBook } from './library';

const BOOK_FORMATS = new Set([
  'azw3',
  'cbr',
  'cbz',
  'djvu',
  'epub',
  'fb2',
  'mobi',
  'pdf',
]);
const METADATA_BATCH_SIZE = 24;

export interface LocalLibraryScan {
  books: LibraryBook[];
  warnings: string[];
}

function finiteNumber(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

async function inspectUris(uris: string[]) {
  const entries: {
    childUri: string;
    info: Awaited<ReturnType<typeof FileSystem.getInfoAsync>>;
  }[] = [];
  for (let offset = 0; offset < uris.length; offset += METADATA_BATCH_SIZE) {
    const batch = uris.slice(offset, offset + METADATA_BATCH_SIZE);
    entries.push(
      ...(await Promise.all(
        batch.map(async (childUri) => ({
          childUri,
          info: await FileSystem.getInfoAsync(childUri),
        }))
      ))
    );
  }
  return entries;
}

function toLocalFile(uri: string, size: number, modificationTime: number): LocalFileBook | null {
  const filename = filenameFromUri(uri);
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return null;
  const format = filename.slice(dot + 1).toLowerCase();
  if (!BOOK_FORMATS.has(format)) return null;
  return {
    uri,
    filename,
    format,
    size,
    modificationTime: modificationTime * 1000,
  };
}

function toNativeLocalFile(entry: FolderDirectoryEntry): LocalFileBook | null {
  const dot = entry.name.lastIndexOf('.');
  if (dot <= 0) return null;
  const format = entry.name.slice(dot + 1).toLowerCase();
  if (!BOOK_FORMATS.has(format)) return null;
  return {
    uri: entry.uri,
    filename: entry.name,
    format,
    size: finiteNumber(entry.size),
    modificationTime: finiteNumber(entry.modifiedAt),
  };
}

async function scanNativeDirectory(
  directoryUri: string,
  visited: Set<string>,
  files: LocalFileBook[]
): Promise<void> {
  if (visited.has(directoryUri)) return;
  visited.add(directoryUri);

  const entries = await listNativeDirectoryEntries(directoryUri);
  for (const entry of entries) {
    const normalized = entry.name.toLowerCase();
    if (
      entry.isDirectory &&
      (normalized === '.moonreader' || normalized === '.moon+' || normalized === 'moonreader')
    ) {
      continue;
    }
    if (entry.isDirectory) {
      await scanNativeDirectory(entry.uri, visited, files);
      continue;
    }
    const book = toNativeLocalFile(entry);
    if (book) files.push(book);
  }
}

async function scanSafDirectory(
  directoryUri: string,
  visited: Set<string>,
  files: LocalFileBook[]
): Promise<void> {
  if (visited.has(directoryUri)) return;
  visited.add(directoryUri);

  const children = await FileSystem.StorageAccessFramework.readDirectoryAsync(directoryUri);
  const ignoredDirectories = children.filter((uri) => {
    const name = filenameFromUri(uri).toLowerCase();
    return name === '.moonreader' || name === '.moon+' || name === 'moonreader';
  });
  const entries = await inspectUris(
    children.filter((uri) => !ignoredDirectories.includes(uri))
  );
  for (const { childUri, info } of entries) {
    if (!info.exists) continue;
    if (info.isDirectory) {
      await scanSafDirectory(childUri, visited, files);
      continue;
    }
    const size = finiteNumber(info.size);
    const modificationTime = finiteNumber(info.modificationTime);
    const book = toLocalFile(childUri, size, modificationTime);
    if (book) files.push(book);
  }
}

async function scanFileDirectory(
  directoryUri: string,
  visited: Set<string>,
  files: LocalFileBook[]
): Promise<void> {
  if (visited.has(directoryUri)) return;
  visited.add(directoryUri);

  const children = await FileSystem.readDirectoryAsync(directoryUri);
  const ignoredDirectories = children.filter((name) => {
    const normalized = name.toLowerCase();
    return normalized === '.moonreader' || normalized === '.moon+' || normalized === 'moonreader';
  });
  const entries = await inspectUris(
    children
      .filter((childName) => !ignoredDirectories.includes(childName))
      .map((childName) => `${directoryUri.replace(/\/$/, '')}/${childName}`)
  );
  for (const { childUri, info } of entries) {
    if (!info.exists) continue;
    if (info.isDirectory) {
      await scanFileDirectory(childUri, visited, files);
      continue;
    }
    const size = finiteNumber(info.size);
    const modificationTime = finiteNumber(info.modificationTime);
    const book = toLocalFile(childUri, size, modificationTime);
    if (book) files.push(book);
  }
}

export async function scanLocalLibrary(directoryUri: string | null): Promise<LocalLibraryScan> {
  const root = directoryUri ?? `${FileSystem.documentDirectory}downloads`;
  if (!root) throw new Error('The app documents directory is unavailable.');

  const files: LocalFileBook[] = [];
  const warnings: string[] = [];
  if (isNativeFolderLocation(root)) {
    await scanNativeDirectory(root, new Set(), files);
  } else if (root.startsWith('content:')) {
    await scanSafDirectory(root, new Set(), files);
  } else {
    const info = await FileSystem.getInfoAsync(root);
    if (!info.exists) return { books: [], warnings };
    if (!info.isDirectory) throw new Error('The selected library location is not a folder.');
    await scanFileDirectory(root, new Set(), files);
  }

  const books = files
    .sort((a, b) => b.modificationTime - a.modificationTime)
    .map(fromLocalFile);

  return { books, warnings };
}
