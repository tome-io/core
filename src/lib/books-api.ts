/**
 * Apple Books discovery via the public iTunes Search API.
 * Free, no API key, CORS-enabled (Access-Control-Allow-Origin: *) so it works
 * on web directly — no proxy needed. Z-Library stays the download source.
 */

export interface ExternalBook {
  id: string;
  title: string;
  author: string;
  cover: string;
  description: string;
  year: string;
  genre: string;
}

const API = 'https://itunes.apple.com/search';

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function stripHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/gi, (m, code: string) => {
      if (code.startsWith('#')) {
        const num = code[1] === 'x' || code[1] === 'X'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
        return Number.isFinite(num) ? String.fromCodePoint(num) : ' ';
      }
      return ENTITIES[code.toLowerCase()] ?? ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function upscaleArtwork(url: string): string {
  return url.replace('100x100bb', '600x600bb');
}

export interface FetchOptions {
  /** ISO country code for the iTunes storefront. */
  country?: string;
  /** ISO language, e.g. 'en-us' — biases results and descriptions. */
  lang?: string;
  /** Injectable fetch for tests. */
  fetchFn?: typeof fetch;
}

export async function fetchEbooks(
  term: string,
  limit = 60,
  opts: FetchOptions = {}
): Promise<ExternalBook[]> {
  const doFetch = opts.fetchFn ?? fetch;
  const params = new URLSearchParams({
    term,
    media: 'ebook',
    entity: 'ebook',
    limit: String(Math.min(limit, 200)),
    country: opts.country ?? 'us',
  });
  if (opts.lang) params.set('lang', opts.lang);

  const resp = await doFetch(`${API}?${params.toString()}`);
  if (!resp.ok) throw new Error(`Apple Books search failed (${resp.status})`);

  const data = await resp.json();
  if (!data || !Array.isArray(data.results)) {
    throw new Error('Unexpected Apple Books response.');
  }

  const seen = new Set<string>();
  const books: ExternalBook[] = [];
  for (const r of data.results) {
    const id = r.trackId != null ? String(r.trackId) : '';
    const title = stripHtml(r.trackName);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    books.push({
      id,
      title,
      author: stripHtml(r.artistName) || 'Unknown',
      cover: r.artworkUrl100 ? upscaleArtwork(r.artworkUrl100) : '',
      description: stripHtml(r.description),
      year: r.releaseDate ? String(r.releaseDate).slice(0, 4) : '',
      genre: Array.isArray(r.genres) && r.genres.length ? String(r.genres[0]) : '',
    });
  }
  return books;
}

export interface BookRating {
  averageRating?: number;
  ratingsCount?: number;
}

/** Google Books requires a free API key (Google Cloud Console -> Books API). */
export async function getGoogleRating(
  title: string,
  author: string,
  apiKey: string,
  fetchFn?: typeof fetch
): Promise<BookRating | null> {
  if (!apiKey) return null;
  const doFetch = fetchFn ?? fetch;
  const q = `intitle:${title} inauthor:${author}`;
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&key=${apiKey}&maxResults=1`;
  try {
    const resp = await doFetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    const v = data?.items?.[0]?.volumeInfo;
    if (!v || v.averageRating == null) return null;
    return { averageRating: v.averageRating, ratingsCount: v.ratingsCount };
  } catch {
    return null;
  }
}
