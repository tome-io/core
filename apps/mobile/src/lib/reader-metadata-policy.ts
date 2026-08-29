import type { LibraryBook } from './library';

const METADATA_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const METADATA_FAILURE_RETRY_MS = 15 * 60 * 1000;
export const READER_METADATA_VERSION = 6;

export function shouldEnrichReaderMetadata(
  book: LibraryBook,
  now: number,
  force = false
): boolean {
  if (book.local) return false;
  if (force) return true;
  return (
    book.metadataVersion !== READER_METADATA_VERSION ||
    !book.metadataUpdatedAt ||
    book.metadataUpdatedAt < now - METADATA_REFRESH_MS ||
    (book.metadataPending === true &&
      book.metadataUpdatedAt < now - METADATA_FAILURE_RETRY_MS)
  );
}
