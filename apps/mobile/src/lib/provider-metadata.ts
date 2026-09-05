import { resolveBookCover, type ExtensionCoverLookup } from './book-cover';
import type { LibraryBook } from './library';

export interface ProviderMetadata {
  seriesPosition?: number;
  covers: Record<string, string>;
  warning?: string;
}

export interface ProviderMetadataOptions {
  providerLookup?: (book: LibraryBook) => Promise<ProviderMetadata>;
  providerLookupKey?: string;
  coverLookup?: ExtensionCoverLookup;
  forceCatalogRefresh?: boolean;
  shouldContinue?: () => boolean;
}

// Only audited resolving providers with structured series positions belong here.
const SERIES_PROVIDERS = new Set(['community.tomeio.hardcover']);
const TTL = 7 * 24 * 60 * 60_000;
const RETRY_DELAY = 15 * 60_000;
const keyFor = (book: LibraryBook, key: string) => `${key}|${book.coverPreference ?? 'auto'}`;

export function needsProviderMetadata(book: LibraryBook, providerId: string): boolean {
  return book.coverPreference === `provider:${providerId}` ||
    (book.seriesPosition == null && SERIES_PROVIDERS.has(providerId));
}

export function providerMetadataDue(book: LibraryBook, key: string | undefined, force = false): boolean {
  if (!key) return false;
  if (force || book.providerMetadataKey !== keyFor(book, key)) return true;
  if ((book.providerMetadataRetryAt ?? 0) > Date.now()) return false;
  return !book.providerMetadataUpdatedAt || Date.now() - book.providerMetadataUpdatedAt > TTL;
}

export async function enrichProviderMetadata(
  book: LibraryBook,
  options: ProviderMetadataOptions,
): Promise<{ book: LibraryBook; warning?: string }> {
  if (!options.providerLookup || !options.providerLookupKey ||
    !providerMetadataDue(book, options.providerLookupKey, options.forceCatalogRefresh)) return { book };
  const providerMetadataKey = keyFor(book, options.providerLookupKey);
  try {
    const metadata = await options.providerLookup(book);
    const sources = {
      ...book.coverSources,
      providers: { ...book.coverSources?.providers, ...metadata.covers },
    };
    return {
      book: {
        ...book,
        ...(metadata.seriesPosition != null ? { seriesPosition: metadata.seriesPosition } : {}),
        coverSources: sources,
        ...resolveBookCover(sources, book.coverPreference, [book.cover, book.fallbackCover]),
        providerMetadataKey,
        providerMetadataUpdatedAt: metadata.warning ? undefined : Date.now(),
        providerMetadataRetryAt: metadata.warning ? Date.now() + RETRY_DELAY : undefined,
      },
      warning: metadata.warning,
    };
  } catch (cause) {
    return {
      book: { ...book, providerMetadataKey, providerMetadataRetryAt: Date.now() + RETRY_DELAY },
      warning: `Metadata providers: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
}
