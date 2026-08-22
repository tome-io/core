/**
 * Open Library discovery feeds — real popularity data, free, no API key:
 *  - /trending/{period}.json      : what readers are actually reading
 *  - /subjects/{key}.json?sort=trending : most-trending works per category
 *
 * Covers come from covers.openlibrary.org. On web everything routes through
 * the Metro dev proxy because openlibrary.org sends no CORS headers.
 */
export interface FeedBook {
  id: string;
  title: string;
  author: string;
  cover: string;
  year: number | '';
}

export type TrendingPeriod = 'now' | 'daily' | 'weekly' | 'monthly';

export interface FetchOpts {
  fetchFn?: typeof fetch;
}

// Web detection without importing react-native (keeps this module testable
// in plain Node): browsers have document; RN and Node don't.
const isWeb = typeof window !== 'undefined' && typeof document !== 'undefined';

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
  const author = Array.isArray(w.author_name) ? w.author_name[0] : undefined;
  const key = String(w.key || w.work_key || '');
  return {
    id: key || String(w.cover_i ?? Math.random()),
    title: String(w.title ?? '').trim(),
    author: String(author ?? 'Unknown').trim(),
    cover: coverUrl(w.cover_i, w.cover_edition_key),
    year: w.first_publish_year ?? '',
  };
}

async function getJson(url: string, opts?: FetchOpts): Promise<any> {
  const doFetch = opts?.fetchFn ?? fetch;
  const resp = await doFetch(proxied(url));
  if (!resp.ok) throw new Error(`Open Library request failed (${resp.status})`);
  return resp.json();
}

export async function getTrending(
  period: TrendingPeriod = 'daily',
  limit = 40,
  opts?: FetchOpts
): Promise<FeedBook[]> {
  const data = await getJson(
    `https://openlibrary.org/trending/${period}.json?limit=${limit}`,
    opts
  );
  const works = Array.isArray(data.works) ? data.works : [];
  return works.map(mapWork).filter((b: FeedBook) => b.title);
}

export async function getWorkDetails(
  workKey: string,
  opts?: FetchOpts
): Promise<{ description: string; subjects: string[] } | null> {
  // workKey looks like '/works/OL17930368W'
  try {
    const data = await getJson(`https://openlibrary.org${workKey}.json`, opts);
    const raw = data.description;
    const text =
      typeof raw === 'string' ? raw : typeof raw?.value === 'string' ? raw.value : '';
    return {
      description: text.trim(),
      subjects: Array.isArray(data.subjects)
        ? data.subjects.filter((x: any) => typeof x === 'string').slice(0, 8)
        : [],
    };
  } catch {
    return null;
  }
}

export async function getSubject(
  subjectKey: string,
  limit = 40,
  opts?: FetchOpts
): Promise<FeedBook[]> {
  // NOTE: sort=reading_log is broken server-side (HTTP 500); trending works.
  const data = await getJson(
    `https://openlibrary.org/subjects/${encodeURIComponent(
      subjectKey
    )}.json?limit=${limit}&sort=trending`,
    opts
  );
  const works = Array.isArray(data.works) ? data.works : [];
  return works.map(mapWork).filter((b: FeedBook) => b.title);
}
