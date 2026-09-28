import type { BookMetadata } from '@tomeio/domain';
import type { BookExtension } from '@tomeio/extension-protocol';

import { cachedExtensionResult } from './extension-result-cache';

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
