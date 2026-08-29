export type BookCoverPreference = 'auto' | 'local' | 'catalog';

export interface BookCoverSources {
  local?: string;
  catalog?: string;
}

export interface ResolvedBookCover {
  cover: string;
  fallbackCover?: string;
}

export function isUsableBookCoverSize(width: number, height: number): boolean {
  const aspectRatio = height > 0 ? width / height : 0;
  return (
    width >= 240 &&
    height >= 320 &&
    aspectRatio >= 0.45 &&
    aspectRatio <= 0.85
  );
}

export function resolveBookCover(
  sources: BookCoverSources | undefined,
  preference: BookCoverPreference = 'auto',
  additionalFallbacks: (string | undefined)[] = []
): ResolvedBookCover {
  const preferredSources =
    preference === 'catalog'
      ? [sources?.catalog, sources?.local]
      : [sources?.local, sources?.catalog];
  const candidates = [...preferredSources, ...additionalFallbacks].filter(
    (uri, index, values): uri is string => !!uri && values.indexOf(uri) === index
  );
  return {
    cover: candidates[0] ?? '',
    fallbackCover: candidates[1],
  };
}
