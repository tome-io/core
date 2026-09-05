export type BookCoverPreference =
  | 'auto'
  | 'local'
  | 'catalog'
  | `provider:${string}`;

export interface BookCoverSources {
  local?: string;
  catalog?: string;
  providers?: Record<string, string>;
}

export interface ResolvedBookCover {
  cover: string;
  fallbackCover?: string;
}

export interface ExtensionCoverLookupResult {
  providerId: string;
  uri: string;
}

export type ExtensionCoverLookup = (
  book: import('./library').LibraryBook
) => Promise<ExtensionCoverLookupResult | null>;

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
  const providerPriority = (providerId: string) =>
    providerId === 'community.tomeio.zlibrary'
      ? 0
      : 1;
  const providerEntries = Object.entries(sources?.providers ?? {}).sort(
    ([left], [right]) =>
      providerPriority(left) - providerPriority(right) ||
      left.localeCompare(right)
  );
  const selectedProvider = preference.startsWith('provider:')
    ? preference.slice('provider:'.length)
    : null;
  const providerCovers = providerEntries
    .filter(([providerId]) => providerId !== selectedProvider)
    .map(([, uri]) => uri);
  const preferredSources = selectedProvider
    ? [sources?.providers?.[selectedProvider], sources?.local, sources?.catalog, ...providerCovers]
    : preference === 'catalog'
      ? [sources?.catalog, sources?.local, ...providerCovers]
      : [sources?.local, sources?.catalog, ...providerCovers];
  const candidates = [...preferredSources, ...additionalFallbacks].filter(
    (uri, index, values): uri is string => !!uri && values.indexOf(uri) === index
  );
  return {
    cover: candidates[0] ?? '',
    fallbackCover: candidates[1],
  };
}

export interface CoverPreferenceRecord {
  coverPreference?: BookCoverPreference;
  coverPreferenceUpdatedAt?: number;
}

export function newerCoverPreference(a: CoverPreferenceRecord, b: CoverPreferenceRecord): CoverPreferenceRecord {
  const at = a.coverPreferenceUpdatedAt ?? 0;
  const bt = b.coverPreferenceUpdatedAt ?? 0;
  const winner = bt > at || (bt === at && (b.coverPreference ?? '') > (a.coverPreference ?? '')) ? b : a;
  return winner.coverPreference ? { coverPreference: winner.coverPreference, coverPreferenceUpdatedAt: winner.coverPreferenceUpdatedAt ?? 0 } : {};
}

export async function resolveGeneratedCoverUri(
  uri: string,
  documentDirectory: string | null,
  exists: (uri: string) => Promise<boolean>,
): Promise<string | undefined> {
  if (await exists(uri)) return uri;
  // iOS may move the Documents directory when replacing an app binary.
  const marker = '/library-covers/';
  const offset = uri.lastIndexOf(marker);
  if (!documentDirectory || offset < 0) return undefined;
  const relative = uri.slice(offset + 1);
  const relocated = `${documentDirectory.replace(/\/$/, '')}/${relative}`;
  if (relocated !== uri && await exists(relocated)) return relocated;
  return undefined;
}
