import type { BookAcquisition, BookMetadata } from '@tomeio/domain';
import {
  defineAddon,
  type BookExtension,
  type ExtensionManifest,
  type ExtensionPage,
  type ExtensionQuery,
} from '@tomeio/addon-sdk';
import { createSourceHttpClient, type SourceHttpOptions } from '@tomeio/sources';

export const manifest: ExtensionManifest = {
  manifestVersion: 1,
  id: 'org.tomeio.project-gutenberg',
  version: '0.2.0',
  name: 'Project Gutenberg',
  description: 'Public-domain books and downloads from Project Gutenberg.',
  author: 'Tomeio',
  homepage: 'https://www.gutenberg.org',
  types: ['book'],
  resources: [
    { name: 'catalog', supportsPagination: true },
    { name: 'search', supportsPagination: true },
    { name: 'resolve', supportsPagination: true },
    { name: 'acquisition' },
  ],
  providerRoles: ['discovery', 'search', 'acquisition'],
  catalogs: [
    { id: 'popular', name: 'Popular on Project Gutenberg', resource: 'catalog' },
  ],
  transport: { kind: 'bundled', module: '@tomeio/extension-project-gutenberg' },
  permissions: { hosts: ['https://www.gutenberg.org'] },
};

const OPDS_PAGE_SIZE = 25;
const GUTENBERG_USER_AGENT = 'Tomeio/0.1 (+https://github.com/tome-io/core)';

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function elementText(xml: string, tag: string): string | undefined {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = xml.match(new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, 'i'));
  const value = match?.[1] ? decodeXml(match[1]) : '';
  return value || undefined;
}

function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'));
  return match?.[1] ? decodeXml(match[1]) : undefined;
}

function acquisitionFormat(type: string, href: string): string | null {
  if (/epub/i.test(type) || /\.epub(?:$|\?)/i.test(href)) return 'epub';
  if (/pdf/i.test(type) || /\.pdf(?:$|\?)/i.test(href)) return 'pdf';
  if (/kindle|mobi/i.test(type) || /\.(?:mobi|azw3)(?:$|\?)/i.test(href)) return 'mobi';
  if (/text\/plain/i.test(type) || /\.txt(?:$|\?)/i.test(href)) return 'txt';
  return null;
}

function bookId(value: string): string | undefined {
  return value.match(/ebooks\/(\d+)/i)?.[1] ?? value.match(/urn:gutenberg:(\d+)/i)?.[1];
}

function absoluteGutenbergUrl(value: string): string {
  const url = new URL(value, 'https://www.gutenberg.org');
  if (url.hostname === 'www.gutenberg.org') url.protocol = 'https:';
  return url.toString();
}

function parseFeed(xml: string): Array<{
  book: BookMetadata;
  acquisitions: BookAcquisition[];
}> {
  return [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].flatMap(
    (entryMatch) => {
      const entry = entryMatch[1] ?? '';
      const rawId = elementText(entry, 'id') ?? '';
      const id = bookId(rawId);
      const title = elementText(entry, 'title');
      if (!id || !title) return [];
      const structuredAuthors = [...entry.matchAll(/<author(?:\s[^>]*)?>([\s\S]*?)<\/author>/gi)]
        .map((match) => elementText(match[1] ?? '', 'name'))
        .filter((author): author is string => Boolean(author));
      const content = elementText(entry, 'content');
      let authors = structuredAuthors;
      if (authors.length === 0 && content) authors = [content];
      const subjects = [...entry.matchAll(/<category\b[^>]*>/gi)]
        .map((match) => attribute(match[0], 'label') ?? attribute(match[0], 'term'))
        .filter((subject): subject is string => Boolean(subject));
      let coverUrl: string | undefined;
      const acquisitions: BookAcquisition[] = [];
      for (const link of entry.matchAll(/<link\b[^>]*>/gi)) {
        const rawHref = attribute(link[0], 'href');
        const rel = attribute(link[0], 'rel') ?? '';
        const type = attribute(link[0], 'type') ?? '';
        if (!rawHref) continue;
        const href = absoluteGutenbergUrl(rawHref);
        if (/image/i.test(rel) && /image\//i.test(type) && href.startsWith('https://')) {
          coverUrl ??= href;
        }
        if (!/acquisition/i.test(rel)) continue;
        const format = acquisitionFormat(type, href);
        if (!format) continue;
        acquisitions.push({
          id: `${id}:${format}:${href}`,
          bookId: id,
          format,
          label: attribute(link[0], 'title') ?? format.toUpperCase(),
          downloadUrl: href,
          sizeBytes: Number.parseInt(attribute(link[0], 'length') ?? '', 10) || undefined,
        });
      }
      return [
        {
          book: {
            id,
            title,
            authors,
            description:
              elementText(entry, 'summary') ??
              (structuredAuthors.length > 0 ? content : undefined),
            coverUrl:
              coverUrl ??
              `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`,
            subjects,
            identifiers: { projectGutenberg: id },
          },
          acquisitions,
        },
      ];
    }
  );
}

function hasNextPage(xml: string): boolean {
  return [...xml.matchAll(/<link\b[^>]*>/gi)].some((match) => {
    const rel = attribute(match[0], 'rel') ?? '';
    return rel.split(/\s+/).includes('next');
  });
}

function normalizedTerms(value: string): string[] {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

function matchesAllTerms(book: BookMetadata, query: string): boolean {
  const terms = normalizedTerms(query);
  if (terms.length < 2) return true;
  const searchable = normalizedTerms([book.title, ...book.authors].join(' '));
  return terms.every((term) => searchable.includes(term));
}

export function createProjectGutenbergExtension(options: SourceHttpOptions = {}): BookExtension {
  const http = createSourceHttpClient({
    ...options,
    headers: {
      'User-Agent': GUTENBERG_USER_AGENT,
      ...options.headers,
    },
  });
  const acquisitionsById = new Map<string, BookAcquisition[]>();

  const search = async (query: ExtensionQuery): Promise<ExtensionPage<BookMetadata>> => {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(OPDS_PAGE_SIZE, Math.max(1, query.limit ?? OPDS_PAGE_SIZE));
    const terms = query.query?.trim() ?? '';
    const parameters = new URLSearchParams({
      query: terms,
      start_index: String((page - 1) * limit + 1),
    });
    const xml = await http.text(
      `https://www.gutenberg.org/ebooks/search.opds/?${parameters}`,
      60 * 60_000
    );
    const entries = parseFeed(xml)
      .filter((entry) => matchesAllTerms(entry.book, terms))
      .slice(0, limit);
    for (const entry of entries) acquisitionsById.set(entry.book.id, entry.acquisitions);
    return {
      items: entries.map((entry) => entry.book),
      nextPage: hasNextPage(xml) ? page + 1 : undefined,
    };
  };

  return defineAddon(manifest, {
    search,
    resolve: (query) =>
      search({
        query: [query.book.title, ...query.book.authors].filter(Boolean).join(' '),
        page: query.page,
        limit: query.limit,
        format: query.format,
      }),
    catalog: (query) => search({ ...query, query: '' }),
    acquisition: async (id) => {
      const cached = acquisitionsById.get(id);
      if (cached?.length) return cached;
      if (!/^\d+$/.test(id)) throw new Error(`Invalid Project Gutenberg book id "${id}".`);
      const xml = await http.text(
        `https://www.gutenberg.org/ebooks/${id}.opds`,
        24 * 60 * 60_000
      );
      const acquisitions = [
        ...new Map(
          parseFeed(xml)
            .flatMap((entry) => entry.acquisitions)
            .map((acquisition) => [acquisition.downloadUrl, acquisition] as const)
        ).values(),
      ];
      acquisitionsById.set(id, acquisitions);
      return acquisitions;
    },
  });
}

export const projectGutenbergExtension = createProjectGutenbergExtension();
