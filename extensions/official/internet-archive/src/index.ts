import type { BookAcquisition, BookMetadata } from '@readoi/domain';
import type {
  BookExtension,
  ExtensionManifest,
  ExtensionPage,
  ExtensionQuery,
} from '@readoi/extension-protocol';
import {
  createSourceHttpClient,
  firstString,
  stringArray,
  type SourceHttpOptions,
} from '@readoi/sources';

export const manifest: ExtensionManifest = {
  manifestVersion: 1,
  id: 'org.readoi.internet-archive',
  version: '0.1.0',
  name: 'Internet Archive',
  description: 'Public book records and available files from the Internet Archive.',
  author: 'Readio',
  homepage: 'https://archive.org',
  types: ['book'],
  resources: [
    { name: 'catalog', supportsPagination: true },
    { name: 'search', supportsPagination: true },
    { name: 'meta' },
    { name: 'acquisition' },
  ],
  catalogs: [
    { id: 'popular', name: 'Popular on Internet Archive', resource: 'catalog' },
  ],
  transport: { kind: 'bundled', module: '@readoi/extension-internet-archive' },
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
}

interface ArchiveSearchResponse {
  response?: { docs?: ArchiveDocument[] };
}

interface ArchiveMetadataResponse {
  metadata?: ArchiveDocument & Record<string, unknown>;
  files?: Array<{
    name?: string;
    format?: string;
    size?: string;
    private?: string;
  }>;
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

export function createInternetArchiveExtension(options: SourceHttpOptions = {}): BookExtension {
  const http = createSourceHttpClient(options);
  const metadata = (id: string) =>
    http.json<ArchiveMetadataResponse>(
      `https://archive.org/metadata/${encodeURIComponent(id)}`,
      24 * 60 * 60_000
    );

  const search = async (query: ExtensionQuery): Promise<ExtensionPage<BookMetadata>> => {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(50, Math.max(1, query.limit ?? 30));
    const terms = query.query?.trim();
    const parameters = new URLSearchParams({
      q: `mediatype:texts AND collection:opensource${terms ? ` AND (${terms})` : ''}`,
      output: 'json',
      rows: String(limit),
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
    ]) {
      parameters.append('fl[]', field);
    }
    const response = await http.json<ArchiveSearchResponse>(
      `https://archive.org/advancedsearch.php?${parameters}`
    );
    return {
      items: (response.response?.docs ?? [])
        .map(mapDocument)
        .filter((book): book is BookMetadata => book != null),
      nextPage: page + 1,
    };
  };

  return {
    manifest,
    search,
    catalog: (query) => search({ ...query, query: undefined }),
    meta: async (id) => mapDocument((await metadata(id)).metadata ?? {}),
    acquisition: async (id): Promise<BookAcquisition[]> => {
      const response = await metadata(id);
      const formats = new Set(['epub', 'pdf', 'mobi']);
      return (response.files ?? []).flatMap((file) => {
        const name = file.name?.trim();
        if (!name || file.private === 'true') return [];
        const format = extensionForFile(name);
        if (!formats.has(format)) return [];
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
    },
  };
}

export const internetArchiveExtension = createInternetArchiveExtension();
