import type { BookAcquisition, BookMetadata } from '@readoi/domain';
import type {
  BookExtension,
  ExtensionManifest,
  ExtensionPage,
  ExtensionQuery,
} from '@readoi/extension-protocol';
import { createSourceHttpClient, type SourceHttpOptions } from '@readoi/sources';

export const manifest: ExtensionManifest = {
  manifestVersion: 1,
  id: 'org.readoi.project-gutenberg',
  version: '0.1.0',
  name: 'Project Gutenberg',
  description: 'Public-domain books and downloads from Project Gutenberg.',
  author: 'Readio',
  homepage: 'https://www.gutenberg.org',
  types: ['book'],
  resources: [
    { name: 'catalog', supportsPagination: true },
    { name: 'search', supportsPagination: true },
    { name: 'acquisition' },
  ],
  catalogs: [
    { id: 'popular', name: 'Popular on Project Gutenberg', resource: 'catalog' },
  ],
  transport: { kind: 'bundled', module: '@readoi/extension-project-gutenberg' },
  permissions: { hosts: ['https://www.gutenberg.org'] },
};

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
      const id = rawId.match(/ebooks\/(\d+)/i)?.[1];
      const title = elementText(entry, 'title');
      if (!id || !title) return [];
      const authors = [...entry.matchAll(/<author(?:\s[^>]*)?>([\s\S]*?)<\/author>/gi)]
        .map((match) => elementText(match[1] ?? '', 'name'))
        .filter((author): author is string => Boolean(author));
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
        if (/image/i.test(rel) && /image\//i.test(type)) coverUrl ??= href;
        if (!/acquisition/i.test(rel)) continue;
        const format = acquisitionFormat(type, href);
        if (!format) continue;
        acquisitions.push({
          id: `${id}:${format}:${href}`,
          bookId: id,
          format,
          label: format.toUpperCase(),
          downloadUrl: href,
        });
      }
      return [
        {
          book: {
            id,
            title,
            authors,
            description: elementText(entry, 'content') ?? elementText(entry, 'summary'),
            coverUrl,
            subjects,
            identifiers: { projectGutenberg: id },
          },
          acquisitions,
        },
      ];
    }
  );
}

export function createProjectGutenbergExtension(options: SourceHttpOptions = {}): BookExtension {
  const http = createSourceHttpClient(options);
  const acquisitionsById = new Map<string, BookAcquisition[]>();

  const search = async (query: ExtensionQuery): Promise<ExtensionPage<BookMetadata>> => {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(50, Math.max(1, query.limit ?? 30));
    const parameters = new URLSearchParams({
      query: query.query?.trim() ?? '',
      start_index: String((page - 1) * limit + 1),
    });
    const xml = await http.text(
      `https://www.gutenberg.org/ebooks/search.opds/?${parameters}`,
      60 * 60_000
    );
    const entries = parseFeed(xml).slice(0, limit);
    for (const entry of entries) acquisitionsById.set(entry.book.id, entry.acquisitions);
    return { items: entries.map((entry) => entry.book), nextPage: page + 1 };
  };

  return {
    manifest,
    search,
    catalog: (query) => search({ ...query, query: '' }),
    acquisition: async (id) => acquisitionsById.get(id) ?? [],
  };
}

export const projectGutenbergExtension = createProjectGutenbergExtension();
