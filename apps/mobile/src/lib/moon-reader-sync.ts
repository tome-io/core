import type { LibraryBook } from './library';
import { resolveBookCover } from './book-cover';
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

async function enrichReaderBook(book: LibraryBook): Promise<{
  book: LibraryBook;
  warning?: string;
}> {
  if (book.local) return { book };
  try {
    let metadata = await findBookMetadata(book.title, book.author);
    if (
      metadata &&
      (!metadata.cover || !metadata.description || metadata.genre === 'Other') &&
      metadata.id.startsWith('/works/')
    ) {
      const details = await getWorkDetails(metadata.id);
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
    if (!metadata) {
      return {
        book: {
          ...book,
          metadataPending: false,
          metadataUpdatedAt: Date.now(),
          metadataVersion: READER_METADATA_VERSION,
        },
      };
    }
    const coverSources = {
      ...book.coverSources,
      ...(metadata.cover ? { catalog: metadata.cover } : {}),
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
        title: metadata.title || book.title,
        author: metadata.author || book.author,
        cover: resolvedCover.cover,
        fallbackCover: resolvedCover.fallbackCover,
        coverSources,
        coverPreference: book.coverPreference ?? 'auto',
        description: metadata.description || book.description,
        year: metadata.year || book.year,
        genre: metadata.genre !== 'Other' ? metadata.genre : book.genre,
        rating: metadata.rating ?? book.rating,
        ratingsCount: metadata.ratingsCount ?? book.ratingsCount,
        discovery: metadata,
        metadataPending: false,
        metadataUpdatedAt: Date.now(),
        metadataVersion: READER_METADATA_VERSION,
      },
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
  options: { force?: boolean } = {}
): Promise<ReaderCatalogResult> {
  let books = initialBooks;
  const warnings: string[] = [];
  const now = Date.now();
  const candidates = books.filter(
    (book) => shouldEnrichReaderMetadata(book, now, options.force)
  );

  for (let offset = 0; offset < candidates.length; offset += METADATA_BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + METADATA_BATCH_SIZE);
    const results = await Promise.all(batch.map(enrichReaderBook));
    for (const result of results) {
      await persistCatalogBook(result.book);
      if (result.book.discovery) {
        await persistMetadataSource(result.book, 'catalog', result.book.discovery);
      }
      books = books.map((book) => (book.key === result.book.key ? result.book : book));
      onBookUpdated?.(result.book);
      if (result.warning) warnings.push(result.warning);
    }
  }
  return { books, warnings };
}
