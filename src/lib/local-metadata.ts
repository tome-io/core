import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';

import type { LibraryBook } from './library';
import { findBookMetadata, getWorkDetails } from './openlibrary';

const CACHE_PREFIX = 'reader_local_metadata_v3:';
const COVER_DIRECTORY = `${FileSystem.cacheDirectory}library-covers`;
const MAX_PARSE_SIZE = 32 * 1024 * 1024;
const ENRICH_BATCH_SIZE = 3;

interface EmbeddedMetadata {
  title?: string;
  author?: string;
  cover?: string;
  description?: string;
  year?: string;
  genre?: string;
  rating?: number;
  ratingsCount?: number;
}

interface CachedMetadata {
  fingerprint: string;
  metadata: EmbeddedMetadata;
}

export interface MetadataWarning {
  filename: string;
  message: string;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(parseInt(value, 16)))
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(parseInt(value, 10)))
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function elementValue(xml: string, localName: string): string {
  const match = xml.match(
    new RegExp(`<(?:[\\w.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${localName}>`, 'i')
  );
  return match ? decodeXml(match[1]) : '';
}

function validYear(value: string): string {
  const year = Number(value.match(/\b\d{4}\b/)?.[0]);
  return year >= 1400 && year <= new Date().getUTCFullYear() + 1 ? String(year) : '';
}

function attribute(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function resolveZipPath(baseFile: string, relativePath: string): string {
  let decodedPath = relativePath;
  try {
    decodedPath = decodeURIComponent(relativePath);
  } catch {
    // Keep the OPF path when it contains malformed URL escapes.
  }
  const parts = `${baseFile.split('/').slice(0, -1).join('/')}/${decodedPath}`.split('/');
  const normalized: string[] = [];
  parts.forEach((part) => {
    if (!part || part === '.') return;
    if (part === '..') normalized.pop();
    else normalized.push(part);
  });
  return normalized.join('/');
}

function coverMime(path: string, declared: string): string {
  if (declared.startsWith('image/')) return declared;
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  return 'image/jpeg';
}

async function saveCover(
  book: LibraryBook,
  path: string,
  mimeType: string,
  base64: string
): Promise<string> {
  if (!FileSystem.cacheDirectory) return '';
  await FileSystem.makeDirectoryAsync(COVER_DIRECTORY, { intermediates: true });
  const extension = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || path.split('.').pop() || 'jpg';
  const uri = `${COVER_DIRECTORY}/${stableHash(`${book.fileUri}:${book.local?.modificationTime}`)}.${extension}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return uri;
}

async function readEpubMetadata(book: LibraryBook, base64: string): Promise<EmbeddedMetadata> {
  const zip = await JSZip.loadAsync(base64, { base64: true });
  const container = await zip.file('META-INF/container.xml')?.async('string');
  if (!container) throw new Error('EPUB container metadata is missing.');
  const rootfileTag = container.match(/<rootfile\b[^>]*>/i)?.[0] ?? '';
  const packagePath = attribute(rootfileTag, 'full-path');
  if (!packagePath) throw new Error('EPUB package path is missing.');
  const packageXml = await zip.file(packagePath)?.async('string');
  if (!packageXml) throw new Error('EPUB package metadata is missing.');

  const date = elementValue(packageXml, 'date');
  const metadata: EmbeddedMetadata = {
    title: elementValue(packageXml, 'title'),
    author: elementValue(packageXml, 'creator'),
    description: elementValue(packageXml, 'description'),
    genre: elementValue(packageXml, 'subject'),
    year: validYear(date),
  };

  const itemTags = packageXml.match(/<item\b[^>]*>/gi) ?? [];
  const metaTags = packageXml.match(/<meta\b[^>]*>/gi) ?? [];
  const coverId = attribute(
    metaTags.find((tag) => attribute(tag, 'name').toLowerCase() === 'cover') ?? '',
    'content'
  );
  const coverItem = itemTags.find((tag) => {
    const properties = attribute(tag, 'properties').split(/\s+/);
    return properties.includes('cover-image') || (!!coverId && attribute(tag, 'id') === coverId);
  });

  if (coverItem) {
    const href = attribute(coverItem, 'href');
    const path = resolveZipPath(packagePath, href);
    const image = zip.file(path);
    if (image) {
      const mimeType = coverMime(path, attribute(coverItem, 'media-type'));
      metadata.cover = await saveCover(book, path, mimeType, await image.async('base64'));
    }
  }

  return metadata;
}

async function readPdfMetadata(base64: string): Promise<EmbeddedMetadata> {
  const pdf = await PDFDocument.load(base64, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const created = pdf.getCreationDate();
  return {
    title: pdf.getTitle()?.trim(),
    author: pdf.getAuthor()?.trim(),
    description: pdf.getSubject()?.trim(),
    year: created ? String(created.getUTCFullYear()) : '',
  };
}

function applyMetadata(book: LibraryBook, metadata: EmbeddedMetadata): LibraryBook {
  return {
    ...book,
    title: metadata.title || book.title,
    author: metadata.author || book.author,
    cover: metadata.cover || book.cover,
    description: metadata.description || book.description,
    year: metadata.year || book.year,
    genre: metadata.genre || book.genre,
    rating: metadata.rating ?? book.rating,
    ratingsCount: metadata.ratingsCount ?? book.ratingsCount,
    metadataPending: false,
  };
}

async function enrichLocalBook(
  book: LibraryBook
): Promise<{ book: LibraryBook; warning?: MetadataWarning }> {
  if (!book.local) return { book };
  const fingerprint = `${book.local.size}:${book.local.modificationTime}`;
  const cacheKey = `${CACHE_PREFIX}${stableHash(book.local.uri)}`;
  const cachedRaw = await AsyncStorage.getItem(cacheKey);
  if (cachedRaw) {
    const cached = JSON.parse(cachedRaw) as CachedMetadata;
    const coverExists = cached.metadata.cover?.startsWith('file:')
      ? (await FileSystem.getInfoAsync(cached.metadata.cover)).exists
      : true;
    if (cached.fingerprint === fingerprint && coverExists) {
      return { book: applyMetadata(book, cached.metadata) };
    }
  }

  let embedded: EmbeddedMetadata = {};
  let warning: MetadataWarning | undefined;
  if (book.local.size <= MAX_PARSE_SIZE && ['epub', 'pdf'].includes(book.local.format)) {
    try {
      const base64 = await FileSystem.readAsStringAsync(book.local.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      embedded =
        book.local.format === 'epub'
          ? await readEpubMetadata(book, base64)
          : await readPdfMetadata(base64);
    } catch (err: any) {
      warning = {
        filename: book.local.filename,
        message: err.message || String(err),
      };
    }
  }

  const title = embedded.title || book.title;
  const author = embedded.author || book.author;
  let catalogMetadata: Awaited<ReturnType<typeof findBookMetadata>> = null;
  let catalogDescription = '';
  const needsCatalogMetadata =
    (!embedded.cover && !book.cover) ||
    (!embedded.description && !book.description) ||
    (!embedded.genre && (!book.genre || book.genre === 'Local')) ||
    (!embedded.year && !book.year) ||
    book.rating == null;
  if (needsCatalogMetadata) {
    try {
      catalogMetadata = await findBookMetadata(title, author);
      if (catalogMetadata && !catalogMetadata.description && catalogMetadata.id.startsWith('/works/')) {
        const details = await getWorkDetails(catalogMetadata.id);
        catalogDescription = details.description;
      }
    } catch (err: any) {
      warning ??= {
        filename: book.local.filename,
        message: `Catalog metadata lookup failed: ${err.message || String(err)}`,
      };
    }
  }

  const metadata: EmbeddedMetadata = {
    title: catalogMetadata?.title || embedded.title || book.title,
    author: catalogMetadata?.author || embedded.author || book.author,
    cover: catalogMetadata?.cover || embedded.cover || book.cover,
    description:
      catalogMetadata?.description || catalogDescription || embedded.description || book.description,
    year: catalogMetadata?.year || embedded.year || book.year,
    genre:
      catalogMetadata?.genre && catalogMetadata.genre !== 'Other'
        ? catalogMetadata.genre
        : embedded.genre || (book.genre !== 'Local' ? book.genre : ''),
    rating: catalogMetadata?.rating,
    ratingsCount: catalogMetadata?.ratingsCount,
  };
  await AsyncStorage.setItem(cacheKey, JSON.stringify({ fingerprint, metadata } satisfies CachedMetadata));
  return { book: applyMetadata(book, metadata), warning };
}

export async function enrichLocalLibrary(
  books: LibraryBook[],
  onBook: (book: LibraryBook) => void
): Promise<MetadataWarning[]> {
  const warnings: MetadataWarning[] = [];
  for (let offset = 0; offset < books.length; offset += ENRICH_BATCH_SIZE) {
    const batch = books.slice(offset, offset + ENRICH_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(enrichLocalBook));
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        onBook(result.value.book);
        if (result.value.warning) warnings.push(result.value.warning);
      } else {
        onBook({ ...batch[index], metadataPending: false });
        warnings.push({
          filename: batch[index].local?.filename || batch[index].title,
          message: result.reason?.message || String(result.reason),
        });
      }
    });
  }
  return warnings;
}
