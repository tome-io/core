import type { BookMetadata } from '@tomeio/domain';
import type { BookExtension } from '@tomeio/extension-protocol';

import { cachedExtensionResult } from './extension-result-cache';

let catalogMetadataQueue: Promise<unknown> = Promise.resolve();

/** Enrich already-visible results with one background request at a time. */
export async function enrichCatalogRatings(
  books: readonly BookMetadata[],
  options: {
    hydrate: (book: BookMetadata) => Promise<BookMetadata>;
    onBook: (book: BookMetadata) => void;
    onError: (error: unknown) => void;
    isCurrent: () => boolean;
  },
): Promise<void> {
  for (const book of books) {
    if (!options.isCurrent()) return;
    if (book.rating != null) continue;
    const request = catalogMetadataQueue.then(() =>
      options.isCurrent() ? options.hydrate(book) : undefined
    );
    // A failed provider request must not block other catalogs in the queue.
    catalogMetadataQueue = request.catch(() => undefined);
    try {
      const details = await request;
      if (!options.isCurrent()) return;
      if (details) options.onBook(details);
    } catch (error) {
      if (options.isCurrent()) options.onError(error);
      return;
    }
  }
}

/** Share provider detail requests between catalogs and the book detail screen. */
export async function hydrateExtensionBook(
  provider: BookExtension,
  book: BookMetadata,
): Promise<BookMetadata> {
  if (!provider.meta) return book;
  const details = await cachedExtensionResult(
    `meta:${provider.manifest.id}@${provider.manifest.version}:${book.id}`,
    async () => {
      const result = await provider.meta!(book.id);
      if (result && result.id !== book.id) {
        throw new Error(`${provider.manifest.name} returned details for a different book.`);
      }
      return result;
    },
  );
  if (!details) return book;
  return {
    ...book,
    ...details,
    identifiers: { ...book.identifiers, ...details.identifiers },
    acquisitions: details.acquisitions ?? book.acquisitions,
  };
}
