import type { DiscoveryBook, FeedBook } from './openlibrary';
import { loadPersistedLibrary, savePersistedLibrary } from './library-db';
import type { BookAcquisition, BookMetadata } from '@tomeio/domain';
import type { ExtensionLibraryBook } from '@tomeio/extension-protocol';
import { metadataFromFilename } from './book-metadata';
import type { BookCoverPreference, BookCoverSources } from './book-cover';

export interface LibraryBook extends FeedBook {
  key: string;
  genre: string;
  fallbackCover?: string;
  coverSources?: BookCoverSources;
  coverPreference?: BookCoverPreference;
  format?: string;
  size?: number;
  addedAt: number;
  downloadedAt?: number;
  fileUri?: string;
  availableLocally?: boolean;
  discovery?: DiscoveryBook;
  extension?: {
    extensionId: string;
    book: BookMetadata;
    acquisition?: BookAcquisition;
  };
  local?: LocalFileBook;
  metadataPending?: boolean;
  metadataUpdatedAt?: number;
  metadataVersion?: number;
  progress?: number;
  isRead?: boolean;
  readingTimeMs?: number;
  wordsRead?: number;
  lastReadAt?: number;
  moonReader?: MoonReaderBookData;
}

export interface MoonReaderBookData {
  extensionId?: string;
  title?: string;
  author?: string;
  description?: string;
  genre?: string;
  coverUri?: string;
  detailCoverUri?: string;
  sourceFilename?: string;
  sourcePath?: string;
  availableLocally?: boolean;
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

export function fromLocalFile(file: LocalFileBook): LibraryBook {
  const { title, author } = metadataFromFilename(file.filename, file.format);
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
    availableLocally: true,
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

export function fromExtensionBook(
  extensionId: string,
  book: BookMetadata,
  overrides: Partial<LibraryBook> = {}
): LibraryBook {
  const key = `extension:${extensionId}:${book.id}`;
  return {
    key,
    id: key,
    title: book.title,
    author: book.authors[0] || 'Unknown',
    cover: book.coverUrl || '',
    description: book.description || '',
    year: book.publishedYear || '',
    rating: book.rating,
    ratingsCount: book.ratingsCount,
    genre: 'Other',
    addedAt: Date.now(),
    extension: { extensionId, book },
    ...overrides,
  };
}

export function detailParams(book: LibraryBook) {
  if (book.local) {
    return {
      pathname: '/book/[id]' as const,
      params: { id: book.key, localUri: book.local.uri, local: JSON.stringify(book) },
    };
  }
  if (book.moonReader) {
    return {
      pathname: '/book/[id]' as const,
      params: { id: book.key, moon: JSON.stringify(book) },
    };
  }
  if (book.discovery) {
    return {
      pathname: '/book/[id]' as const,
      params: { id: book.discovery.id, ext: JSON.stringify(book.discovery) },
    };
  }
  if (book.extension) {
    return {
      pathname: '/book/[id]' as const,
      params: {
        id: book.extension.book.id,
        extensionId: book.extension.extensionId,
        extensionBook: JSON.stringify(book.extension.book),
      },
    };
  }
  throw new Error(`Library item ${book.key} has no source metadata.`);
}

export function toExtensionLibraryBook(book: LibraryBook): ExtensionLibraryBook {
  const localUri = book.local?.uri ?? book.fileUri;
  const filename = book.local?.filename ?? localUri?.split('/').pop() ?? '';
  return {
    id: book.extension?.book.id ?? book.discovery?.id ?? book.id,
    title: book.title,
    authors: book.author && book.author !== 'Unknown' ? [book.author] : [],
    publishedYear:
      typeof book.year === 'number' ? book.year : Number(book.year) || undefined,
    identifiers: book.extension?.book.identifiers ?? {},
    ...(localUri &&
    book.availableLocally !== false &&
    book.moonReader?.availableLocally !== false
      ? {
          localFile: {
            uri: localUri,
            filename,
            format: book.local?.format ?? book.format ?? '',
          },
        }
      : {}),
  };
}

export async function loadLibrary(): Promise<LibraryState> {
  return loadPersistedLibrary();
}

export async function saveLibrary(state: LibraryState): Promise<void> {
  await savePersistedLibrary(state);
}
