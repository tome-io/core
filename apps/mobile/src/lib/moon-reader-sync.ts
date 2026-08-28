import type { LibraryBook } from './library';
import {
  persistCatalogBook,
  persistMetadataSource,
} from './library-db';
import { findBookMetadata, getWorkDetails } from './openlibrary';

const METADATA_BATCH_SIZE = 6;
const METADATA_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const METADATA_FAILURE_RETRY_MS = 15 * 60 * 1000;
const READER_METADATA_VERSION = 5;

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
    return {
      book: {
        ...book,
        title: metadata.title || book.title,
        author: metadata.author || book.author,
        cover: metadata.cover || book.cover,
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
  onBookUpdated?: (book: LibraryBook) => void
): Promise<ReaderCatalogResult> {
  let books = initialBooks;
  const warnings: string[] = [];
  const now = Date.now();
  const staleBefore = now - METADATA_REFRESH_MS;
  const retryFailuresBefore = now - METADATA_FAILURE_RETRY_MS;
  const candidates = books.filter(
    (book) =>
      !book.local &&
      (book.metadataVersion !== READER_METADATA_VERSION ||
        !book.metadataUpdatedAt ||
        book.metadataUpdatedAt < staleBefore ||
        (book.metadataPending && book.metadataUpdatedAt < retryFailuresBefore))
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
