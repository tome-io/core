import type { LibraryBook } from './library';
import {
  getSyncFingerprint,
  persistLocalBook,
  persistLocalBooks,
  persistMetadataSource,
  reconcileLocalCatalog,
  setSyncFingerprint,
} from './library-db';
import { scanLocalLibrary } from './local-library';
import { enrichLocalLibrary } from './local-metadata';
import { syncMoonReaderLibrary } from './moon-reader';

export interface LocalLibrarySyncOptions {
  directoryKey: string;
  directoryUri: string | null;
  onScanComplete?: (books: LibraryBook[]) => void;
  onBooksUpdated?: (books: LibraryBook[]) => void;
  onBookUpdated?: (book: LibraryBook) => void;
}

export interface LocalLibrarySyncResult {
  books: LibraryBook[];
  warnings: string[];
}

function hashSyncInput(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function moonReaderPayload(book: LibraryBook) {
  return {
    title: book.title,
    author: book.author,
    description: book.description,
    genre: book.genre,
    progress: book.progress,
    isRead: book.isRead,
    readingTimeMs: book.readingTimeMs,
    wordsRead: book.wordsRead,
    lastReadAt: book.lastReadAt,
    syncedAt: book.moonReader?.syncedAt,
  };
}

export async function syncLocalLibrary({
  directoryKey,
  directoryUri,
  onScanComplete,
  onBooksUpdated,
  onBookUpdated,
}: LocalLibrarySyncOptions): Promise<LocalLibrarySyncResult> {
  const scan = await scanLocalLibrary(directoryUri);
  let books = await reconcileLocalCatalog(directoryKey, scan.books);
  onScanComplete?.(books);

  const warnings: string[] = [];
  const folderFingerprint = hashSyncInput(
    books
      .map((book) =>
        book.local
          ? `${book.local.uri}:${book.local.size}:${book.local.modificationTime}`
          : ''
      )
      .sort()
      .join('\n')
  );

  if (scan.moonReaderBackup) {
    const moonReaderFingerprint = `${scan.moonReaderBackup.size}:${
      scan.moonReaderBackup.modificationTime
    }:${hashSyncInput(
      books
        .map((book) => book.local?.filename.toLowerCase() ?? '')
        .sort()
        .join('\n')
    )}`;
    const syncKey = `moonreader:${directoryKey}`;
    const previousFingerprint = await getSyncFingerprint(syncKey);
    if (previousFingerprint !== moonReaderFingerprint) {
      try {
        const moonReader = await syncMoonReaderLibrary(books, scan.moonReaderBackup);
        books = moonReader.books;
        await persistLocalBooks(directoryKey, books);
        for (const book of books) {
          if (book.local) {
            await persistMetadataSource(book, 'moonreader', moonReaderPayload(book));
          }
        }
        if (moonReader.warning) warnings.push(moonReader.warning);
        else await setSyncFingerprint(syncKey, moonReaderFingerprint);
        onBooksUpdated?.(books);
      } catch (err: any) {
        warnings.push(`Moon+ Reader sync failed: ${err.message || String(err)}`);
      }
    }
  }

  const metadataWarnings = await enrichLocalLibrary(books, async (enriched, sources) => {
    await persistLocalBook(directoryKey, enriched);
    await persistMetadataSource(enriched, 'embedded', sources.embedded);
    if (sources.catalog) {
      await persistMetadataSource(enriched, 'catalog', sources.catalog);
    }
    books = books.map((book) => (book.key === enriched.key ? enriched : book));
    onBookUpdated?.(enriched);
  });
  if (metadataWarnings.length) {
    warnings.push(
      `Could not load complete metadata for ${metadataWarnings.length} local ${
        metadataWarnings.length === 1 ? 'book' : 'books'
      }. ${metadataWarnings[0].filename}: ${metadataWarnings[0].message}`
    );
  }

  await setSyncFingerprint(`folder:${directoryKey}`, folderFingerprint);
  return { books, warnings };
}
