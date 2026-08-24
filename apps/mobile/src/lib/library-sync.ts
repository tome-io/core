import type { LibraryBook } from './library';
import {
  loadLocalCatalog,
  persistLocalBook,
  persistMetadataSource,
  reconcileLocalCatalog,
  setSyncFingerprint,
} from './library-db';
import { scanLocalLibrary } from './local-library';
import { enrichLocalLibrary } from './local-metadata';

export interface LocalLibrarySyncOptions {
  directoryKey: string;
  directoryUri: string | null;
  onScanComplete?: (books: LibraryBook[]) => void;
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

export async function indexLocalLibrary({
  directoryKey,
  directoryUri,
  onScanComplete,
}: LocalLibrarySyncOptions): Promise<LocalLibrarySyncResult> {
  const scan = await scanLocalLibrary(directoryUri);
  await reconcileLocalCatalog(directoryKey, scan.books);
  const books = await loadLocalCatalog(directoryKey);
  onScanComplete?.(books);

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
  await setSyncFingerprint(`folder:${directoryKey}`, folderFingerprint);
  return { books, warnings: scan.warnings };
}

export async function enrichIndexedLocalLibrary({
  directoryKey,
  books: initialBooks,
  onBookUpdated,
}: {
  directoryKey: string;
  books: LibraryBook[];
  onBookUpdated?: (book: LibraryBook) => void;
}): Promise<LocalLibrarySyncResult> {
  let books = initialBooks;
  const warnings: string[] = [];

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

  return { books, warnings };
}

export async function syncLocalLibrary(
  options: LocalLibrarySyncOptions
): Promise<LocalLibrarySyncResult> {
  const indexed = await indexLocalLibrary(options);
  return enrichIndexedLocalLibrary({
    directoryKey: options.directoryKey,
    books: indexed.books,
    onBookUpdated: options.onBookUpdated,
  });
}
