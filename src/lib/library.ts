import type { DiscoveryBook, FeedBook } from './openlibrary';
import { loadPersistedLibrary, savePersistedLibrary } from './library-db';
import type { Book } from './zlib';

export interface LibraryBook extends FeedBook {
  key: string;
  genre: string;
  format?: string;
  size?: number;
  addedAt: number;
  downloadedAt?: number;
  fileUri?: string;
  discovery?: DiscoveryBook;
  zlib?: Book;
  local?: LocalFileBook;
  metadataPending?: boolean;
  metadataUpdatedAt?: number;
  progress?: number;
  isRead?: boolean;
  readingTimeMs?: number;
  wordsRead?: number;
  lastReadAt?: number;
  moonReader?: MoonReaderBookData;
}

export interface MoonReaderBookData {
  coverUri?: string;
  syncedAt: number;
}

export interface LocalFileBook {
  uri: string;
  filename: string;
  format: string;
  size: number;
  modificationTime: number;
}

export interface LibraryState {
  downloaded: LibraryBook[];
  readingList: LibraryBook[];
}

export const EMPTY_LIBRARY: LibraryState = {
  downloaded: [],
  readingList: [],
};

function discoveryKey(book: DiscoveryBook): string {
  return `openlibrary:${book.id}`;
}

function zlibKey(book: Book): string {
  return `zlib:${book.id}:${book.hash}`;
}

export function fromLocalFile(file: LocalFileBook): LibraryBook {
  const stem = file.filename.slice(0, -(file.format.length + 1));
  const separator = stem.lastIndexOf(' - ');
  const rawTitle = separator > 0 ? stem.slice(0, separator) : stem;
  const rawAuthor = separator > 0 ? stem.slice(separator + 3) : '';
  const title = rawTitle.replaceAll('_', ' ').replace(/\s+/g, ' ').trim();
  const author = rawAuthor.replaceAll('_', ' ').replace(/\s+/g, ' ').trim();
  const key = `local:${file.uri}`;

  return {
    key,
    id: key,
    title: title || file.filename,
    author: author || 'Unknown',
    cover: '',
    description: '',
    year: '',
    genre: 'Local',
    format: file.format,
    size: file.size,
    addedAt: file.modificationTime || Date.now(),
    downloadedAt: file.modificationTime || Date.now(),
    fileUri: file.uri,
    local: file,
    metadataPending: true,
  };
}

export function fromDiscoveryBook(
  book: DiscoveryBook,
  overrides: Partial<LibraryBook> = {}
): LibraryBook {
  const key = discoveryKey(book);
  return {
    key,
    id: key,
    title: book.title,
    author: book.author,
    cover: book.cover,
    description: book.description,
    year: book.year,
    genre: book.genre || 'Other',
    rating: book.rating,
    ratingsCount: book.ratingsCount,
    addedAt: Date.now(),
    discovery: book,
    ...overrides,
  };
}

export function fromZlibBook(
  book: Book,
  overrides: Partial<LibraryBook> = {}
): LibraryBook {
  const key = zlibKey(book);
  return {
    key,
    id: key,
    title: book.title,
    author: book.author,
    cover: book.cover,
    description: book.description,
    year: book.year,
    genre: 'Other',
    format: book.format,
    size: book.size,
    addedAt: Date.now(),
    zlib: book,
    ...overrides,
  };
}

export function detailParams(book: LibraryBook) {
  if (book.local) {
    return {
      pathname: '/book/[id]' as const,
      params: { id: book.key, local: JSON.stringify(book) },
    };
  }
  if (book.discovery) {
    return {
      pathname: '/book/[id]' as const,
      params: { id: book.discovery.id, ext: JSON.stringify(book.discovery) },
    };
  }
  if (book.zlib) {
    return {
      pathname: '/book/[id]' as const,
      params: { id: book.zlib.id, item: JSON.stringify(book.zlib) },
    };
  }
  throw new Error(`Library item ${book.key} has no source metadata.`);
}

export async function loadLibrary(): Promise<LibraryState> {
  return loadPersistedLibrary();
}

export async function saveLibrary(state: LibraryState): Promise<void> {
  await savePersistedLibrary(state);
}
