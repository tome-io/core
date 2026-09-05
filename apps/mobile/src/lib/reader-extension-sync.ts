import type {
  ExtensionReaderBook,
  ExtensionReaderSyncResult,
} from '@tomeio/extension-protocol';

import { bookIdentity } from './book-metadata';
import type { LibraryBook } from './library';
import { loadMoonReaderCatalog, persistMoonReaderCatalog } from './library-db';

export interface ReaderExtensionSyncOutput {
  extensionId: string;
  extensionName: string;
  result: ExtensionReaderSyncResult;
}

export interface ReaderExtensionCatalogResult {
  books: LibraryBook[];
  warnings: string[];
}

function normalizedFilename(value: string | undefined): string {
  if (!value) return '';
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Reader applications may expose opaque document-provider paths.
  }
  return decoded.replaceAll('\\', '/').split('/').pop()?.toLowerCase().trim() ?? '';
}

function records(result: ExtensionReaderSyncResult): ExtensionReaderBook[] {
  if (result.books) return result.books;
  return result.progress.map((progress, index) => ({
    ...progress.book,
    sourceId: progress.book.id ?? `${progress.book.title}:${index}`,
    progress: progress.progress,
    isRead: progress.isRead,
    readingTimeMs: progress.readingTimeMs,
    wordsRead: progress.wordsRead,
    lastReadAt: progress.lastReadAt,
  }));
}

function readerBook(
  extensionId: string,
  record: ExtensionReaderBook,
  localByFilename: ReadonlyMap<string, LibraryBook>,
  localByIdentity: ReadonlyMap<string, LibraryBook>,
  syncedAt: number
): LibraryBook {
  const filename = normalizedFilename(record.sourceFilename || record.sourcePath || record.sourceId);
  const author = record.authors[0]?.trim() || 'Unknown';
  const format = record.format || filename.split('.').pop()?.toLowerCase() || '';
  const local =
    localByFilename.get(filename) ??
    localByIdentity.get(bookIdentity(record.title, author, format));
  const key = local?.key ?? `reader:${extensionId}:${encodeURIComponent(record.sourceId)}`;
  const base: LibraryBook = local ?? {
    key,
    identifiers: record.identifiers,
    id: record.id ?? key,
    title: record.title,
    author,
    cover: '',
    description: record.description ?? '',
    year: record.publishedYear ?? '',
    genre: record.subjects?.slice(0, 3).join(', ') || 'Other',
    format: format || undefined,
    addedAt: record.addedAt ?? syncedAt,
    metadataPending: true,
  };
  const progress = record.isRead ? 100 : record.progress;
  return {
    ...base,
    identifiers: { ...base.identifiers, ...record.identifiers },
    title: local?.discovery ? base.title : record.title || base.title,
    author: local?.discovery ? base.author : author || base.author,
    description: local?.discovery
      ? base.description || record.description || ''
      : record.description || base.description,
    genre:
      local?.discovery && base.genre !== 'Local'
        ? base.genre
        : record.subjects?.slice(0, 3).join(', ') || base.genre,
    format: base.format || format || undefined,
    ...(typeof progress === 'number' ? { progress } : {}),
    ...(typeof progress === 'number' || typeof record.isRead === 'boolean'
      ? { isRead: record.isRead ?? (progress ?? 0) >= 99.5 }
      : {}),
    ...(typeof record.readingTimeMs === 'number'
      ? { readingTimeMs: record.readingTimeMs }
      : {}),
    ...(typeof record.wordsRead === 'number' ? { wordsRead: record.wordsRead } : {}),
    ...(typeof record.lastReadAt === 'number' ? { lastReadAt: record.lastReadAt } : {}),
    moonReader: {
      extensionId,
      title: record.title,
      author: record.authors[0],
      description: record.description,
      genre: record.subjects?.slice(0, 3).join(', '),
      sourceFilename: record.sourceFilename || filename,
      sourcePath: record.sourcePath,
      availableLocally: !!local,
      syncedAt,
    },
  };
}

function mergeReaderBooks(existing: LibraryBook, incoming: LibraryBook): LibraryBook {
  const existingProgress = existing.isRead ? 100 : existing.progress ?? 0;
  const incomingProgress = incoming.isRead ? 100 : incoming.progress ?? 0;
  const incomingWins = incomingProgress > existingProgress;
  return {
    ...(incomingWins ? existing : incoming),
    ...(incomingWins ? incoming : existing),
    progress: Math.max(existingProgress, incomingProgress),
    isRead: existing.isRead || incoming.isRead || Math.max(existingProgress, incomingProgress) >= 100,
    readingTimeMs: Math.max(existing.readingTimeMs ?? 0, incoming.readingTimeMs ?? 0) || undefined,
    wordsRead: Math.max(existing.wordsRead ?? 0, incoming.wordsRead ?? 0) || undefined,
    lastReadAt: Math.max(existing.lastReadAt ?? 0, incoming.lastReadAt ?? 0) || undefined,
  };
}

export async function indexReaderExtensionCatalog(
  sourceKey: string,
  localBooks: LibraryBook[],
  outputs: ReaderExtensionSyncOutput[]
): Promise<ReaderExtensionCatalogResult> {
  const localByFilename = new Map(
    localBooks.flatMap((book) =>
      book.local ? [[book.local.filename.toLowerCase(), book] as const] : []
    )
  );
  const localByIdentity = new Map(
    localBooks.map((book) => [
      bookIdentity(book.title, book.author, book.format || book.local?.format || ''),
      book,
    ] as const)
  );
  const syncedAt = Date.now();
  const combined = new Map<string, LibraryBook>();
  const warnings: string[] = [];
  for (const output of outputs) {
    warnings.push(
      ...(output.result.warnings ?? []).map(
        (warning) => `${output.extensionName}: ${warning}`
      )
    );
    for (const record of records(output.result)) {
      const book = readerBook(
        output.extensionId,
        record,
        localByFilename,
        localByIdentity,
        syncedAt
      );
      const existing = combined.get(book.key);
      combined.set(book.key, existing ? mergeReaderBooks(existing, book) : book);
    }
  }
  await persistMoonReaderCatalog(sourceKey, [...combined.values()]);
  return { books: await loadMoonReaderCatalog(sourceKey), warnings };
}
