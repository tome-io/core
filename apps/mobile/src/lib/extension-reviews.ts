import type { BookReview } from '@tomeio/domain';
import type { BookExtension, ExtensionPage, ExtensionReviewsQuery } from '@tomeio/extension-protocol';

/** Stable across metadata object replacements and identifier insertion order. */
export function reviewQueryKey(query: ExtensionReviewsQuery): string {
  return JSON.stringify({
    book: {
      id: query.book.id,
      title: query.book.title,
      authors: query.book.authors,
      publishedYear: query.book.publishedYear,
      identifiers: Object.fromEntries(Object.entries(query.book.identifiers).sort(([a], [b]) => a.localeCompare(b))),
    },
    page: query.page,
    limit: query.limit,
  });
}

/** Scope concurrent reads to a loader; recreate after provider/config changes. */
export function createExtensionReviewLoader(load: (id: string) => Promise<BookExtension>) {
  const requests = new Map<string, Promise<ExtensionPage<BookReview>>>();
  return async (extensionId: string, query: ExtensionReviewsQuery): Promise<ExtensionPage<BookReview>> => {
    const key = JSON.stringify([extensionId, reviewQueryKey(query)]);
    const existing = requests.get(key);
    if (existing) return existing;
    const request = Promise.resolve().then(async () => {
      const provider = await load(extensionId);
      if (!provider.reviews) throw new Error(`Extension "${provider.manifest.name}" does not provide reviews.`);
      return provider.reviews(query);
    });
    requests.set(key, request);
    try {
      return await request;
    } finally {
      requests.delete(key);
    }
  };
}
