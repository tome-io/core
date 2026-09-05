import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bookIdentity,
  filenameFromUri,
  metadataFromFilename,
} from '../src/lib/book-metadata.ts';
import {
  isUsableBookCoverSize,
  resolveBookCover,
  resolveGeneratedCoverUri,
} from '../src/lib/book-cover.ts';
import { findBookMetadata, getWorkDetails } from '../src/lib/openlibrary.ts';

const LIVE = process.env.LIVE_OPENLIBRARY === '1';

test('prefers a usable local cover and keeps the catalog cover as fallback', () => {
  assert.deepEqual(
    resolveBookCover({ local: 'file:///local.jpg', catalog: 'https://catalog.jpg' }),
    { cover: 'file:///local.jpg', fallbackCover: 'https://catalog.jpg' }
  );
});

test('honors a catalog cover preference while retaining local failover', () => {
  assert.deepEqual(
    resolveBookCover(
      { local: 'file:///local.jpg', catalog: 'https://catalog.jpg' },
      'catalog'
    ),
    { cover: 'https://catalog.jpg', fallbackCover: 'file:///local.jpg' }
  );
});

test('rejects tiny or non-cover-shaped embedded images', () => {
  assert.equal(isUsableBookCoverSize(600, 900), true);
  assert.equal(isUsableBookCoverSize(120, 180), false);
  assert.equal(isUsableBookCoverSize(1200, 400), false);
});

test('normalizes the real Moon+ and Z-Library filename shapes', () => {
  const cases = [
    [
      'The Martian (Andy Weir) (z-library.sk, 1lib.sk, z-lib.sk).epub',
      'The Martian',
      'Andy Weir',
    ],
    [
      'A Knight of the Seven Kingdoms (George R. R. Martin [R. R. Martin, George]) (z-library.sk, 1lib.sk, z-lib.sk)(1).epub',
      'A Knight of the Seven Kingdoms',
      'George R. R. Martin [R. R. Martin, George]',
    ],
    [
      'Building Applications with AI Agents Designing and Implementing Multiagent Systems (Michael Albada) (z-library.sk, 1lib.sk, z-lib.sk).pdf',
      'Building Applications with AI Agents Designing and Implementing Multiagent Systems',
      'Michael Albada',
    ],
  ];

  for (const [filename, title, author] of cases) {
    assert.deepEqual(metadataFromFilename(filename), { title, author });
  }
});

test('preserves hash characters in Android SAF filenames', () => {
  assert.equal(
    filenameFromUri(
      'content://com.android.externalstorage.documents/tree/primary%3ABooks/document/primary%3ABooks%2FSA%20Mountain%20%2395.pdf'
    ),
    'SA Mountain #95.pdf'
  );
});

test('matches Moon+ and local copies using canonical title, author and format', () => {
  const local = metadataFromFilename(
    'A Knight of the Seven Kingdoms (George R. R. Martin [R. R. Martin, George]) (z-library.sk, 1lib.sk, z-lib.sk).epub'
  );
  assert.equal(
    bookIdentity(local.title, local.author, 'epub'),
    bookIdentity('A Knight of the Seven Kingdoms', 'George R. R. Martin', 'epub')
  );
});

test('Open Library search covers use stable cover IDs, never guessed ISBN URLs', async () => {
  const metadata = await findBookMetadata('Project Hail Mary', 'Andy Weir', {
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          docs: [
            {
              key: '/works/OL21653908W',
              title: 'Project Hail Mary',
              author_name: ['Andy Weir'],
              cover_i: 14676289,
              isbn: ['9781098176501'],
            },
          ],
        }),
        { status: 200 }
      ),
  });

  assert.equal(metadata?.cover, 'https://covers.openlibrary.org/b/id/14676289-L.jpg');
  assert.doesNotMatch(metadata?.cover ?? '', /\/isbn\//);
});

test('ignores an isolated bad first-published year from Open Library', async () => {
  const metadata = await findBookMetadata('11/22/63', 'Stephen King', {
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          docs: [
            {
              key: '/works/OL16002468W',
              title: '11/22/63',
              author_name: ['Stephen King'],
              cover_i: 10713447,
              first_publish_year: 1925,
              publish_year: [1925, 2011, 2012, 2013, 2014, 2020],
            },
          ],
        }),
        { status: 200 }
      ),
  });
  assert.equal(metadata?.year, '2011');
});

test('known Moon+ catalog identities resolve to working remote covers', { skip: !LIVE }, async () => {
  const books = [
    ['A Knight of the Seven Kingdoms', 'George R. R. Martin'],
    ['11/22/63: A Novel', 'Stephen King'],
    ['The Running Man', 'Stephen King'],
    ['IT', 'Stephen King'],
    ['Long Walk', 'Stephen King'],
    ['The Count of Monte Cristo', 'Alexandre Dumas'],
    ['The Girl with the Dragon Tattoo', 'Stieg Larsson'],
    ['The Subtle Art of Not Giving a F*ck', 'Mark Manson'],
    ['Dungeon Crawler Carl', 'Matt Dinniman'],
    ["Carl's Doomsday Scenario: Dungeon Crawler Carl Book 2", 'Matt Dinniman'],
    ["The Dungeon Anarchist's Cookbook: Dungeon Crawler Carl Book 3", 'Matt Dinniman'],
  ];

  for (const [title, author] of books) {
    const metadata = await findBookMetadata(title, author, { fetchFn: fetch });
    assert.ok(metadata, `${title} should resolve in Open Library`);
    let cover = metadata.cover;
    if (!cover && metadata.id.startsWith('/works/')) {
      cover = (await getWorkDetails(metadata.id, { fetchFn: fetch })).cover;
    }
    assert.ok(cover, `${title} should have a remote cover`);
    assert.doesNotMatch(cover, /\/isbn\//);
    const response = await fetch(cover);
    assert.ok(response.ok, `${title} cover returned ${response.status}`);
    await response.body?.cancel();
  }
});

test('recovers generated covers after the app Documents path changes', async () => {
  const old = 'file:///old/Documents/library-covers/book.jpg';
  const current = 'file:///new/Documents/library-covers/book.jpg';
  assert.equal(await resolveGeneratedCoverUri(old, 'file:///new/Documents/', async (uri) => uri === current), current);
  assert.equal(await resolveGeneratedCoverUri(old, 'file:///new/Documents/', async () => false), undefined);
  assert.equal(await resolveGeneratedCoverUri(old, null, async (uri) => uri === old), old);
});
