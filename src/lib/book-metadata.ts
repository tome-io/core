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

  const parenthesizedAuthor = stem.match(/\s+\(([^()]*(?:[a-z][a-z.'-]*\s+){1,}[^()]*)\)\s*$/i);
  if (parenthesizedAuthor) {
    return {
      title: stem.slice(0, parenthesizedAuthor.index).trim(),
      author: parenthesizedAuthor[1].trim(),
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
  const match = filename.match(/^(.*\.(?:azw3|cbr|cbz|djvu|epub|fb2|mobi|pdf))_(\d+)\.(?:jpe?g|png|webp)$/i);
  if (!match) return null;
  return { bookFilename: match[1], priority: Number(match[2]) };
}

function normalizeIdentityPart(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function bookIdentity(title: string, author: string, format = ''): string {
  const primaryAuthor = author.split('[')[0].split(';')[0].trim();
  return [
    normalizeIdentityPart(title),
    normalizeIdentityPart(primaryAuthor),
    normalizeIdentityPart(format),
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
