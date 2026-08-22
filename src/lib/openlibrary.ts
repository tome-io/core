/**
 * Open Library discovery feeds — real popularity data, free, no API key:
 *  - /search.json?...&sort=trending : engaged, trending works and categories
 *
 * Covers come from covers.openlibrary.org. On web everything routes through
 * the Metro dev proxy because openlibrary.org sends no CORS headers.
 */
export interface FeedBook {
  id: string;
  title: string;
  author: string;
  cover: string;
  year: string | number;
  description: string;
  rating?: number;
  ratingsCount?: number;
}

export interface DiscoveryBook {
  id: string;
  title: string;
  author: string;
  cover: string;
  description: string;
  year: string;
  genre: string;
  rating?: number;
  ratingsCount?: number;
}

export interface FetchOpts {
  fetchFn?: typeof fetch;
}

// Web detection without importing react-native (keeps this module testable
// in plain Node): browsers have document; RN and Node don't.
const isWeb = typeof window !== 'undefined' && typeof document !== 'undefined';
const FEED_CACHE_MS = 15 * 60 * 1000;
const DETAILS_CACHE_MS = 24 * 60 * 60 * 1000;
const SEARCH_FIELDS = [
  'key',
  'title',
  'author_name',
  'cover_i',
  'cover_edition_key',
  'first_publish_year',
  'description',
  'ratings_average',
  'ratings_count',
  'subject',
].join(',');
const MODERN_FROM_YEAR = new Date().getUTCFullYear() - 10;
const QUALITY_FILTER = [
  'language:eng',
  `first_publish_year:[${MODERN_FROM_YEAR} TO *]`,
  'cover_i:*',
  'readinglog_count:[4 TO *]',
].join(' AND ');

const SUBJECT_QUERIES: Record<string, string> = {
  fantasy: 'subject_key:(fantasy OR fantasy_fiction)',
  'science-fiction': 'subject_key:(science_fiction OR science_fiction_english)',
  romance: 'subject_key:(romance OR love_stories)',
  mystery: 'subject_key:(mystery OR detective_and_mystery_stories OR thrillers)',
  'historical-fiction': 'subject_key:(historical_fiction OR history_fiction)',
  'self-help': 'subject_key:("self-help" OR self_improvement)',
  business: 'subject_key:(business OR entrepreneurship)',
  science: 'subject_key:(science OR popular_science)',
};

const responseCache = new Map<string, { expiresAt: number; value: any }>();
const pendingRequests = new Map<string, Promise<any>>();

function proxied(url: string): string {
  if (!isWeb) return url;
  return `/zlib-proxy/${encodeURIComponent(url)}`;
}

function coverUrl(coverI?: number, coverEditionKey?: string): string {
  if (coverI) return `https://covers.openlibrary.org/b/id/${coverI}-L.jpg`;
  if (coverEditionKey)
    return `https://covers.openlibrary.org/b/olid/${coverEditionKey}-L.jpg`;
  return '';
}

function mapWork(w: any): FeedBook {
  const author = Array.isArray(w.author_name)
    ? w.author_name[0]
    : Array.isArray(w.authors)
      ? w.authors[0]?.name
      : undefined;
  const rawKey = String(w.key || w.work_key || '');
  const key = /^OL\d+W$/i.test(rawKey) ? `/works/${rawKey}` : rawKey;
  const title = String(w.title ?? '').trim();
  const normalizedAuthor = String(author ?? 'Unknown').trim();
  return {
    id: key || `${title}:${normalizedAuthor}`.toLowerCase(),
    title,
    author: normalizedAuthor,
    cover: coverUrl(w.cover_i ?? w.cover_id, w.cover_edition_key),
    year: w.first_publish_year ?? '',
    description:
      typeof w.description === 'string'
        ? w.description.trim()
        : typeof w.description?.value === 'string'
          ? w.description.value.trim()
          : '',
    rating: typeof w.ratings_average === 'number' ? w.ratings_average : undefined,
    ratingsCount: typeof w.ratings_count === 'number' ? w.ratings_count : undefined,
  };
}

function normalizeLookup(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export async function findBookMetadata(
  title: string,
  author = '',
  opts?: FetchOpts
): Promise<DiscoveryBook | null> {
  const lookupAuthor = author && author !== 'Unknown' ? author : '';
  const query = new URLSearchParams({
    title,
    fields: SEARCH_FIELDS,
    limit: '8',
  });
  if (lookupAuthor) query.set('author', lookupAuthor);

  const data = await getJson(
    `https://openlibrary.org/search.json?${query}`,
    opts,
    DETAILS_CACHE_MS
  );
  const docs = Array.isArray(data.docs) ? data.docs : [];
  const wantedTitle = normalizeLookup(title);
  const wantedAuthor = normalizeLookup(lookupAuthor);
  if (wantedTitle.length < 3 || ['document', 'untitled'].includes(wantedTitle)) return null;

  const ranked = docs
    .map((doc: any) => {
      const book = mapWork(doc);
      const candidateTitle = normalizeLookup(book.title);
      const candidateAuthor = normalizeLookup(book.author);
      const titleMatches =
        candidateTitle === wantedTitle ||
        candidateTitle.includes(wantedTitle) ||
        wantedTitle.includes(candidateTitle);
      const authorMatches =
        !wantedAuthor ||
        candidateAuthor === wantedAuthor ||
        candidateAuthor.includes(wantedAuthor) ||
        wantedAuthor.includes(candidateAuthor);
      const score =
        (candidateTitle === wantedTitle ? 100 : titleMatches ? 60 : 0) +
        (candidateAuthor === wantedAuthor ? 30 : authorMatches ? 15 : 0) +
        (book.cover ? 5 : 0);
      return { book, doc, score, titleMatches, authorMatches };
    })
    .filter(({ titleMatches, authorMatches }: any) => {
      if (!titleMatches) return false;
      return !wantedAuthor || authorMatches;
    })
    .sort((a: any, b: any) => b.score - a.score);

  const match = ranked[0];
  if (!match) return null;
  const subjects = Array.isArray(match.doc.subject)
    ? match.doc.subject.filter((value: unknown) => typeof value === 'string')
    : [];
  return {
    ...match.book,
    year: String(match.book.year ?? ''),
    genre: subjects[0] || 'Other',
  };
}

async function getJson(
  url: string,
  opts?: FetchOpts,
  cacheMs = FEED_CACHE_MS
): Promise<any> {
  const doFetch = opts?.fetchFn ?? fetch;
  const shouldCache = !opts?.fetchFn;

  if (shouldCache) {
    const cached = responseCache.get(url);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const pending = pendingRequests.get(url);
    if (pending) return pending;
  }

  const request = (async () => {
    if (shouldCache) {
      const { getCachedContent } = await import('./library-db');
      const persisted = await getCachedContent<any>(`openlibrary:${url}`);
      if (persisted != null) {
        responseCache.set(url, {
          expiresAt: persisted.expiresAt,
          value: persisted.value,
        });
        return persisted.value;
      }
    }

    const resp = await doFetch(proxied(url));
    if (!resp.ok) throw new Error(`Open Library request failed (${resp.status})`);
    const value = await resp.json();
    if (shouldCache) {
      responseCache.set(url, { expiresAt: Date.now() + cacheMs, value });
      const { setCachedContent } = await import('./library-db');
      await setCachedContent(`openlibrary:${url}`, value, cacheMs);
    }
    return value;
  })();

  if (shouldCache) pendingRequests.set(url, request);

  try {
    return await request;
  } finally {
    if (shouldCache) pendingRequests.delete(url);
  }
}

export async function getTrending(limit = 40, opts?: FetchOpts): Promise<FeedBook[]> {
  return getTrendingPage(1, limit, opts);
}

export async function getWorkDetails(
  workKey: string,
  opts?: FetchOpts
): Promise<{ description: string; subjects: string[] }> {
  // workKey looks like '/works/OL17930368W'
  const data = await getJson(
    `https://openlibrary.org${workKey}.json`,
    opts,
    DETAILS_CACHE_MS
  );
  const raw = data.description;
  const text =
    typeof raw === 'string' ? raw : typeof raw?.value === 'string' ? raw.value : '';
  return {
    description: text.trim(),
    subjects: Array.isArray(data.subjects)
      ? data.subjects.filter((x: any) => typeof x === 'string').slice(0, 8)
      : [],
  };
}

export async function getSubject(
  subjectKey: string,
  limit = 40,
  opts?: FetchOpts
): Promise<FeedBook[]> {
  return getSubjectPage(subjectKey, 1, limit, opts);
}

async function getSearchPage(
  query: string,
  page: number,
  limit: number,
  opts?: FetchOpts
): Promise<FeedBook[]> {
  const data = await getJson(
    `https://openlibrary.org/search.json?q=${encodeURIComponent(
      query
    )}&fields=${SEARCH_FIELDS}&page=${page}&limit=${limit}&sort=trending&lang=en`,
    opts
  );
  const works = Array.isArray(data.docs) ? data.docs : [];
  return works.map(mapWork).filter((b: FeedBook) => b.title);
}

export async function getSubjectPage(
  subjectKey: string,
  page = 1,
  limit = 40,
  opts?: FetchOpts
): Promise<FeedBook[]> {
  const subjectQuery =
    SUBJECT_QUERIES[subjectKey] ??
    `subject_key:${subjectKey.replaceAll('-', '_').toLowerCase()}`;
  return getSearchPage(`${subjectQuery} AND ${QUALITY_FILTER}`, page, limit, opts);
}

export async function getTrendingPage(
  page = 1,
  limit = 40,
  opts?: FetchOpts
): Promise<FeedBook[]> {
  return getSearchPage(
    `trending_score_hourly_sum:[1 TO *] AND ${QUALITY_FILTER}`,
    page,
    limit,
    opts
  );
}
