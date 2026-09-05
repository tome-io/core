import type { ProviderMetadataOptions } from './provider-metadata';
import type { LibraryBook } from './library';
import {
  loadLocalCatalog,
  getSyncFingerprint,
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
  changed: boolean;
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
  const folderFingerprint = hashSyncInput(
    scan.books
      .map((book) =>
        book.local
          ? `${book.local.uri}:${book.local.size}:${book.local.modificationTime}`
          : ''
      )
      .sort()
      .join('\n')
  );
  const previousFingerprint = await getSyncFingerprint(`folder:${directoryKey}`);
  if (previousFingerprint === folderFingerprint) {
    const books = await loadLocalCatalog(directoryKey);
    console.info('[library-sync] folder unchanged', { books: books.length });
    onScanComplete?.(books);
    return { books, warnings: scan.warnings, changed: false };
  }
  await reconcileLocalCatalog(directoryKey, scan.books);
  const books = await loadLocalCatalog(directoryKey);
  onScanComplete?.(books);
  await setSyncFingerprint(`folder:${directoryKey}`, folderFingerprint);
  console.info('[library-sync] folder changed', { books: books.length });
  return { books, warnings: scan.warnings, changed: true };
}

export async function enrichIndexedLocalLibrary({
  directoryKey,
  books: initialBooks,
  onBookUpdated,
  onProgress,
  forceCatalogRefresh,
  coverLookup,
  providerLookup,
  providerLookupKey,
}: ProviderMetadataOptions & {
  directoryKey: string;
  books: LibraryBook[];
  onBookUpdated?: (book: LibraryBook) => void;
  onProgress?: (completed: number, total: number) => void;
  forceCatalogRefresh?: boolean;
}): Promise<LocalLibrarySyncResult> {
  let books = initialBooks;
  const warnings: string[] = [];

  const metadataWarnings = await enrichLocalLibrary(
    books,
    async (enriched, sources) => {
      const persisted = await persistLocalBook(directoryKey, enriched);
      await persistMetadataSource(persisted, 'embedded', sources.embedded);
      if (sources.catalog) {
        await persistMetadataSource(persisted, 'catalog', sources.catalog);
      }
      books = books.map((book) => (book.key === persisted.key ? persisted : book));
      onBookUpdated?.(persisted);
    },
    onProgress,
    { forceCatalogRefresh, providerLookup, providerLookupKey, coverLookup },
  );
  if (metadataWarnings.length) {
    warnings.push(
      `Could not load complete metadata for ${metadataWarnings.length} local ${
        metadataWarnings.length === 1 ? 'book' : 'books'
      }. ${metadataWarnings[0].filename}: ${metadataWarnings[0].message}`
    );
  }

  return { books, warnings, changed: books !== initialBooks };
}

export async function syncLocalLibrary(
  options: LocalLibrarySyncOptions
): Promise<LocalLibrarySyncResult> {
  const indexed = await indexLocalLibrary(options);
  const enriched = await enrichIndexedLocalLibrary({
    directoryKey: options.directoryKey,
    books: indexed.books,
    onBookUpdated: options.onBookUpdated,
  });
  return { ...enriched, changed: indexed.changed || enriched.changed };
}
