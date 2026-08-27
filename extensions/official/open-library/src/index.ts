import type { BookMetadata } from '@tomeio/domain';
import type {
  BookExtension,
  ExtensionManifest,
  ExtensionPage,
  ExtensionQuery,
} from '@tomeio/extension-protocol';
import { createSourceHttpClient, type SourceHttpOptions } from '@tomeio/sources';

export const manifest: ExtensionManifest = {
  manifestVersion: 1,
  id: 'org.tomeio.open-library',
  version: '0.1.1',
  name: 'Open Library',
  description: 'Trending catalogs and book metadata from Open Library.',
  author: 'Tomeio',
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
  transport: { kind: 'bundled', module: '@tomeio/extension-open-library' },
  permissions: {
    hosts: ['https://openlibrary.org', 'https://covers.openlibrary.org'],
  },
};

interface SearchDocument {
  key?: string;
  title?: string;
  author_name?: string[];
  cover_i?: number;
  cover_edition_key?: string;
  first_publish_year?: number;
  subject?: string[];
  isbn?: string[];
  ratings_average?: number;
  ratings_count?: number;
}

interface SearchResponse {
  docs?: SearchDocument[];
  numFound?: number;
  start?: number;
}

const SEARCH_FIELDS =
  'key,title,author_name,cover_i,cover_edition_key,first_publish_year,subject,isbn,ratings_average,ratings_count';
const SECONDARY_TITLE =
  /\b(summary|summaries|workbook|study guide|cliff.?notes|sparknotes|notes on|discussions of|coloring book)\b/i;

function isIsbnQuery(value: string): boolean {
  return /^(97[89])?\d{9}[\dXx]$/.test(value.replace(/[-\s]/g, ''));
}

function escapeSolrPhrase(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

function escapeSolrTerms(value: string): string {
  return value.replace(/[+\-!(){}[\]^"~*?:\\/]/g, '\\$&');
}

function openLibraryQuery(raw: string | undefined): string {
  const query = raw?.trim() ?? '';
  if (!query || query === '*:*') return query || '*:*';
  const isbn = query.replace(/[-\s]/g, '');
  if (isIsbnQuery(query)) return `isbn:${isbn}`;
  const phrase = escapeSolrPhrase(query);
  const terms = escapeSolrTerms(query);
  return `title:"${phrase}"^5 OR author:"${phrase}"^4 OR title:(${terms})^3 OR author:(${terms})^2 OR ${terms}`;
}

function coverUrl(document: SearchDocument): string | undefined {
  if (document.cover_i) return `https://covers.openlibrary.org/b/id/${document.cover_i}-L.jpg`;
  if (document.cover_edition_key) {
    return `https://covers.openlibrary.org/b/olid/${document.cover_edition_key}-L.jpg`;
  }
  return undefined;
}

function normalizeMatch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function relevanceScore(book: BookMetadata, query: string): number {
  const needle = normalizeMatch(query);
  const tokens = [...new Set(needle.split(/\s+/).filter((token) => token.length > 1))];
  const title = normalizeMatch(book.title);
  const authors = normalizeMatch(book.authors.join(' '));
  let score = 0;
  if (title === needle) score += 220;
  else if (title.startsWith(needle)) score += 160;
  else if (title.includes(needle)) score += 120;
  const titleHits = tokens.filter((token) => title.includes(token)).length;
  const authorHits = tokens.filter((token) => authors.includes(token)).length;
  score += titleHits * 24;
  if (tokens.length > 1 && titleHits === tokens.length) score += 50;
  if (tokens.length >= 2 && titleHits < tokens.length) {
    score -= (tokens.length - titleHits) * 30;
  }
  score += authorHits * 18;
  if (book.coverUrl) score += 10;
  if (typeof book.rating === 'number') score += Math.min(12, book.rating * 2);
  if (typeof book.ratingsCount === 'number' && book.ratingsCount > 0) {
    score += Math.min(20, Math.log10(book.ratingsCount + 1) * 8);
  }
  if (SECONDARY_TITLE.test(book.title)) score -= 120;
  if (titleHits === 0 && authorHits === 0) score -= 100;
  return score;
}

function rankSearchResults(items: BookMetadata[], query: string): BookMetadata[] {
  const needle = query.trim();
  if (!needle || needle === '*:*' || isIsbnQuery(needle)) return items;
  return [...items].sort(
    (left, right) => relevanceScore(right, needle) - relevanceScore(left, needle)
  );
}

function mapDocument(document: SearchDocument): BookMetadata | null {
  const title = document.title?.trim();
  const id = document.key?.replace(/^\/works\//, '');
  if (!title || !id) return null;
  return {
    id,
    title,
    authors: document.author_name?.filter(Boolean) ?? [],
    coverUrl: coverUrl(document),
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

  const requestPage = async (
    query: ExtensionQuery,
    q: string,
    sort?: string
  ): Promise<ExtensionPage<BookMetadata>> => {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(50, Math.max(1, query.limit ?? 30));
    const parameters = new URLSearchParams({
      q,
      fields: SEARCH_FIELDS,
      page: String(page),
      limit: String(limit),
      lang: query.language ?? 'en',
    });
    if (sort) parameters.set('sort', sort);
    const response = await http.json<SearchResponse>(
      `https://openlibrary.org/search.json?${parameters}`
    );
    const documents = response.docs ?? [];
    const items = documents
      .map(mapDocument)
      .filter((book): book is BookMetadata => book != null);
    const returnedThrough =
      (response.start ?? (page - 1) * limit) + documents.length;
    const hasMore =
      typeof response.numFound === 'number'
        ? returnedThrough < response.numFound
        : documents.length >= limit;
    return {
      items,
      nextPage: hasMore ? page + 1 : undefined,
    };
  };

  const search = async (query: ExtensionQuery): Promise<ExtensionPage<BookMetadata>> => {
    const rawQuery = query.query?.trim() ?? '';
    const result = await requestPage(query, openLibraryQuery(rawQuery));
    return {
      ...result,
      items: rankSearchResults(result.items, rawQuery),
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
      return requestPage(query, catalogQuery, 'trending');
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
