import * as FileSystem from 'expo-file-system/legacy';

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

export interface MoonReaderBackupFile {
  uri: string;
  size: number;
  modificationTime: number;
}

export interface LocalLibraryScan {
  books: LibraryBook[];
  moonReaderBackup: MoonReaderBackupFile | null;
}

interface MoonReaderCover {
  uri: string;
  priority: number;
}

interface ScanArtifacts {
  covers: Map<string, MoonReaderCover>;
  backup: MoonReaderBackupFile | null;
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

function filenameFromUri(uri: string): string {
  let decoded = uri;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    // Keep the original URI when a document provider returns malformed escapes.
  }
  return decoded.split(/[/?#]/).filter(Boolean).pop() ?? '';
}

function inspectMoonReaderFile(
  uri: string,
  size: number,
  modificationTime: number,
  artifacts: ScanArtifacts
) {
  const filename = filenameFromUri(uri);
  const coverMatch = filename.match(/^(.+\.(?:azw3|cbr|cbz|djvu|epub|fb2|mobi|pdf))_([123])\.png$/i);
  if (coverMatch) {
    const priority = coverMatch[2] === '2' ? 3 : coverMatch[2] === '3' ? 2 : 1;
    const key = coverMatch[1].toLowerCase();
    if (!artifacts.covers.has(key) || artifacts.covers.get(key)!.priority < priority) {
      artifacts.covers.set(key, { uri, priority });
    }
  }

  if (filename.toLowerCase() === 'cloud.backup') {
    const modifiedAt = modificationTime * 1000;
    if (!artifacts.backup || artifacts.backup.modificationTime < modifiedAt) {
      artifacts.backup = { uri, size, modificationTime: modifiedAt };
    }
  }
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

async function scanSafDirectory(
  directoryUri: string,
  visited: Set<string>,
  files: LocalFileBook[],
  artifacts: ScanArtifacts
): Promise<void> {
  if (visited.has(directoryUri)) return;
  visited.add(directoryUri);

  const children = await FileSystem.StorageAccessFramework.readDirectoryAsync(directoryUri);
  const entries = await inspectUris(children);
  for (const { childUri, info } of entries) {
    if (!info.exists) continue;
    if (info.isDirectory) {
      await scanSafDirectory(childUri, visited, files, artifacts);
      continue;
    }
    inspectMoonReaderFile(childUri, info.size, info.modificationTime, artifacts);
    const book = toLocalFile(childUri, info.size, info.modificationTime);
    if (book) files.push(book);
  }
}

async function scanFileDirectory(
  directoryUri: string,
  visited: Set<string>,
  files: LocalFileBook[],
  artifacts: ScanArtifacts
): Promise<void> {
  if (visited.has(directoryUri)) return;
  visited.add(directoryUri);

  const children = await FileSystem.readDirectoryAsync(directoryUri);
  const entries = await inspectUris(
    children.map((childName) => `${directoryUri.replace(/\/$/, '')}/${childName}`)
  );
  for (const { childUri, info } of entries) {
    if (!info.exists) continue;
    if (info.isDirectory) {
      await scanFileDirectory(childUri, visited, files, artifacts);
      continue;
    }
    inspectMoonReaderFile(childUri, info.size, info.modificationTime, artifacts);
    const book = toLocalFile(childUri, info.size, info.modificationTime);
    if (book) files.push(book);
  }
}

export async function scanLocalLibrary(directoryUri: string | null): Promise<LocalLibraryScan> {
  const root = directoryUri ?? `${FileSystem.documentDirectory}downloads`;
  if (!root) throw new Error('The app documents directory is unavailable.');

  const files: LocalFileBook[] = [];
  const artifacts: ScanArtifacts = { covers: new Map(), backup: null };
  if (root.startsWith('content:')) {
    await scanSafDirectory(root, new Set(), files, artifacts);
  } else {
    const info = await FileSystem.getInfoAsync(root);
    if (!info.exists) return { books: [], moonReaderBackup: null };
    if (!info.isDirectory) throw new Error('The selected library location is not a folder.');
    await scanFileDirectory(root, new Set(), files, artifacts);
  }

  const books = files
    .sort((a, b) => b.modificationTime - a.modificationTime)
    .map((file) => {
      const book = fromLocalFile(file);
      const cover = artifacts.covers.get(file.filename.toLowerCase());
      if (!cover) return book;
      return {
        ...book,
        cover: cover.uri,
        moonReader: {
          coverUri: cover.uri,
          syncedAt: artifacts.backup?.modificationTime ?? file.modificationTime,
        },
      };
    });

  return { books, moonReaderBackup: artifacts.backup };
}
