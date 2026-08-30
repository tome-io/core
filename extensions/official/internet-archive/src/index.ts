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
  firstString,
  stringArray,
  type SourceHttpOptions,
} from '@tomeio/sources';

export const manifest: ExtensionManifest = {
  manifestVersion: 1,
  id: 'org.tomeio.internet-archive',
  version: '0.3.0',
  name: 'Internet Archive — Open Books',
  description: 'Internet Archive records with rights-verified native downloads.',
  author: 'Tomeio',
  homepage: 'https://archive.org',
  types: ['book'],
  resources: [
    { name: 'catalog', supportsPagination: true },
    { name: 'search', supportsPagination: true },
    { name: 'meta' },
    { name: 'resolve', supportsPagination: true },
    { name: 'acquisition' },
  ],
  providerRoles: ['search', 'acquisition', 'cover'],
  catalogs: [
    { id: 'popular', name: 'Open Books on Internet Archive', resource: 'catalog' },
  ],
  transport: { kind: 'bundled', module: '@tomeio/extension-internet-archive' },
  permissions: { hosts: ['https://archive.org'] },
};

interface ArchiveDocument {
  identifier?: string;
  title?: string;
  creator?: string | string[];
  date?: string;
  description?: string | string[];
  subject?: string | string[];
  isbn?: string | string[];
  collection?: string | string[];
  licenseurl?: string;
  rights?: string | string[];
  uploader?: string;
  'access-restricted-item'?: boolean | string;
}

interface ArchiveSearchResponse {
  response?: {
    docs?: ArchiveDocument[];
    numFound?: number;
  };
}

interface ArchiveMetadataResponse {
  metadata?: ArchiveDocument & Record<string, unknown>;
  files?: Array<{
    name?: string;
    format?: string;
    size?: string;
    private?: boolean | string;
  }>;
}

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

function trueValue(value: unknown): boolean {
  return value === true || (typeof value === 'string' && value.toLocaleLowerCase() === 'true');
}

function collections(document: ArchiveDocument): string[] {
  return stringArray(document.collection).map((collection) => collection.toLocaleLowerCase());
}

function hasTrustedProvenance(document: ArchiveDocument): boolean {
  return collections(document).some((collection) => TRUSTED_OPEN_COLLECTIONS.has(collection));
}

function hasRestrictedAccess(document: ArchiveDocument): boolean {
  return (
    trueValue(document['access-restricted-item']) ||
    collections(document).some((collection) => RESTRICTED_COLLECTIONS.has(collection))
  );
}

function hasPermissiveLicense(document: ArchiveDocument): boolean {
  const value = document.licenseurl?.trim();
  if (!value) return false;
  let url: URL;
  try {
    url = new URL(value);
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

function mayDownload(document: ArchiveDocument): boolean {
  return (
    !hasRestrictedAccess(document) &&
    hasTrustedProvenance(document) &&
    hasPermissiveLicense(document)
  );
}

function mapDocument(document: ArchiveDocument): BookMetadata | null {
  const id = document.identifier?.trim();
  const title = document.title?.trim();
  if (!id || !title) return null;
  const year = Number.parseInt(document.date ?? '', 10);
  const isbn = firstString(document.isbn);
  return {
    id,
    title,
    authors: stringArray(document.creator),
    description: firstString(document.description),
    coverUrl: `https://archive.org/services/img/${encodeURIComponent(id)}`,
    publishedYear: Number.isFinite(year) ? year : undefined,
    subjects: stringArray(document.subject).slice(0, 12),
    identifiers: {
      internetArchive: id,
      ...(isbn ? { isbn } : {}),
    },
  };
}

function extensionForFile(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function archiveDetailsAcquisition(id: string): BookAcquisition {
  return {
    id: `${id}:internet-archive`,
    bookId: id,
    format: 'web',
    label: 'View on Internet Archive',
    openUrl: `https://archive.org/details/${encodeURIComponent(id)}`,
  };
}

function archiveSearchTerms(value: string): string | undefined {
  const tokens =
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .match(/[\p{L}\p{N}]+/gu)
      ?.slice(0, 12) ?? [];
  if (tokens.length === 0) return undefined;
  return tokens
    .map((token) => {
      const quoted = `"${token.replaceAll('"', '\\"')}"`;
      return `(title:${quoted} OR creator:${quoted} OR subject:${quoted})`;
    })
    .join(' AND ');
}

function archiveQuery(terms: string | undefined, openOnly: boolean): string {
  const clauses = [
    'mediatype:texts',
    'NOT access-restricted-item:true',
    'NOT collection:inlibrary',
    'NOT collection:internetarchivebooks',
    'NOT collection:printdisabled',
  ];
  if (terms) clauses.push(terms);
  if (openOnly) {
    clauses.push(
      `(${[...TRUSTED_OPEN_COLLECTIONS]
        .map((collection) => `collection:${collection}`)
        .join(' OR ')})`,
      'licenseurl:http*'
    );
  }
  return clauses.join(' AND ');
}

export function createInternetArchiveExtension(options: SourceHttpOptions = {}): BookExtension {
  const http = createSourceHttpClient(options);
  const metadata = (id: string) =>
    http.json<ArchiveMetadataResponse>(
      `https://archive.org/metadata/${encodeURIComponent(id)}`,
      24 * 60 * 60_000
    );

  const find = async (
    query: ExtensionQuery,
    openOnly: boolean
  ): Promise<ExtensionPage<BookMetadata>> => {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(50, Math.max(1, query.limit ?? 30));
    const terms = archiveSearchTerms(query.query?.trim() ?? '');
    const parameters = new URLSearchParams({
      q: archiveQuery(terms, openOnly),
      output: 'json',
      rows: String(openOnly ? Math.min(50, limit * 2) : limit),
      page: String(page),
      sort: 'downloads desc',
    });
    for (const field of [
      'identifier',
      'title',
      'creator',
      'date',
      'description',
      'subject',
      'isbn',
      'collection',
      'licenseurl',
      'rights',
      'uploader',
      'access-restricted-item',
    ]) {
      parameters.append('fl[]', field);
    }
    const response = await http.json<ArchiveSearchResponse>(
      `https://archive.org/advancedsearch.php?${parameters}`
    );
    const documents = response.response?.docs ?? [];
    const books = documents
      .filter((document) => !openOnly || mayDownload(document))
      .map(mapDocument)
      .filter((book): book is BookMetadata => book != null)
      .slice(0, limit);
    const numFound = response.response?.numFound;
    return {
      items: books,
      nextPage:
        typeof numFound === 'number' && page * Number(parameters.get('rows')) < numFound
          ? page + 1
          : undefined,
    };
  };

  const search = (query: ExtensionQuery) => find(query, false);

  return defineAddon(manifest, {
    search,
    resolve: (query) =>
      search({
        query: [query.book.title, ...query.book.authors].filter(Boolean).join(' '),
        page: query.page,
        limit: query.limit,
        format: query.format,
      }),
    catalog: (query) => find({ ...query, query: undefined }, true),
    meta: async (id) => mapDocument((await metadata(id)).metadata ?? {}),
    acquisition: async (id): Promise<BookAcquisition[]> => {
      const response = await metadata(id);
      const document = response.metadata ?? {};
      if (!mayDownload(document)) return [archiveDetailsAcquisition(id)];
      const downloads = (response.files ?? []).flatMap((file) => {
        const name = file.name?.trim();
        if (!name || trueValue(file.private)) return [];
        const format = extensionForFile(name);
        if (!DOWNLOAD_FORMATS.has(format)) return [];
        return [
          {
            id: `${id}:${name}`,
            bookId: id,
            format,
            label: file.format || format.toUpperCase(),
            downloadUrl: `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(name)}`,
            sizeBytes: Number.parseInt(file.size ?? '', 10) || undefined,
          },
        ];
      });
      return downloads.length > 0 ? downloads : [archiveDetailsAcquisition(id)];
    },
  });
}

export const internetArchiveExtension = createInternetArchiveExtension();
