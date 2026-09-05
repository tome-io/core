import { syncDiagnostic, traceSyncStage } from './sync-diagnostics';
import { epubSeriesPosition } from './epub-series';
import { enrichProviderMetadata, providerMetadataDue, type ProviderMetadataOptions } from './provider-metadata';
import { normalizeIsbn } from '@tomeio/domain';
import { libraryWorkCheckpoint } from './library-work-scheduler';
import { File } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import JSZip from 'jszip';

import {
  isUsableBookCoverSize,
  resolveBookCover,
  type BookCoverSources,
} from './book-cover';
import { metadataFromFilename } from './book-metadata';
import type { LibraryBook } from './library';
import {
  findBookMetadata,
  getWorkDetails,
  type DiscoveryBook,
  type FetchOpts,
} from './openlibrary';
import { readPdfMetadata } from './pdf-metadata';
import { materializeNativeFolderFile } from './native-folder-file';
import { renderNativePdfCover } from '../../modules/expo-progress-folder/src';

const COVER_DIRECTORY = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}library-covers`
  : null;
const MAX_EPUB_PARSE_SIZE = 64 * 1024 * 1024;
const MAX_PDF_PARSE_SIZE = 32 * 1024 * 1024;
const SERIAL_EPUB_PARSE_THRESHOLD = 32 * 1024 * 1024;
const ENRICH_BATCH_SIZE = 3;
const METADATA_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const METADATA_FAILURE_RETRY_MS = 15 * 60 * 1000;
const LOCAL_METADATA_VERSION = 10;
const LARGE_EPUB_METADATA_VERSION = 11;

export interface EmbeddedMetadata {
  seriesPosition?: number;
  identifiers?: Record<string, string>;
  title?: string;
  author?: string;
  cover?: string;
  description?: string;
  year?: string;
  genre?: string;
  rating?: number;
  ratingsCount?: number;
}

export interface LocalMetadataSources {
  embedded: EmbeddedMetadata;
  catalog: DiscoveryBook | null;
}

export interface MetadataWarning {
  filename: string;
  message: string;
}

function metadataVersionFor(book: LibraryBook): number {
  return book.local?.format === 'epub' &&
    book.local.size > SERIAL_EPUB_PARSE_THRESHOLD &&
    book.local.size <= MAX_EPUB_PARSE_SIZE
    ? LARGE_EPUB_METADATA_VERSION
    : LOCAL_METADATA_VERSION;
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
): Promise<string | null> {
  if (!COVER_DIRECTORY) throw new Error('The app documents directory is unavailable.');
  await FileSystem.makeDirectoryAsync(COVER_DIRECTORY, { intermediates: true });
  const extension = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || path.split('.').pop() || 'jpg';
  const uri = `${COVER_DIRECTORY}/${stableHash(`${book.fileUri}:${book.local?.modificationTime}`)}.${extension}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  const storedCover = await FileSystem.getInfoAsync(uri);
  if (!storedCover.exists) {
    throw new Error(`The extracted cover was not written to ${uri}.`);
  }
  let width = 0;
  let height = 0;
  try {
    const image = await Image.loadAsync(uri);
    width = image.width * image.scale;
    height = image.height * image.scale;
    image.release();
  } catch {
    await FileSystem.deleteAsync(uri, { idempotent: true });
    return null;
  }
  if (!isUsableBookCoverSize(width, height)) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
    return null;
  }
  return uri;
}

async function savePdfCover(
  book: LibraryBook,
  readableUri: string
): Promise<string | null> {
  if (!COVER_DIRECTORY) throw new Error('The app documents directory is unavailable.');
  if (!book.local) return null;
  await FileSystem.makeDirectoryAsync(COVER_DIRECTORY, { intermediates: true });
  const uri = `${COVER_DIRECTORY}/${stableHash(
    `${book.local.uri}:${book.local.modificationTime}:pdf-page-1`
  )}.jpg`;
  const rendered = await renderNativePdfCover(readableUri, uri);
  const aspectRatio = rendered.height > 0 ? rendered.width / rendered.height : 0;
  const usable =
    rendered.width >= 240 &&
    rendered.height >= 240 &&
    aspectRatio >= 0.35 &&
    aspectRatio <= 1.8;
  if (!usable) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
    return null;
  }
  const storedCover = await FileSystem.getInfoAsync(uri);
  if (!storedCover.exists) {
    throw new Error(`The rendered PDF cover was not written to ${uri}.`);
  }
  return uri;
}

async function readEpubMetadata(book: LibraryBook, bytes: Uint8Array): Promise<EmbeddedMetadata> {
  const zip = await JSZip.loadAsync(bytes);
  const container = await zip.file('META-INF/container.xml')?.async('string');
  if (!container) throw new Error('EPUB container metadata is missing.');
  const rootfileTag = container.match(/<rootfile\b[^>]*>/i)?.[0] ?? '';
  const packagePath = attribute(rootfileTag, 'full-path');
  if (!packagePath) throw new Error('EPUB package path is missing.');
  const packageXml = await zip.file(packagePath)?.async('string');
  if (!packageXml) throw new Error('EPUB package metadata is missing.');

  const date = elementValue(packageXml, 'date');
  const metadata: EmbeddedMetadata = {
    seriesPosition: epubSeriesPosition(packageXml),
    identifiers: Object.fromEntries(
      [...packageXml.matchAll(/<(?:[\w.-]+:)?identifier\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?identifier>/gi)]
        .flatMap((match) => {
          const isbn = normalizeIsbn(decodeXml(match[1]));
          return isbn ? [[`isbn:${isbn}`, isbn]] : [];
        }),
    ),
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
      const cover = await saveCover(book, path, mimeType, await image.async('base64'));
      if (cover) metadata.cover = cover;
    }
  }

  return metadata;
}

function applyMetadata(book: LibraryBook, metadata: EmbeddedMetadata): LibraryBook {
  return {
    ...book,
    identifiers: { ...book.identifiers, ...metadata.identifiers },
    seriesPosition: metadata.seriesPosition ?? book.seriesPosition,
    title: metadata.title || book.title,
    author: metadata.author || book.author,
    cover: metadata.cover || book.cover,
    description: metadata.description || book.description,
    year: metadata.year || book.year,
    genre: metadata.genre || book.genre,
    rating: metadata.rating ?? book.rating,
    ratingsCount: metadata.ratingsCount ?? book.ratingsCount,
    metadataPending: false,
    metadataUpdatedAt: Date.now(),
    metadataVersion: metadataVersionFor(book),
  };
}

function localMetadataDue(book: LibraryBook, force = false): boolean {
  const now = Date.now();
  return force || !book.metadataUpdatedAt || book.metadataVersion !== metadataVersionFor(book) ||
    book.metadataUpdatedAt < now - METADATA_REFRESH_MS ||
    !!(book.metadataPending && book.metadataUpdatedAt < now - METADATA_FAILURE_RETRY_MS);
}

async function enrichLocalBook(
  book: LibraryBook,
  catalogFetchOptions?: FetchOpts,
  providerOptions: ProviderMetadataOptions = {},
): Promise<{ book: LibraryBook; sources: LocalMetadataSources; warning?: MetadataWarning }> {
  if (!book.local) return { book, sources: { embedded: {}, catalog: null } };

  if (!localMetadataDue(book, providerOptions.forceCatalogRefresh)) {
    const provider = await traceSyncStage('local.provider-only', () => enrichProviderMetadata(book, providerOptions), {}, 500);
    return { ...provider, sources: { embedded: {}, catalog: null },
      warning: provider.warning ? { filename: book.local.filename, message: provider.warning } : undefined };
  }
  const localFile = book.local;
  let embedded: EmbeddedMetadata = {};
  let catalogMetadata: DiscoveryBook | null = null;
  const warningMessages: string[] = [];
  let catalogLookupFailed = false;
  const canReadEmbedded =
    (localFile.format === 'epub' && localFile.size <= MAX_EPUB_PARSE_SIZE) ||
    (localFile.format === 'pdf' && localFile.size <= MAX_PDF_PARSE_SIZE);
  let readableEmbeddedUri: string | null = null;
  const readableLocalFile = async () => {
    readableEmbeddedUri ??= await materializeNativeFolderFile(
      localFile.uri,
      localFile.filename
    );
    return readableEmbeddedUri;
  };
  if (localFile.format === 'pdf') {
    try {
      const cover = await savePdfCover(book, await readableLocalFile());
      if (cover) embedded.cover = cover;
    } catch (err: any) {
      warningMessages.push(`PDF cover could not be read: ${err.message || String(err)}`);
    }
  }
  if (canReadEmbedded) {
    try {
      const readableUri = await readableLocalFile();
      await libraryWorkCheckpoint();
      const bytes = new Uint8Array(await new File(readableUri).arrayBuffer());
      await libraryWorkCheckpoint();
      const parsed =
        localFile.format === 'epub'
          ? await traceSyncStage('local.epub-parse', () => readEpubMetadata(book, bytes), { bytes: bytes.length })
          : await readPdfMetadata(bytes);
      embedded = { ...parsed, ...(embedded.cover ? { cover: embedded.cover } : {}) };
    } catch (err: any) {
      warningMessages.push(`Embedded metadata could not be read: ${err.message || String(err)}`);
    }
  }

  const moonReaderMetadata = book.moonReader;
  const filenameMetadata = metadataFromFilename(localFile.filename, localFile.format);
  const lookupAuthorCandidate = moonReaderMetadata?.author || book.author;
  const hasNamedAuthor = !!lookupAuthorCandidate && lookupAuthorCandidate !== 'Unknown';
  const lookupTitle =
    embedded.title || book.discovery?.title ||
    moonReaderMetadata?.title ||
    (hasNamedAuthor ? book.title : filenameMetadata.title) ||
    book.title;
  const lookupAuthor =
    embedded.author || book.discovery?.author ||
    (hasNamedAuthor ? lookupAuthorCandidate : '') ||
    filenameMetadata.author;

  const needsCatalog = providerOptions.forceCatalogRefresh ||
    !(embedded.cover || book.coverSources?.local || book.coverSources?.catalog) ||
    !(embedded.description || book.description) ||
    !(embedded.genre || (book.genre !== 'Other' && book.genre !== 'Local' ? book.genre : '')) ||
    !(embedded.author || (hasNamedAuthor ? book.author : ''));
  if (needsCatalog) {
    try {
      catalogMetadata = await findBookMetadata(
        lookupTitle,
        lookupAuthor,
        catalogFetchOptions,
      );
    } catch (err: any) {
      catalogLookupFailed = true;
      warningMessages.push(`Catalog metadata lookup failed: ${err.message || String(err)}`);
    }

    if (
      catalogMetadata &&
      (!catalogMetadata.cover ||
        !catalogMetadata.description ||
        catalogMetadata.genre === 'Other') &&
      catalogMetadata.id.startsWith('/works/')
    ) {
      try {
        const details = await getWorkDetails(
          catalogMetadata.id,
          catalogFetchOptions,
        );
        catalogMetadata = {
          ...catalogMetadata,
          cover: catalogMetadata.cover || details.cover,
          description: catalogMetadata.description || details.description,
          genre:
            catalogMetadata.genre !== 'Other'
              ? catalogMetadata.genre
              : details.subjects[0] || catalogMetadata.genre,
        };
      } catch (err: any) {
        warningMessages.push(`Catalog description lookup failed: ${err.message || String(err)}`);
      }
    }

  }
  const provider = await enrichProviderMetadata({ ...book, seriesPosition: embedded.seriesPosition ?? book.seriesPosition }, providerOptions);
  book = provider.book;
  if (provider.warning) warningMessages.push(provider.warning);
  if (!embedded.cover && !book.coverSources?.local && !catalogMetadata?.cover && !book.coverSources?.catalog && !book.cover && providerOptions.coverLookup) {
    const fallback = await providerOptions.coverLookup(book);
    if (fallback) book = { ...book, coverSources: { ...book.coverSources, providers: { ...book.coverSources?.providers, [fallback.providerId]: fallback.uri } } };
  }

  const coverSources: BookCoverSources = {
    ...(book.coverSources?.providers
      ? { providers: book.coverSources.providers }
      : {}),
    ...(canReadEmbedded
      ? embedded.cover
        ? { local: embedded.cover }
        : {}
      : book.coverSources?.local
        ? { local: book.coverSources.local }
        : {}),
    ...(catalogMetadata?.cover || book.coverSources?.catalog
      ? { catalog: catalogMetadata?.cover || book.coverSources?.catalog }
      : {}),
  };
  const legacyCover =
    book.cover?.startsWith('file:') && book.cover.includes('/library-covers/')
      ? undefined
      : book.cover;
  const resolvedCover = resolveBookCover(coverSources, book.coverPreference, [
    moonReaderMetadata?.detailCoverUri,
    moonReaderMetadata?.coverUri,
    legacyCover,
    book.fallbackCover,
  ]);
  const metadata: EmbeddedMetadata = {
    seriesPosition: embedded.seriesPosition,
    identifiers: embedded.identifiers,
    title:
      embedded.title || moonReaderMetadata?.title || catalogMetadata?.title || book.title,
    author:
      embedded.author || moonReaderMetadata?.author || catalogMetadata?.author || book.author,
    cover: resolvedCover.cover,
    description:
      embedded.description ||
      moonReaderMetadata?.description ||
      catalogMetadata?.description ||
      book.description,
    year: embedded.year || (catalogMetadata?.year ? String(catalogMetadata.year) : book.year ? String(book.year) : undefined),
    genre: embedded.genre || moonReaderMetadata?.genre ||
      (catalogMetadata?.genre !== 'Other' ? catalogMetadata?.genre : undefined) ||
      (book.genre !== 'Local' ? book.genre : ''),
    rating: catalogMetadata?.rating,
    ratingsCount: catalogMetadata?.ratingsCount,
  };
  const enriched = {
    ...applyMetadata(book, metadata),
    coverSources,
    coverPreference: book.coverPreference ?? 'auto',
    fallbackCover: resolvedCover.fallbackCover,
  };
  return {
    book: catalogLookupFailed ? { ...enriched, metadataPending: true } : enriched,
    sources: { embedded, catalog: catalogMetadata },
    warning: warningMessages.length
      ? { filename: localFile.filename, message: warningMessages.join(' ') }
      : undefined,
  };
}

export async function enrichLocalLibrary(
  books: LibraryBook[],
  onBook: (book: LibraryBook, sources: LocalMetadataSources) => void | Promise<void>,
  onProgress?: (completed: number, total: number) => void,
  options: ProviderMetadataOptions = {},
): Promise<MetadataWarning[]> {
  const warnings: MetadataWarning[] = [];
  const candidates = books.filter((book) => localMetadataDue(book, options.forceCatalogRefresh) ||
    providerMetadataDue(book, options.providerLookupKey, options.forceCatalogRefresh));
  syncDiagnostic('local.candidates', { total: books.length, selected: candidates.length,
    metadata: candidates.filter((book) => localMetadataDue(book, options.forceCatalogRefresh)).length,
    providerOnly: candidates.filter((book) => !localMetadataDue(book, options.forceCatalogRefresh)).length });
  let completed = 0;
  onProgress?.(completed, candidates.length);
  for (let offset = 0; offset < candidates.length; ) {
    await libraryWorkCheckpoint();
    if (options.shouldContinue?.() === false) break;
    const nextCandidates = candidates.slice(offset, offset + ENRICH_BATCH_SIZE);
    const largeEpubIndex = nextCandidates.findIndex(
      (book) =>
        book.local?.format === 'epub' &&
        book.local.size > SERIAL_EPUB_PARSE_THRESHOLD
    );
    const batch =
      largeEpubIndex === 0
        ? nextCandidates.slice(0, 1)
        : largeEpubIndex > 0
          ? nextCandidates.slice(0, largeEpubIndex)
          : nextCandidates;
    const catalogFetchOptions = options.forceCatalogRefresh
      ? { fetchFn: fetch }
      : undefined;
    const results = await Promise.allSettled(
      batch.map((book) => enrichLocalBook(book, catalogFetchOptions, options)),
    );
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (result.status === 'fulfilled') {
        await traceSyncStage('local.persist', async () => { await onBook(result.value.book, result.value.sources); }, {}, 250);
        if (result.value.warning) warnings.push(result.value.warning);
      } else {
        await onBook(
          {
            ...batch[index],
            metadataPending: true,
            metadataUpdatedAt: Date.now(),
            metadataVersion: metadataVersionFor(batch[index]),
          },
          { embedded: {}, catalog: null }
        );
        warnings.push({
          filename: batch[index].local?.filename || batch[index].title,
          message: result.reason?.message || String(result.reason),
        });
      }
      completed += 1;
      onProgress?.(completed, candidates.length);
    }
    offset += batch.length;
  }
  return warnings;
}
