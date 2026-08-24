import type { BookMetadata } from '@readoi/domain';
import type {
  BookExtension,
  ExtensionManifest,
  ExtensionPage,
  ExtensionQuery,
} from '@readoi/extension-protocol';
import { createSourceHttpClient, type SourceHttpOptions } from '@readoi/sources';

export const manifest: ExtensionManifest = {
  manifestVersion: 1,
  id: 'org.readoi.open-library',
  version: '0.1.0',
  name: 'Open Library',
  description: 'Trending catalogs and book metadata from Open Library.',
  author: 'Readio',
  homepage: 'https://openlibrary.org',
  types: ['book'],
  resources: [
    { name: 'catalog', supportsPagination: true },
    { name: 'search', supportsPagination: true },
    { name: 'meta' },
  ],
  catalogs: [
    { id: 'trending', name: 'Trending this week', resource: 'catalog' },
    { id: 'fantasy', name: 'Fantasy', resource: 'catalog' },
    { id: 'science-fiction', name: 'Science fiction', resource: 'catalog' },
  ],
  transport: { kind: 'bundled', module: '@readoi/extension-open-library' },
  permissions: {
    hosts: ['https://openlibrary.org', 'https://covers.openlibrary.org'],
  },
};

interface SearchDocument {
  key?: string;
  title?: string;
  author_name?: string[];
  cover_i?: number;
  first_publish_year?: number;
  subject?: string[];
  isbn?: string[];
  ratings_average?: number;
  ratings_count?: number;
}

interface SearchResponse {
  docs?: SearchDocument[];
}

function mapDocument(document: SearchDocument): BookMetadata | null {
  const title = document.title?.trim();
  const id = document.key?.replace(/^\/works\//, '');
  if (!title || !id) return null;
  return {
    id,
    title,
    authors: document.author_name?.filter(Boolean) ?? [],
    coverUrl: document.cover_i
      ? `https://covers.openlibrary.org/b/id/${document.cover_i}-L.jpg`
      : undefined,
    publishedYear: document.first_publish_year,
    subjects: document.subject?.slice(0, 12) ?? [],
    identifiers: {
      openLibrary: id,
      ...(document.isbn?.[0] ? { isbn: document.isbn[0] } : {}),
    },
    rating: document.ratings_average,
    ratingsCount: document.ratings_count,
  };
}

export function createOpenLibraryExtension(options: SourceHttpOptions = {}): BookExtension {
  const http = createSourceHttpClient(options);
  const search = async (query: ExtensionQuery): Promise<ExtensionPage<BookMetadata>> => {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(50, Math.max(1, query.limit ?? 30));
    const parameters = new URLSearchParams({
      q: query.query?.trim() || '*:*',
      fields:
        'key,title,author_name,cover_i,first_publish_year,subject,isbn,ratings_average,ratings_count',
      page: String(page),
      limit: String(limit),
      sort: 'trending',
      lang: query.language ?? 'en',
    });
    const response = await http.json<SearchResponse>(
      `https://openlibrary.org/search.json?${parameters}`
    );
    return {
      items: (response.docs ?? [])
        .map(mapDocument)
        .filter((book): book is BookMetadata => book != null),
      nextPage: page + 1,
    };
  };

  return {
    manifest,
    search,
    catalog: (query) => {
      const catalogQuery =
        query.catalogId && query.catalogId !== 'trending'
          ? `subject_key:${query.catalogId.replaceAll('-', '_')}`
          : '*:*';
      return search({ ...query, query: catalogQuery });
    },
    meta: async (id) => {
      const response = await http.json<{
        title?: string;
        description?: string | { value?: string };
        covers?: number[];
        subjects?: string[];
      }>(`https://openlibrary.org/works/${encodeURIComponent(id)}.json`, 24 * 60 * 60_000);
      if (!response.title) return null;
      const description =
        typeof response.description === 'string'
          ? response.description
          : response.description?.value;
      return {
        id,
        title: response.title,
        authors: [],
        description,
        coverUrl: response.covers?.[0]
          ? `https://covers.openlibrary.org/b/id/${response.covers[0]}-L.jpg`
          : undefined,
        subjects: response.subjects?.slice(0, 12) ?? [],
        identifiers: { openLibrary: id },
      };
    },
  };
}

export const openLibraryExtension = createOpenLibraryExtension();
