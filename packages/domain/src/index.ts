export interface BookMetadata {
  id: string;
  title: string;
  authors: string[];
  description?: string;
  coverUrl?: string;
  publishedYear?: number;
  subjects: string[];
  identifiers: Record<string, string>;
  rating?: number;
  ratingsCount?: number;
  acquisitions?: BookAcquisition[];
}

export interface BookAcquisition {
  id: string;
  bookId: string;
  format: string;
  label: string;
  downloadUrl?: string;
  openUrl?: string;
  sizeBytes?: number;
  language?: string;
  headers?: Record<string, string>;
}

export interface BookProgress {
  identity: string;
  progress: number;
  isRead: boolean;
  readingTimeMs?: number;
  wordsRead?: number;
  lastReadAt?: number;
  updatedAt: number;
}

export type MetadataSource = 'remote' | 'moon-reader' | 'embedded-file' | 'filename';

export interface MetadataCandidate {
  source: MetadataSource;
  metadata: Partial<BookMetadata>;
}

const METADATA_SOURCE_ORDER: readonly MetadataSource[] = [
  'remote',
  'moon-reader',
  'embedded-file',
  'filename',
];

function usefulText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function mergeBookMetadata(candidates: readonly MetadataCandidate[]): BookMetadata {
  const ordered = [...candidates].sort(
    (left, right) =>
      METADATA_SOURCE_ORDER.indexOf(left.source) -
      METADATA_SOURCE_ORDER.indexOf(right.source)
  );
  const first = ordered[0]?.metadata;
  if (!first) throw new Error('At least one metadata candidate is required.');

  const pickText = (key: 'id' | 'title' | 'description' | 'coverUrl') =>
    ordered.map((candidate) => candidate.metadata[key]).find(usefulText);
  const pickNumber = (
    key: 'publishedYear' | 'rating' | 'ratingsCount'
  ): number | undefined =>
    ordered
      .map((candidate) => candidate.metadata[key])
      .find((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const pickArray = (key: 'authors' | 'subjects'): string[] =>
    ordered
      .map((candidate) => candidate.metadata[key])
      .find((value): value is string[] => Array.isArray(value) && value.length > 0) ?? [];

  const id = pickText('id');
  const title = pickText('title');
  if (!id || !title) {
    throw new Error('Merged book metadata requires both an id and title.');
  }

  return {
    id,
    title,
    authors: pickArray('authors'),
    description: pickText('description'),
    coverUrl: pickText('coverUrl'),
    publishedYear: pickNumber('publishedYear'),
    subjects: pickArray('subjects'),
    identifiers: Object.assign(
      {},
      ...[...ordered]
        .reverse()
        .map((candidate) => candidate.metadata.identifiers ?? {})
    ),
    rating: pickNumber('rating'),
    ratingsCount: pickNumber('ratingsCount'),
  };
}

export function metadataFromFilename(
  filename: string,
  knownFormat = ''
): { title: string; author: string } {
  const normalized = filename.replaceAll('_', ' ').replace(/\s+/g, ' ').trim();
  const extension = knownFormat || normalized.match(/\.([a-z0-9]{2,5})$/i)?.[1] || '';
  let stem = extension
    ? normalized.replace(new RegExp(`\\.${extension}$`, 'i'), '')
    : normalized;
  stem = stem
    .replace(
      /\s*\([^)]*(?:z-library|z-lib(?:rary)?\.sk|1lib\.sk)[^)]*\)(?:\(\d+\))?\s*$/i,
      ''
    )
    .trim();

  const parenthesizedAuthor = stem.match(
    /\s+\(([^()]*(?:[a-z][a-z.'-]*\s+){1,}[^()]*)\)\s*$/i
  );
  if (parenthesizedAuthor) {
    return {
      title: stem.slice(0, parenthesizedAuthor.index).trim(),
      author: (parenthesizedAuthor[1] ?? '').trim(),
    };
  }

  const separator = stem.lastIndexOf(' - ');
  return {
    title: (separator > 0 ? stem.slice(0, separator) : stem).trim(),
    author: (separator > 0 ? stem.slice(separator + 3) : '').trim(),
  };
}

export function moonReaderCoverTarget(filename: string): {
  bookFilename: string;
  priority: number;
} | null {
  const match = filename.match(
    /^(.*\.(?:azw3|cbr|cbz|djvu|epub|fb2|mobi|pdf))_(\d+)\.(?:jpe?g|png|webp)$/i
  );
  if (!match) return null;
  return { bookFilename: match[1] ?? '', priority: Number(match[2]) };
}

export function normalizeBookIdentityPart(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function bookIdentity(title: string, author: string, format = ''): string {
  const primaryAuthor = (author.split('[')[0] ?? '').split(';')[0]?.trim() ?? '';
  return [
    normalizeBookIdentityPart(title),
    normalizeBookIdentityPart(primaryAuthor),
    normalizeBookIdentityPart(format),
  ].join('|');
}

export function canonicalBookIdentity(title: string, author: string): string {
  const primaryAuthor = (author.split('[')[0] ?? '').split(';')[0]?.trim() ?? '';
  return [
    normalizeBookIdentityPart(title),
    normalizeBookIdentityPart(primaryAuthor),
  ].join('|');
}

export function filenameFromUri(uri: string): string {
  const encodedDocument = uri.split('?')[0].split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(encodedDocument).split('/').pop() ?? '';
  } catch {
    return encodedDocument;
  }
}
