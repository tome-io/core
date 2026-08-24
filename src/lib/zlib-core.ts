/**
 * Platform-independent Z-Library eapi client (ported from cinder-zlib-extension).
 * All side effects (storage, secure storage, web detection) are injected so the
 * same logic runs in React Native and in plain Node live tests.
 */

export interface Book {
  id: string;
  hash: string;
  title: string;
  author: string;
  cover: string;
  description: string;
  format: string;
  size: number;
  language: string;
  publisher: string;
  year: string | number;
}

export interface Session {
  userId: string;
  userKey: string;
}

export type SearchOrder = 'bestmatch' | 'mostrecent' | 'popular';

export interface ZlibDeps {
  storeGet(key: string): Promise<string | null>;
  storeSet(key: string, value: string): Promise<void>;
  secureGet(key: string): Promise<string | null>;
  secureSet(key: string, value: string): Promise<void>;
  secureDelete(key: string): Promise<void>;
  /** True when running in a browser (needs the dev CORS proxy). */
  isWeb: boolean;
  fetchFn?: typeof fetch;
}

const SEED_DOMAINS = [
  'https://article.sk',
  'https://1lib.sk',
  'https://librella.fi',
  'https://lexlib.fi',
  'https://bookabooki.fi',
];

const DOMAINS_SOURCE =
  'https://raw.githubusercontent.com/ZlibraryKO/zlibrary.koplugin/main/assets/domains.json';
const DOMAINS_CACHE_KEY = 'zlib_domains_cache';
const DOMAINS_CACHE_AT = 'zlib_domains_cached_at';
const DOMAINS_TTL = 7 * 24 * 3600 * 1000;

const MIRROR_PREF_KEY = 'zlib_domain';
const PINNED_MIRROR_KEY = 'zlib_pinned_domain';
export const REQUEST_TIMEOUT_MS = 10000;
// After a mirror fails, skip it for this long within the process
const MIRROR_COOLDOWN_MS = 5 * 60 * 1000;
// Give up crawling mirrors after this long and surface whatever we have
const FAILOVER_DEADLINE_MS = 25 * 1000;

declare const __DEV__: boolean;
const dbg = (...args: any[]) => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.log('[zlib]', ...args);
};

export const SESSION_KEYS = {
  userId: 'zlib_remix_userid',
  userKey: 'zlib_remix_userkey',
};

function browserHeaders(): Record<string, string> {
  return {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
  };
}

function isChallenge(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  return (
    text.includes('Checking your browser') ||
    text.includes('Verifying your browser') ||
    text.includes('cf-browser-verification') ||
    text.includes('cf_challenge') ||
    text.includes('challenge-platform') ||
    text.includes('Just a moment') ||
    text.includes('DiamWall')
  );
}

function describeResp(status: number, body: unknown): string {
  const snippet = String(body ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  return `status=${status}${snippet ? ` body="${snippet}"` : ''}`;
}

function parseJson(text: unknown): any | null {
  function tryParse(str: string): any | null {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  }

  if (text == null) return null;
  if (typeof text === 'object') return text;

  const s = String(text).replace(/^\uFEFF/, '').trim();
  if (!s) return null;

  let parsed = tryParse(s);
  if (parsed !== null && typeof parsed !== 'string') return parsed;
  if (typeof parsed === 'string') return parseJson(parsed);

  // Extract a balanced {...} block starting at the first brace
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s.charAt(i);
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') {
      depth++;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        parsed = tryParse(s.slice(start, i + 1));
        if (parsed !== null && typeof parsed !== 'string') return parsed;
        break;
      }
    }
  }
  return null;
}

function mapBook(book: any): Book {
  return {
    id: book.id != null ? String(book.id) : book.md5 || book.slug || '',
    hash: book.hash || book.md5 || '',
    title: (book.title || '').trim(),
    author: (book.author || 'Unknown').trim(),
    cover: book.cover || book.cover_url || '',
    description: (book.description || book.synopsis || '').trim(),
    format: (book.extension || book.format || '').toLowerCase(),
    size: Number(book.filesize || book.size || 0) || 0,
    language: book.language || '',
    publisher: book.publisher || '',
    year: book.year || book.publishedYear || '',
  };
}

export function createZlibClient(deps: ZlibDeps) {
  const doFetch = deps.fetchFn ?? fetch;
  let pendingSession: Promise<Session> | null = null;

  // Mirror -> timestamp when it may be retried again
  const cooldownUntil = new Map<string, number>();
  const markUnusable = (domain: string) => {
    cooldownUntil.set(domain, Date.now() + MIRROR_COOLDOWN_MS);
    // Don't keep retrying a dead remembered mirror after a page reload
    void deps
      .storeGet(MIRROR_PREF_KEY)
      .then((pref) => (pref === domain ? deps.storeSet(MIRROR_PREF_KEY, '') : null))
      .catch(() => {});
  };

  // ── Web CORS proxy ──
  // Browsers block cross-origin calls to the mirrors (no CORS headers), so on
  // web requests route through the Metro dev server's /zlib-proxy endpoint.
  // Native platforms have no CORS and call mirrors directly.
  const proxied = (url: string): string =>
    deps.isWeb ? `/zlib-proxy/${encodeURIComponent(url)}` : url;

  async function fetchMirrorList(): Promise<string[]> {
    const cached = await deps.storeGet(DOMAINS_CACHE_KEY);
    const cachedAt = Number((await deps.storeGet(DOMAINS_CACHE_AT)) || 0);
    if (cached && Date.now() - cachedAt < DOMAINS_TTL) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      } catch {
        /* corrupt cache; refetch */
      }
    }

    try {
      const resp = await doFetch(DOMAINS_SOURCE, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const data = await resp.json();
      if (data?.success && Array.isArray(data.domains)) {
        const urls = data.domains
          .filter((e: any) => {
            if (!e.domain || e.contentAvailable === false) return false;
            // Cloudflare worker "proxies" aren't direct eapi hosts — hitting
            // them yields 200 {"error": "..."} with no books
            if (e.domain.endsWith('.workers.dev')) return false;
            return true;
          })
          .map((e: any) => `https://${e.domain}`);
        if (urls.length) {
          await deps.storeSet(DOMAINS_CACHE_KEY, JSON.stringify(urls));
          await deps.storeSet(DOMAINS_CACHE_AT, String(Date.now()));
        }
        return urls;
      }
    } catch {
      /* fall back to seeds */
    }
    return [];
  }

  async function candidateDomains(): Promise<string[]> {
    const pinned = await deps.storeGet(PINNED_MIRROR_KEY);
    if (pinned) return [pinned];

    const pref = await deps.storeGet(MIRROR_PREF_KEY);
    const remote = await fetchMirrorList();

    const list: string[] = [];
    const push = (u: string | null) => {
      if (u && !list.includes(u)) list.push(u);
    };
    push(pref);
    for (const s of SEED_DOMAINS) push(s);
    for (const r of remote) push(r);
    // Skip mirrors on cooldown (recently failed)
    return list.filter((d) => (cooldownUntil.get(d) ?? 0) < Date.now());
  }

  async function rememberMirror(domain: string) {
    await deps.storeSet(MIRROR_PREF_KEY, domain);
  }

  // True when a response indicates a walled/offline/looping mirror another
  // could answer instead. Redirects count: some mirrors bounce forever.
  //
  // NOTE: book payloads embed raw HTML (<i>, <br>) inside JSON string values,
  // so we can NEVER sniff for '<' inside the body — a JSON document starting
  // with '{' is JSON no matter what its contents look like.
  function isMirrorProblem(resp: Response, bodyText: string): boolean {
    if (resp.status >= 300 && resp.status < 400) return true;
    if (resp.status === 513 || resp.status === 503 || resp.status === 429) return true;
    if (isChallenge(bodyText)) return true;
    // HTML walls (Cloudflare/DiamLand pages) start with markup; JSON never does
    return bodyText.trimStart().startsWith('<');
  }

  async function saveSession(userId: string, userKey: string) {
    await deps.secureSet(SESSION_KEYS.userId, userId);
    await deps.secureSet(SESSION_KEYS.userKey, userKey);
  }

  async function getSession(): Promise<Session> {
    let userId = await deps.secureGet(SESSION_KEYS.userId);
    let userKey = await deps.secureGet(SESSION_KEYS.userKey);

    if (!userId || !userKey) {
      if (!pendingSession) {
        pendingSession = acquireSession().finally(() => {
          pendingSession = null;
        });
      }
      return pendingSession;
    }

    return { userId, userKey };
  }

  async function clearSession(): Promise<void> {
    await deps.secureDelete(SESSION_KEYS.userId);
    await deps.secureDelete(SESSION_KEYS.userKey);
  }

  // Obtain a session: prefer pasted remix keys, else password login.
  async function acquireSession(): Promise<Session> {
    const pasteId = await deps.secureGet('remix_userid_paste');
    const pasteKey = await deps.secureGet('remix_userkey_paste');
    if (pasteId && pasteKey) {
      await saveSession(pasteId, pasteKey);
      return { userId: pasteId, userKey: pasteKey };
    }

    const email = await deps.secureGet('zlib_email');
    const password = await deps.secureGet('zlib_password');

    if (!email || !password) {
      throw new Error(
        'Configure your Z-Library account in Settings first (email + password, or paste your remix keys).'
      );
    }

    const domains = await candidateDomains();
    const mirrorErrors: string[] = [];

    for (const baseUrl of domains) {
      const t0 = Date.now();
      try {
        const resp = await doFetch(proxied(`${baseUrl}/eapi/user/login`), {
          method: 'POST',
          headers: {
            ...browserHeaders(),
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Accept: 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        const bodyText = await resp.text();
        if (isMirrorProblem(resp, bodyText)) {
          markUnusable(baseUrl); // walled/offline/looping mirror, try next
          mirrorErrors.push(`${baseUrl}: ${describeResp(resp.status, bodyText)}`);
          dbg(`login ✗ ${baseUrl} (${Date.now() - t0}ms, status=${resp.status})`);
          continue;
        }

        const data = parseJson(bodyText);
        if (!data || typeof data !== 'object') {
          markUnusable(baseUrl);
          mirrorErrors.push(`${baseUrl}: ${describeResp(resp.status, bodyText)}`);
          dbg(`login ✗ ${baseUrl} (${Date.now() - t0}ms, unparseable)`);
          continue;
        }

        // Definitive credential failures abort; anything else (worker proxies
        // answering {"error": "..."}, rate limits, …) fails over instead.
        if (!data.success) {
          const error = String(data.error || '');
          if (/too many logins|try again later|login.*limit|limit reached/i.test(error)) {
            throw new Error(
              `Z-Library login temporarily blocked: ${error || 'too many login attempts'}. Wait before retrying, or save current remix keys in Settings.`
            );
          }
          if (/email|password|credentials/i.test(error)) {
            throw new Error(
              `Login failed: ${error || 'invalid credentials'}. ${describeResp(resp.status, bodyText)}`
            );
          }
          markUnusable(baseUrl);
          mirrorErrors.push(`${baseUrl}: ${describeResp(resp.status, bodyText)}`);
          continue;
        }
        if (!data.user?.remix_userkey) {
          markUnusable(baseUrl);
          mirrorErrors.push(`${baseUrl}: ${describeResp(resp.status, bodyText)}`);
          continue;
        }

        await rememberMirror(baseUrl);
        const userId = String(data.user.id);
        const userKey = data.user.remix_userkey as string;
        await saveSession(userId, userKey);
        dbg(`login ✓ ${baseUrl} (${Date.now() - t0}ms)`);
        return { userId, userKey };
      } catch (err: any) {
        if (/^(Login failed|Z-Library login temporarily blocked):/.test(String(err.message))) {
          throw err;
        }
        markUnusable(baseUrl);
        mirrorErrors.push(`${baseUrl}: ${err.message}`);
        dbg(`login ✗ ${baseUrl} (${Date.now() - t0}ms, ${String(err.message).slice(0, 60)})`);
      }
    }

    throw new Error(
      `Login failed on all mirrors.${mirrorErrors.length ? ` Last errors: ${mirrorErrors.slice(-3).join(' | ')}` : ''}`
    );
  }

  function cookieHeader(session: Session): string {
    return (
      `siteLanguageV2=en; remix_userid=${encodeURIComponent(session.userId)}` +
      `; remix_userkey=${encodeURIComponent(session.userKey)}`
    );
  }

  // Browsers forbid setting the Cookie header in fetch (silently dropped), so
  // on web cookies travel in X-Zlib-Cookie and the dev proxy converts them.
  function authHeader(session: Session): Record<string, string> {
    const cookie = cookieHeader(session);
    return deps.isWeb ? { 'X-Zlib-Cookie': cookie } : { Cookie: cookie };
  }

  async function authFetch(
    url: string,
    extra?: RequestInit,
    session?: Session
  ): Promise<{ resp: Response; text: string }> {
    const activeSession = session ?? (await getSession());
    const resp = await doFetch(proxied(url), {
      ...extra,
      headers: {
        ...browserHeaders(),
        ...(extra?.headers || {}),
        ...authHeader(activeSession),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await resp.text();
    return { resp, text };
  }

  async function authFetchWithFailover(
    pathBuilder: (domain: string) => string,
    extra?: RequestInit,
    /** When provided, the parsed JSON must pass this to count as an answer. */
    validate?: (json: any) => boolean
  ): Promise<{ resp: Response; text: string; json: any }> {
    // Resolve authentication once per logical request. Otherwise every failed
    // mirror can recursively start another full login crawl.
    const session = await getSession();
    const domains = await candidateDomains();
    let last: { resp: Response; text: string; json: any } | null = null;
    const mirrorErrors: string[] = [];
    const deadline = Date.now() + FAILOVER_DEADLINE_MS;

    for (const domain of domains) {
      if (Date.now() > deadline && last) {
        dbg('failover deadline hit, using last response from', domain);
        break;
      }
      const t0 = Date.now();
      try {
        const result = await authFetch(pathBuilder(domain), extra, session);
        const json = parseJson(result.text);
        const bad =
          isMirrorProblem(result.resp, result.text) ||
          !json ||
          (validate ? !validate(json) : false);
        if (bad) {
          markUnusable(domain);
          last = { ...result, json };
          mirrorErrors.push(`${domain}: ${describeResp(result.resp.status, result.text)}`);
          dbg(`✗ ${domain} (${Date.now() - t0}ms, status=${result.resp.status})`);
          continue;
        }
        await rememberMirror(domain);
        dbg(`✓ ${domain} (${Date.now() - t0}ms)`);
        return { ...result, json };
      } catch (err: any) {
        markUnusable(domain); // network error / timeout, try the next mirror
        mirrorErrors.push(`${domain}: ${err.message || String(err)}`);
        dbg(`✗ ${domain} (${Date.now() - t0}ms, ${String(err.message).slice(0, 60)})`);
      }
    }

    if (last) return last;
    throw new Error(
      `All Z-Library mirrors are unreachable.${
        mirrorErrors.length ? ` Last errors: ${mirrorErrors.slice(-3).join(' | ')}` : ''
      }`
    );
  }

  async function searchBooks(
    query: string,
    page = 1,
    format = '',
    order: SearchOrder = 'bestmatch'
  ): Promise<Book[]> {
    let body =
      `message=${encodeURIComponent(query)}` +
      `&order=${order}` +
      `&page=${page}` +
      `&limit=25`;
    if (format) body += `&extensions[]=${encodeURIComponent(format)}`;

    const { resp, text, json } = await authFetchWithFailover(
      (domain) => `${domain}/eapi/book/search`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      },
      // A "mirror" that answers 200 without a books array isn't answering
      // search at all (e.g. worker proxies returning {"error": ...})
      (json) => Array.isArray(json.books) || Array.isArray(json.results)
    );

    if (!json) throw new Error(`Search failed: ${describeResp(resp.status, text)}`);

    const books = json.books || json.results || [];
    return books.map(mapBook).filter((b: Book) => b.id && b.hash);
  }

  // Resolve: get direct download URL
  async function resolveDownload(bookId: string, hash: string): Promise<string> {
    if (!bookId || !hash) {
      throw new Error('Cannot resolve download: result is missing its id/hash.');
    }

    const { resp, text, json } = await authFetchWithFailover(
      (domain) =>
        `${domain}/eapi/book/${encodeURIComponent(bookId)}/${encodeURIComponent(hash)}/file`,
      undefined,
      (json) =>
        !!(json.file && (json.file.downloadLink || json.file.downloadUrl))
    );

    const link = json?.file && (json.file.downloadLink || json.file.downloadUrl);
    if (!link) throw new Error(`Resolve failed: ${describeResp(resp.status, text)}`);
    return link as string;
  }

  /** Headers (UA + remix cookies) to attach when downloading a resolved link. */
  async function downloadHeaders(): Promise<Record<string, string>> {
    const session = await getSession();
    return {
      ...browserHeaders(),
      ...authHeader(session),
    };
  }

  return {
    searchBooks,
    resolveDownload,
    downloadHeaders,
    acquireSession,
    getSession,
    clearSession,
    candidateDomains,

    // exposed for tests
    _parseJson: parseJson,
    _isChallenge: isChallenge,
    _mapBook: mapBook,
    _isMirrorProblem: isMirrorProblem,
    _markUnusable: markUnusable,
  };
}

export type ZlibClient = ReturnType<typeof createZlibClient>;
