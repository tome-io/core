import { enrichProviderMetadata, providerMetadataDue, type ProviderMetadataOptions } from './provider-metadata';
import { libraryWorkCheckpoint } from './library-work-scheduler';
import type { LibraryBook } from './library';
import {
  resolveBookCover,
  type ExtensionCoverLookup,
} from './book-cover';
import {
  persistCatalogBook,
  persistMetadataSource,
} from './library-db';
import { findBookMetadata, getWorkDetails } from './openlibrary';
import {
  READER_METADATA_VERSION,
  shouldEnrichReaderMetadata,
} from './reader-metadata-policy';

const METADATA_BATCH_SIZE = 6;

export interface ReaderCatalogResult {
  books: LibraryBook[];
  warnings: string[];
}

async function enrichReaderBook(
  book: LibraryBook,
  coverLookup?: ExtensionCoverLookup,
  coverLookupKey?: string,
  forceCatalogRefresh = false,
  providerOptions: ProviderMetadataOptions = {},
): Promise<{
  book: LibraryBook;
  warning?: string;
}> {
  if (book.local) return { book };
  const provider = await enrichProviderMetadata(book, providerOptions);
  book = provider.book;
  const warnings: string[] = provider.warning ? [provider.warning] : [];
  const catalogFetchOptions = forceCatalogRefresh
    ? { fetchFn: fetch }
    : undefined;
  let metadata: Awaited<ReturnType<typeof findBookMetadata>> = null;
  try {
    metadata = await findBookMetadata(
      book.title,
      book.author,
      catalogFetchOptions,
    );
    if (
      metadata &&
      (!metadata.cover || !metadata.description || metadata.genre === 'Other') &&
      metadata.id.startsWith('/works/')
    ) {
      const details = await getWorkDetails(metadata.id, catalogFetchOptions);
      metadata = {
        ...metadata,
        cover: metadata.cover || details.cover,
        description: metadata.description || details.description,
        genre:
          metadata.genre !== 'Other'
            ? metadata.genre
            : details.subjects[0] || metadata.genre,
      };
    }
  } catch (err: any) {
    warnings.push(`Open Library: ${err.message || String(err)}`);
  }

  let extensionCover = null;
  if (!book.cover && !book.coverSources?.local && !metadata?.cover && !book.coverSources?.catalog && coverLookup) {
    try {
      extensionCover = await coverLookup(book);
    } catch (err: any) {
      warnings.push(`Cover providers: ${err.message || String(err)}`);
    }
  }

  try {
    const coverSources = {
      ...book.coverSources,
      ...(metadata?.cover ? { catalog: metadata.cover } : {}),
      ...(extensionCover
        ? {
            providers: {
              ...book.coverSources?.providers,
              [extensionCover.providerId]: extensionCover.uri,
            },
          }
        : {}),
    };
    const resolvedCover = resolveBookCover(coverSources, book.coverPreference, [
      book.moonReader?.detailCoverUri,
      book.moonReader?.coverUri,
      book.cover,
      book.fallbackCover,
    ]);
    return {
      book: {
        ...book,
        title: metadata?.title || book.title,
        author: metadata?.author || book.author,
        cover: resolvedCover.cover,
        fallbackCover: resolvedCover.fallbackCover,
        coverSources,
        coverPreference: book.coverPreference ?? 'auto',
        description: metadata?.description || book.description,
        year: metadata?.year || book.year,
        genre:
          metadata && metadata.genre !== 'Other'
            ? metadata.genre
            : book.genre,
        rating: metadata?.rating ?? book.rating,
        ratingsCount: metadata?.ratingsCount ?? book.ratingsCount,
        discovery: metadata ?? book.discovery,
        metadataPending: warnings.length > 0 && !metadata && !extensionCover,
        metadataUpdatedAt: Date.now(),
        metadataVersion: READER_METADATA_VERSION,
        ...(coverLookupKey ? { coverLookupKey } : {}),
      },
      ...(warnings.length ? { warning: `${book.title}: ${warnings.join(' ')}` } : {}),
    };
  } catch (err: any) {
    return {
      book: {
        ...book,
        metadataPending: true,
        metadataUpdatedAt: Date.now(),
        metadataVersion: READER_METADATA_VERSION,
      },
      warning: `${book.title}: ${err.message || String(err)}`,
    };
  }
}

export async function enrichIndexedReaderCatalog(
  initialBooks: LibraryBook[],
  onBookUpdated?: (book: LibraryBook) => void,
  options: ProviderMetadataOptions & {
    force?: boolean;
    forceCatalogRefresh?: boolean;
    onProgress?: (completed: number, total: number) => void;
    coverLookup?: ExtensionCoverLookup;
    coverLookupKey?: string;
  } = {},
): Promise<ReaderCatalogResult> {
  let books = initialBooks;
  const warnings: string[] = [];
  const now = Date.now();
  const candidates = books.filter((book) => {
    // Local-file enrichment owns these records. Persisting a reader-catalog
    // snapshot here can overwrite a newly extracted embedded cover.
    if (book.local) return false;
    const coverMissing =
      !book.coverSources?.local &&
      !book.coverSources?.catalog &&
      Object.keys(book.coverSources?.providers ?? {}).length === 0;
    return (
      providerMetadataDue(book, options.providerLookupKey, options.forceCatalogRefresh) ||
      shouldEnrichReaderMetadata(book, now, options.force) ||
      (!!options.coverLookupKey &&
        coverMissing &&
        book.coverLookupKey !== options.coverLookupKey)
    );
  });
  let completed = 0;
  options.onProgress?.(completed, candidates.length);

  for (let offset = 0; offset < candidates.length; offset += METADATA_BATCH_SIZE) {
    await libraryWorkCheckpoint();
    const batch = candidates.slice(offset, offset + METADATA_BATCH_SIZE);
    const results = await Promise.all(
      batch.map((book) =>
        enrichReaderBook(
          book,
          options.coverLookup,
          options.coverLookupKey,
          options.forceCatalogRefresh,
          options,
        )
      )
    );
    for (const result of results) {
      const persisted = await persistCatalogBook(result.book);
      if (persisted.discovery) {
        await persistMetadataSource(persisted, 'catalog', persisted.discovery);
      }
      books = books.map((book) => (book.key === persisted.key ? persisted : book));
      onBookUpdated?.(persisted);
      if (result.warning) warnings.push(result.warning);
      completed += 1;
      options.onProgress?.(completed, candidates.length);
    }
  }
  return { books, warnings };
}
