import * as FileSystem from 'expo-file-system/legacy';

import { filenameFromUri, moonReaderCoverTarget } from './book-metadata';
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

interface CoverCandidate {
  uri: string;
  priority: number;
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

function addMoonReaderCover(
  covers: Map<string, CoverCandidate>,
  uri: string,
  filename: string
) {
  const target = moonReaderCoverTarget(filename);
  if (!target) return;
  const key = target.bookFilename.toLowerCase();
  const current = covers.get(key);
  if (!current || target.priority < current.priority) {
    covers.set(key, { uri, priority: target.priority });
  }
}

async function scanSafMoonReaderCovers(
  directoryUri: string,
  covers: Map<string, CoverCandidate>
) {
  const children = await FileSystem.StorageAccessFramework.readDirectoryAsync(directoryUri);
  children.forEach((uri) => addMoonReaderCover(covers, uri, filenameFromUri(uri)));
}

async function scanFileMoonReaderCovers(
  directoryUri: string,
  covers: Map<string, CoverCandidate>
) {
  const filenames = await FileSystem.readDirectoryAsync(directoryUri);
  filenames.forEach((filename) =>
    addMoonReaderCover(covers, `${directoryUri.replace(/\/$/, '')}/${filename}`, filename)
  );
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
  covers: Map<string, CoverCandidate>,
  warnings: string[]
): Promise<void> {
  if (visited.has(directoryUri)) return;
  visited.add(directoryUri);

  const children = await FileSystem.StorageAccessFramework.readDirectoryAsync(directoryUri);
  const ignoredDirectories = children.filter((uri) => {
    const name = filenameFromUri(uri).toLowerCase();
    return name === '.moonreader' || name === '.moon+' || name === 'moonreader';
  });
  const moonReaderDirectory = ignoredDirectories.find((uri) => {
    const name = filenameFromUri(uri).toLowerCase();
    return name === '.moonreader' || name === 'moonreader';
  });
  if (moonReaderDirectory) {
    try {
      await scanSafMoonReaderCovers(moonReaderDirectory, covers);
    } catch (err: any) {
      warnings.push(`Moon+ Reader cover cache could not be read: ${err.message || String(err)}`);
    }
  }
  const entries = await inspectUris(
    children.filter((uri) => !ignoredDirectories.includes(uri))
  );
  for (const { childUri, info } of entries) {
    if (!info.exists) continue;
    if (info.isDirectory) {
      await scanSafDirectory(childUri, visited, files, covers, warnings);
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
  files: LocalFileBook[],
  covers: Map<string, CoverCandidate>,
  warnings: string[]
): Promise<void> {
  if (visited.has(directoryUri)) return;
  visited.add(directoryUri);

  const children = await FileSystem.readDirectoryAsync(directoryUri);
  const ignoredDirectories = children.filter((name) => {
    const normalized = name.toLowerCase();
    return normalized === '.moonreader' || normalized === '.moon+' || normalized === 'moonreader';
  });
  const moonReaderDirectory = ignoredDirectories.find((name) => {
    const normalized = name.toLowerCase();
    return normalized === '.moonreader' || normalized === 'moonreader';
  });
  if (moonReaderDirectory) {
    try {
      await scanFileMoonReaderCovers(
        `${directoryUri.replace(/\/$/, '')}/${moonReaderDirectory}`,
        covers
      );
    } catch (err: any) {
      warnings.push(`Moon+ Reader cover cache could not be read: ${err.message || String(err)}`);
    }
  }
  const entries = await inspectUris(
    children
      .filter((childName) => !ignoredDirectories.includes(childName))
      .map((childName) => `${directoryUri.replace(/\/$/, '')}/${childName}`)
  );
  for (const { childUri, info } of entries) {
    if (!info.exists) continue;
    if (info.isDirectory) {
      await scanFileDirectory(childUri, visited, files, covers, warnings);
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
  const covers = new Map<string, CoverCandidate>();
  const warnings: string[] = [];
  if (root.startsWith('content:')) {
    await scanSafDirectory(root, new Set(), files, covers, warnings);
  } else {
    const info = await FileSystem.getInfoAsync(root);
    if (!info.exists) return { books: [], warnings };
    if (!info.isDirectory) throw new Error('The selected library location is not a folder.');
    await scanFileDirectory(root, new Set(), files, covers, warnings);
  }

  const books = files
    .sort((a, b) => b.modificationTime - a.modificationTime)
    .map((file) => {
      const book = fromLocalFile(file);
      const cachedCover = covers.get(file.filename.toLowerCase());
      return cachedCover
        ? { ...book, cover: cachedCover.uri, fallbackCover: cachedCover.uri }
        : book;
    });

  return { books, warnings };
}
