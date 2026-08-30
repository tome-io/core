import type { BookAcquisition, BookMetadata } from '@tomeio/domain';
import {
  defineAddon,
  type BookExtension,
  type ExtensionManifest,
  type ExtensionPage,
  type ExtensionQuery,
} from '@tomeio/addon-sdk';
import {
  createSourceHttpClient,
  stringArray,
  type SourceHttpOptions,
} from '@tomeio/sources';

export const manifest: ExtensionManifest = {
  manifestVersion: 1,
  id: 'org.tomeio.open-library',
  version: '0.4.1',
  name: 'Open Library',
  description: 'Book discovery, metadata, covers, and open-access downloads from Open Library.',
  author: 'Tomeio',
  homepage: 'https://openlibrary.org',
  types: ['book'],
  resources: [
    { name: 'catalog', supportsPagination: true },
    { name: 'search', supportsPagination: true },
    { name: 'meta' },
    { name: 'resolve', supportsPagination: true },
    { name: 'acquisition' },
  ],
  providerRoles: ['discovery', 'search', 'cover', 'acquisition'],
  catalogs: [
    { id: 'trending', name: 'Trending this week', resource: 'catalog' },
    { id: 'fantasy', name: 'Fantasy', resource: 'catalog' },
    { id: 'science-fiction', name: 'Science fiction', resource: 'catalog' },
    { id: 'romance', name: 'Romance', resource: 'catalog' },
    { id: 'mystery', name: 'Mystery & crime', resource: 'catalog' },
    { id: 'historical-fiction', name: 'Historical fiction', resource: 'catalog' },
    { id: 'self-help', name: 'Self-help', resource: 'catalog' },
    { id: 'business', name: 'Business', resource: 'catalog' },
    { id: 'science', name: 'Science', resource: 'catalog' },
  ],
  transport: { kind: 'bundled', module: '@tomeio/extension-open-library' },
  permissions: {
    hosts: [
      'https://openlibrary.org',
      'https://covers.openlibrary.org',
      'https://archive.org',
    ],
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
  description?: string | { value?: string };
  ia?: string[];
  public_scan_b?: boolean;
}

interface SearchResponse {
  docs?: SearchDocument[];
  numFound?: number;
  start?: number;
}

const SEARCH_FIELDS =
  'key,title,author_name,cover_i,cover_edition_key,first_publish_year,subject,isbn,ratings_average,ratings_count,description,ia,public_scan_b';
const MODERN_FROM_YEAR = new Date().getUTCFullYear() - 10;
const QUALITY_FILTER = [
  'language:eng',
  `first_publish_year:[${MODERN_FROM_YEAR} TO *]`,
  'cover_i:*',
  'readinglog_count:[4 TO *]',
].join(' AND ');
const SUBJECT_QUERIES: Record<string, string> = {
  fantasy: 'subject_key:(fantasy OR fantasy_fiction)',
  'science-fiction': 'subject_key:(science_fiction OR science_fiction_english)',
  romance: 'subject_key:(romance OR love_stories)',
  mystery: 'subject_key:(mystery OR detective_and_mystery_stories OR thrillers)',
  'historical-fiction': 'subject_key:(historical_fiction OR history_fiction)',
  'self-help': 'subject_key:("self-help" OR self_improvement)',
  business: 'subject_key:(business OR entrepreneurship)',
  science: 'subject_key:(science OR popular_science)',
};
const SECONDARY_TITLE =
  /\b(summary|summaries|workbook|study guide|cliff.?notes|sparknotes|notes on|discussions of|coloring book)\b/i;
const TRUSTED_OPEN_COLLECTIONS = new Set([
  'biodiversity',
  'fedlink',
  'gutenberg',
  'library_of_congress',
  'national_library_of_scotland',
  'smithsonian',
]);
const RESTRICTED_COLLECTIONS = new Set([
  'bplill',
  'inlibrary',
  'internetarchivebooks',
  'printdisabled',
]);
const DOWNLOAD_FORMATS = new Set(['azw3', 'cbr', 'cbz', 'djvu', 'epub', 'fb2', 'mobi', 'pdf']);

interface OpenLibraryEditionLookup {
  key?: string;
  ocaid?: string | null;
}

interface ArchiveDocument {
  collection?: string | string[];
  licenseurl?: string;
  'access-restricted-item'?: boolean | string;
}

interface ArchiveMetadataResponse {
  metadata?: ArchiveDocument;
  files?: Array<{
    name?: string;
    format?: string;
    size?: string;
    private?: boolean | string;
  }>;
}

function trueValue(value: unknown): boolean {
  return value === true || (typeof value === 'string' && value.toLocaleLowerCase() === 'true');
}

function collections(document: ArchiveDocument): string[] {
  return stringArray(document.collection).map((collection) => collection.toLocaleLowerCase());
}

function mayDownload(document: ArchiveDocument): boolean {
  if (
    trueValue(document['access-restricted-item']) ||
    collections(document).some((collection) => RESTRICTED_COLLECTIONS.has(collection)) ||
    !collections(document).some((collection) => TRUSTED_OPEN_COLLECTIONS.has(collection))
  ) {
    return false;
  }
  const license = document.licenseurl?.trim();
  if (!license) return false;
  let url: URL;
  try {
    url = new URL(license);
  } catch {
    return false;
  }
  if (!['creativecommons.org', 'www.creativecommons.org'].includes(url.hostname.toLocaleLowerCase())) {
    return false;
  }
  const path = url.pathname.toLocaleLowerCase().replace(/\/+$/, '');
  return (
    /^\/publicdomain\/(?:mark|zero)\/1\.0$/.test(path) ||
    /^\/licenses\/(?:by|by-sa)\/(?:1\.0|2\.0|2\.5|3\.0|4\.0)(?:\/[a-z]{2})?$/.test(path)
  );
}

function extensionForFile(name: string): string {
  return name.split('.').pop()?.toLocaleLowerCase() ?? '';
}

function openLibraryPath(id: string): string {
  const normalized = id.replace(/^\/(?:works|books)\//, '');
  return normalized.endsWith('M') ? `books/${normalized}` : `works/${normalized}`;
}

function openLibraryAcquisition(id: string): BookAcquisition {
  return {
    id: `${id}:open-library`,
    bookId: id,
    format: 'web',
    label: 'View on Open Library',
    openUrl: `https://openlibrary.org/${openLibraryPath(id)}`,
  };
}

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
    description:
      typeof document.description === 'string'
        ? document.description
        : document.description?.value,
    coverUrl: coverUrl(document),
    infoUrl: `https://openlibrary.org/${openLibraryPath(id)}`,
    publishedYear: document.first_publish_year,
    subjects: document.subject?.slice(0, 12) ?? [],
    identifiers: {
      openLibrary: id,
      ...(document.isbn?.[0] ? { isbn: document.isbn[0] } : {}),
      ...(document.public_scan_b && document.ia?.[0]
        ? { internetArchive: document.ia[0] }
        : {}),
    },
    rating: document.ratings_average,
    ratingsCount: document.ratings_count,
  };
}

export function createOpenLibraryExtension(options: SourceHttpOptions = {}): BookExtension {
  const http = createSourceHttpClient(options);

  const archiveIdentifiers = async (id: string): Promise<string[]> => {
    const normalized = id.replace(/^\/(?:works|books)\//, '');
    if (normalized.endsWith('M')) {
      const edition = await http.json<{ ocaid?: string | null }>(
        `https://openlibrary.org/books/${encodeURIComponent(normalized)}.json`,
        24 * 60 * 60_000
      );
      return edition.ocaid ? [edition.ocaid] : [];
    }
    if (!normalized.endsWith('W')) return [];
    const parameters = new URLSearchParams({
      type: '/type/edition',
      works: `/works/${normalized}`,
      limit: '20',
      key: '',
      ocaid: '',
    });
    const editions = await http.json<OpenLibraryEditionLookup[]>(
      `https://openlibrary.org/query.json?${parameters}`,
      24 * 60 * 60_000
    );
    return [
      ...new Set(
        editions
          .map((edition) => edition.ocaid?.trim())
          .filter((archiveId): archiveId is string => !!archiveId)
      ),
    ];
  };

  const acquisition = async (id: string): Promise<BookAcquisition[]> => {
    const archiveIds = await archiveIdentifiers(id);
    for (const archiveId of archiveIds.slice(0, 5)) {
      const response = await http.json<ArchiveMetadataResponse>(
        `https://archive.org/metadata/${encodeURIComponent(archiveId)}`,
        24 * 60 * 60_000
      );
      const document = response.metadata ?? {};
      if (!mayDownload(document)) continue;
      const downloads = (response.files ?? []).flatMap((file) => {
        const name = file.name?.trim();
        if (!name || trueValue(file.private)) return [];
        const format = extensionForFile(name);
        if (!DOWNLOAD_FORMATS.has(format)) return [];
        return [{
          id: `${archiveId}:${name}`,
          bookId: id,
          format,
          label: file.format || format.toUpperCase(),
          downloadUrl: `https://archive.org/download/${encodeURIComponent(archiveId)}/${encodeURIComponent(name)}`,
          sizeBytes: Number.parseInt(file.size ?? '', 10) || undefined,
        } satisfies BookAcquisition];
      });
      if (downloads.length > 0) return downloads;
    }
    return [openLibraryAcquisition(id)];
  };

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

  return defineAddon(manifest, {
    search,
    resolve: (query) =>
      search({
        query: [query.book.title, ...query.book.authors]
          .filter(Boolean)
          .join(' '),
        page: query.page,
        limit: query.limit,
        format: query.format,
      }),
    catalog: (query) => {
      const catalogId = query.catalogId ?? 'trending';
      const subjectQuery =
        SUBJECT_QUERIES[catalogId] ??
        `subject_key:${catalogId.replaceAll('-', '_').toLowerCase()}`;
      const catalogQuery =
        catalogId === 'trending'
          ? `trending_score_hourly_sum:[1 TO *] AND ${QUALITY_FILTER}`
          : `${subjectQuery} AND ${QUALITY_FILTER}`;
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
        infoUrl: `https://openlibrary.org/${openLibraryPath(id)}`,
        subjects: response.subjects?.slice(0, 12) ?? [],
        identifiers: { openLibrary: id },
      };
    },
    acquisition,
  });
}

export const openLibraryExtension = createOpenLibraryExtension();
