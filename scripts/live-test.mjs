/**
 * Ported from cinder-zlib-extension's test suite.
 *
 * Unit tests (always run) exercise parsing/challenge/mirror logic with a stubbed
 * fetch. Live tests (ZLIB_EMAIL + ZLIB_PASSWORD set, see .env.example) hit the
 * real mirrors exactly like the native app does — no proxy involved — so you
 * can confirm login/search/resolve work before testing inside the app.
 *
 * Run:  npm run test:live
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createZlibClient } from '../src/lib/zlib-core.ts';

const EMAIL = process.env.ZLIB_EMAIL;
const PASSWORD = process.env.ZLIB_PASSWORD;
// Pin to a known-good mirror first; others may sit behind bot walls
const DOMAIN = process.env.ZLIB_DOMAIN || 'https://librella.fi';

function makeStubDeps(overrides = {}) {
  const store = new Map();
  const secure = new Map();
  return {
    storeGet: async (k) => (store.has(k) ? store.get(k) : null),
    storeSet: async (k, v) => store.set(k, v),
    secureGet: async (k) => (secure.has(k) ? secure.get(k) : null),
    secureSet: async (k, v) => secure.set(k, v),
    secureDelete: async (k) => secure.delete(k),
    isWeb: false,
    _store: store,
    _secure: secure,
    ...overrides,
  };
}

async function seedDomainCache(deps, domains = [DOMAIN]) {
  await deps.storeSet('zlib_domains_cache', JSON.stringify(domains));
  await deps.storeSet('zlib_domains_cached_at', String(Date.now()));
}

// ── Unit tests ──

test('parseJson handles real-world response shapes', () => {
  const c = createZlibClient(makeStubDeps());
  assert.equal(c._parseJson('{"a":1}').a, 1);
  const obj = { a: 1 };
  assert.equal(c._parseJson(obj), obj);
  assert.equal(c._parseJson('\uFEFF{"a":1}').a, 1);
  assert.equal(
    c._parseJson('noise {"success":1,"user":{"id":5}} trailing').success,
    1
  );
  assert.equal(c._parseJson(null), null);
  assert.equal(c._parseJson(''), null);
  assert.equal(c._parseJson('<html>DiamWall</html>'), null);
});

test('parseJson extracts JSON when trailing junk contains braces', () => {
  const c = createZlibClient(makeStubDeps());
  const body = '{"success":1,"user":{"id":7}} <script>if(x){y={1:2}}</script>';
  const parsed = c._parseJson(body);
  assert.equal(parsed.success, 1);
  assert.equal(parsed.user.id, 7);
});

test('isChallenge detects anti-bot challenge pages', () => {
  const c = createZlibClient(makeStubDeps());
  assert.equal(c._isChallenge('Checking your browser before accessing'), true);
  assert.equal(c._isChallenge('<title>Just a moment...</title>'), true);
  assert.equal(c._isChallenge('DiamWall verification'), true);
  assert.equal(c._isChallenge('{"success":1}'), false);
  assert.equal(c._isChallenge(null), false);
});

test('mapBook normalizes fields and handles missing keys', () => {
  const c = createZlibClient(makeStubDeps());
  const book = c._mapBook({
    id: 123,
    md5: 'abc',
    title: ' A Title ',
    extension: 'EPUB',
    filesize: '1024',
    year: 2001,
  });
  assert.equal(book.id, '123');
  assert.equal(book.hash, 'abc');
  assert.equal(book.title, 'A Title');
  assert.equal(book.format, 'epub');
  assert.equal(book.size, 1024);
});

test('redirect responses count as mirror problems (failover)', () => {
  const c = createZlibClient(makeStubDeps());
  const fakeResp = { status: 302 };
  assert.equal(c._isMirrorProblem(fakeResp, ''), true);
  assert.equal(c._isMirrorProblem({ status: 200 }, '{"success":1}'), false);
});

test('search posts query/page/limit/format and maps results', async () => {
  const deps = makeStubDeps({
    fetchFn: async (_url, opts) => {
      assert.match(String(opts.body), /message=x%20y/);
      assert.match(String(opts.body), /page=2/);
      assert.match(String(opts.body), /limit=25/);
      assert.match(String(opts.body), /extensions\[\]=pdf/);
      assert.match(opts.headers.Cookie, /remix_userid=42/);
      assert.match(opts.headers.Cookie, /remix_userkey=KEY/);
      return new Response('{"books":[{"id":1,"hash":"h","title":"T"}]}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  await seedDomainCache(deps);
  deps._secure.set('zlib_remix_userid', '42');
  deps._secure.set('zlib_remix_userkey', 'KEY');
  const c = createZlibClient(deps);
  const results = await c.searchBooks('x y', 2, 'pdf');
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'T');
});

test('login fails over across mirrors and remembers the working one', async () => {
  let calls = [];
  const deps = makeStubDeps({
    fetchFn: async (url) => {
      calls.push(String(url));
      if (String(url).includes('librella.fi')) throw new Error('network error');
      return new Response(
        '{"success":1,"user":{"id":50185136,"remix_userkey":"rk"}}',
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    },
  });
  // librella first (seed order), lexlib second — second one must win
  await seedDomainCache(deps, ['https://librella.fi', 'https://lexlib.fi']);
  deps._secure.set('zlib_email', 'e@x.com');
  deps._secure.set('zlib_password', 'p');
  const c = createZlibClient(deps);

  const session = await c.acquireSession();
  assert.equal(session.userId, '50185136');
  assert.equal(session.userKey, 'rk');
  assert.equal(deps._store.get('zlib_domain'), 'https://lexlib.fi');
  assert.ok(calls.some((u) => u.includes('lexlib.fi')));
});

test('credential errors abort immediately without trying other mirrors', async () => {
  const deps = makeStubDeps({
    fetchFn: async () =>
      new Response('{"success":0,"error":"invalid credentials"}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  });
  await seedDomainCache(deps, [
    'https://librella.fi',
    'https://lexlib.fi',
    'https://article.sk',
  ]);
  deps._secure.set('zlib_email', 'e@x.com');
  deps._secure.set('zlib_password', 'wrong');
  const c = createZlibClient(deps);

  await assert.rejects(() => c.acquireSession(), /Login failed: invalid credentials/);
});

test('pasted remix keys are used without any login request', async () => {
  const deps = makeStubDeps({
    fetchFn: async () => {
      throw new Error('should not be called');
    },
  });
  deps._secure.set('remix_userid_paste', '77');
  deps._secure.set('remix_userkey_paste', 'PK');
  const c = createZlibClient(deps);
  const s = await c.getSession();
  assert.equal(s.userId, '77');
  assert.equal(s.userKey, 'PK');
});

test('rankZlibMatches buries workbooks/summaries and ranks title+author overlap', async () => {
  const { rankZlibMatches } = await import('../src/lib/match.ts');
  const ranked = rankZlibMatches(
    [
      { title: 'Atomic Habits Workbook', author: 'Some Publisher' },
      { title: 'Summary & Analysis of Atomic Habits', author: 'QuickRead' },
      { title: 'Atomic Habits: Tiny Changes, Remarkable Results', author: 'James Clear' },
      { title: 'Totally Different Book', author: 'Nobody' },
    ],
    'Atomic Habits',
    'James Clear'
  );
  assert.equal(ranked[0].author, 'James Clear');
  assert.ok(
    ranked.findIndex((b) => /workbook|summary/i.test(b.title)) > ranked.findIndex((b) => b.title.startsWith('Atomic Habits')),
    'real book must outrank workbook/summary spam'
  );
});

test('web mode sends cookies via X-Zlib-Cookie, native via Cookie', async () => {
  const seen = {};
  const makeDeps = (isWeb) =>
    makeStubDeps({
      isWeb,
      fetchFn: async (_url, opts) => {
        seen[isWeb ? 'web' : 'native'] = opts.headers;
        return new Response('{"books":[]}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

  for (const isWeb of [true, false]) {
    const deps = makeDeps(isWeb);
    await seedDomainCache(deps);
    deps._secure.set('zlib_remix_userid', '42');
    deps._secure.set('zlib_remix_userkey', 'KEY');
    const c = createZlibClient(deps);
    await c.searchBooks('q');
  }

  assert.ok(seen.web['X-Zlib-Cookie'], 'web must use X-Zlib-Cookie');
  assert.match(seen.web['X-Zlib-Cookie'], /remix_userid=42/);
  assert.equal(seen.web.Cookie, undefined, 'browsers drop Cookie headers anyway');
  assert.ok(seen.native.Cookie, 'native must use Cookie');
  assert.match(seen.native.Cookie, /remix_userkey=KEY/);
});

test('worker-proxy garbage JSON fails over instead of being remembered', async () => {
  // Mirrors the real incident: proxy.zlibraryproxies.workers.dev answers
  // 200 {"error":"Something went wrong…"} and must not be remembered
  const deps = makeStubDeps({
    fetchFn: async (url) => {
      const u = String(url);
      if (u.includes('workers.dev')) {
        return new Response('{"error":"Something went wrong, Log sent to Proxy Manager to handle it."}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{"books":[{"id":9,"hash":"h","title":"From good mirror"}]}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  await seedDomainCache(deps, [
    'https://proxy.zlibraryproxies.workers.dev',
    'https://librella.fi',
  ]);
  deps._secure.set('zlib_remix_userid', '42');
  deps._secure.set('zlib_remix_userkey', 'KEY');
  const c = createZlibClient(deps);

  const results = await c.searchBooks('q');
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'From good mirror');
  assert.equal(deps._store.get('zlib_domain'), 'https://librella.fi', 'good mirror remembered, worker not');
});

test('non-credential login errors fail over; credential errors abort', async () => {
  const responses = {
    'https://librella.fi': '{"error":"Something went wrong"}',
    'https://lexlib.fi': '{"success":0,"error":"Invalid email or password"}',
  };
  const deps = makeStubDeps({
    fetchFn: async (url) =>
      new Response(responses[String(url).match(/https:\/\/[^/]+/)[0]] ?? '{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  });
  await seedDomainCache(deps, ['https://librella.fi', 'https://lexlib.fi']);
  deps._secure.set('zlib_email', 'e@x.com');
  deps._secure.set('zlib_password', 'p');
  const c = createZlibClient(deps);

  // librella's generic error must be skipped (failover), then lexlib's
  // credential error aborts immediately with a descriptive message
  await assert.rejects(() => c.acquireSession(), /Login failed: Invalid email or password/);
});

test('search responses with embedded HTML descriptions are NOT mirror problems', async () => {
  // Regression: real payloads embed <i>/<br> inside JSON strings. The old
  // sniffing logic saw '<' + unparseable-truncated-JSON and rejected every
  // good response, crawling all mirrors forever.
  const payload = JSON.stringify({
    success: 1,
    books: [
      {
        id: 123544185,
        hash: 'b7b5f8',
        title: 'Bestseller',
        description: '<i><b>Hoe ver zou jij gaan?<br></b></i> ' + 'x'.repeat(4000),
      },
      { id: 2, hash: 'aa0998', title: 'Second <b>book</b>' },
    ],
  });

  let calls = 0;
  const deps = makeStubDeps({
    fetchFn: async () => {
      calls++;
      return new Response(payload, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  await seedDomainCache(deps, ['https://librella.fi']);
  deps._secure.set('zlib_remix_userid', '42');
  deps._secure.set('zlib_remix_userkey', 'KEY');
  const c = createZlibClient(deps);

  const results = await c.searchBooks('bestseller');
  assert.equal(calls, 1, 'must accept the first valid response without failover');
  assert.equal(results.length, 2);
  assert.equal(results[0].title, 'Bestseller');
});

// ── Apple Books discovery ──

test('fetchEbooks maps iTunes results and upscales artwork', async () => {
  const payload = {
    results: [
      {
        trackId: 6747972884,
        trackName: 'The Bestseller',
        artistName: 'Jane <b>Doe</b>',
        artworkUrl100: 'https://example.com/a100/cover100x100bb.jpg',
        releaseDate: '2026-06-18T07:00:00Z',
        description: '<i>Great</i> &amp; thrilling book',
        genres: ['Mysteries & Thrillers', 'Books'],
      },
      { trackName: 'no id — skipped' },
      { trackId: 6747972884, trackName: 'duplicate — skipped' },
    ],
  };
  const deps = makeStubDeps({
    fetchFn: async (url) => {
      assert.match(String(url), /media=ebook/);
      assert.match(String(url), /limit=60/);
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  const { fetchEbooks } = await import('../src/lib/books-api.ts');
  const books = await fetchEbooks('bestseller', 60, { fetchFn: deps.fetchFn });
  assert.equal(books.length, 1);
  assert.equal(books[0].id, '6747972884');
  assert.equal(books[0].title, 'The Bestseller');
  assert.equal(books[0].author, 'Jane Doe');
  assert.match(books[0].cover, /600x600bb\.jpg$/);
  assert.equal(books[0].description, 'Great & thrilling book');
  assert.equal(books[0].year, '2026');
  assert.equal(books[0].genre, 'Mysteries & Thrillers');
});

test('live: Apple Books returns real recommendations without credentials', async () => {
  const { fetchEbooks } = await import('../src/lib/books-api.ts');
  const books = await fetchEbooks('bestseller fiction', 20);
  assert.ok(Array.isArray(books));
  assert.ok(books.length >= 5, `expected several results, got ${books.length}`);
  assert.ok(books[0].title.length > 0 && books[0].author.length > 0);
  assert.match(books[0].cover, /^https:\/\/.+600x600bb\.jpg$/);
});

// ── Open Library feeds ──

test('getTrending maps works with covers and authors', async () => {
  const payload = {
    works: [
      {
        key: '/works/OL17930368W',
        title: 'Atomic Habits',
        author_name: ['James Clear'],
        cover_i: 12539702,
        first_publish_year: 2016,
      },
      { key: '/works/OLX', title: '' }, // filtered out
    ],
  };
  const { getTrending } = await import('../src/lib/openlibrary.ts');
  const books = await getTrending('daily', 10, {
    fetchFn: async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  });
  assert.equal(books.length, 1);
  assert.equal(books[0].id, '/works/OL17930368W');
  assert.equal(books[0].title, 'Atomic Habits');
  assert.equal(books[0].author, 'James Clear');
  assert.equal(books[0].cover, 'https://covers.openlibrary.org/b/id/12539702-L.jpg');
  assert.equal(books[0].year, 2016);
});

test('live: Open Library trending returns real popular books (no credentials)', async () => {
  const { getTrending } = await import('../src/lib/openlibrary.ts');
  const books = await getTrending('daily', 20);
  assert.ok(books.length >= 5, `expected several trending books, got ${books.length}`);
  assert.ok(books.some((b) => b.cover), 'expected at least some covers');
});

test('live: Open Library subject feed works', async () => {
  const { getSubject } = await import('../src/lib/openlibrary.ts');
  const books = await getSubject('science-fiction', 10);
  assert.ok(books.length >= 3, `expected subject results, got ${books.length}`);
});

// ── Live tests ──

const hasCreds = Boolean(EMAIL && PASSWORD);
const liveTest = (name, fn) =>
  test(name, { skip: !hasCreds && 'set ZLIB_EMAIL/ZLIB_PASSWORD to run live tests' }, fn);

// One shared client for all live tests; session is cached across them.
let liveClient = null;

function createLiveClient() {
  if (!liveClient) {
    const deps = makeStubDeps();
    // Pin the known-good mirror first so tests don't crawl dead ones
    deps.storeSet('zlib_domain', DOMAIN);
    // Seed creds like the app's Settings screen would
    deps.secureSet('zlib_email', EMAIL);
    deps.secureSet('zlib_password', PASSWORD);
    liveClient = createZlibClient(deps);
  }
  return liveClient;
}

liveTest('login against the real API returns and caches a remix session', async () => {
  const client = createLiveClient();
  const s = await client.acquireSession();
  assert.ok(s.userId && String(s.userId).length > 0, 'expected a user id');
  assert.ok(s.userKey && String(s.userKey).length > 5, 'expected a remix_userkey');
});

liveTest('search against the real API returns mapped book results', async () => {
  const results = await createLiveClient().searchBooks('harry potter', 1);
  assert.ok(Array.isArray(results));
  assert.ok(results.length > 0, `expected results, got ${results.length}`);
  assert.ok(results[0].id && results[0].hash, 'result must have id+hash for resolve');
  assert.ok(results[0].title.length > 0, 'result must have a title');
});

liveTest('resolve against the real API returns a download URL', async () => {
  const client = createLiveClient();
  const results = await client.searchBooks('harry potter', 1);
  const target = results[0];
  const url = await client.resolveDownload(target.id, target.hash);
  assert.match(url, /^https?:\/\//);
});
