import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enrichProviderMetadata, providerMetadataDue, needsProviderMetadata } from '../src/lib/provider-metadata';
import { newerCoverPreference } from '../src/lib/book-cover';
import { epubSeriesPosition } from '../src/lib/epub-series';
import type { LibraryBook } from '../src/lib/library';

const book: LibraryBook = { key: 'book', id: 'book', title: 'Book', author: 'Author', cover: 'https://example.test/local.jpg', year: '', description: '', genre: 'Other', addedAt: 1,
  coverSources: { local: 'https://example.test/local.jpg' }, coverPreference: 'provider:hardcover', coverPreferenceUpdatedAt: 2 };

test('automatic enrichment adds series despite an existing cover and resolves a synced provider choice', async () => {
  let calls = 0;
  const options = { providerLookupKey: 'hardcover@1', providerLookup: async () => { calls++; return { seriesPosition: 2, covers: { hardcover: 'https://example.test/hardcover.jpg' } }; } };
  const result = await enrichProviderMetadata(book, options);
  assert.equal(result.book.seriesPosition, 2);
  assert.equal(result.book.cover, 'https://example.test/hardcover.jpg');
  await enrichProviderMetadata(result.book, options);
  assert.equal(calls, 1);
  assert.equal(providerMetadataDue(result.book, 'hardcover@2'), true);
  assert.equal(providerMetadataDue({ ...result.book, coverPreference: 'local' }, options.providerLookupKey), true);
});

test('unavailable providers retain the choice and use available artwork', async () => {
  const result = await enrichProviderMetadata(book, { providerLookupKey: 'other@1', providerLookup: async () => ({ covers: {} }) });
  assert.equal(result.book.coverPreference, 'provider:hardcover');
  assert.equal(result.book.cover, book.cover);
});

test('partial provider failures preserve successful metadata and back off retries', async () => {
  const result = await enrichProviderMetadata(book, { providerLookupKey: 'providers', providerLookup: async () => ({ covers: {}, seriesPosition: 3, warning: 'One provider timed out' }) });
  assert.equal(result.book.seriesPosition, 3);
  assert.equal(result.warning, 'One provider timed out');
  assert.equal(providerMetadataDue(result.book, 'providers'), false);
  assert.equal(providerMetadataDue(result.book, 'providers', true), true);
});

test('explicit auto resets and newer provider choices win independently of old metadata', () => {
  assert.deepEqual(newerCoverPreference(book, { coverPreference: 'auto', coverPreferenceUpdatedAt: 3 }), { coverPreference: 'auto', coverPreferenceUpdatedAt: 3 });
  assert.deepEqual(newerCoverPreference({ coverPreference: 'local', coverPreferenceUpdatedAt: 1 }, book), { coverPreference: 'provider:hardcover', coverPreferenceUpdatedAt: 2 });
});

test('reads declared EPUB series positions, including zero, without guessing from unrelated groups', () => {
  assert.equal(epubSeriesPosition('<meta name="calibre:series" content="Series"/><meta name="calibre:series_index" content="0"/>'), 0);
  const series = '<meta property="belongs-to-collection" id="s">Series</meta><meta property="collection-type" refines="#s">series</meta>';
  assert.equal(epubSeriesPosition(series + '<meta property="group-position" refines="#s">2.5</meta>'), 2.5);
  assert.equal(epubSeriesPosition(series + '<meta property="group-position" refines="#other">2</meta>'), undefined);
  assert.equal(epubSeriesPosition(series + '<meta property="group-position" refines="#s">2.2.1</meta>'), undefined);
});

test('only queries an explicitly selected cover provider or a missing-series provider', () => {
  const local = { ...book, coverPreference: 'auto' as const };
  assert.equal(needsProviderMetadata(local, 'community.tomeio.zlibrary'), false);
  assert.equal(needsProviderMetadata(local, 'community.tomeio.hardcover'), true);
  assert.equal(needsProviderMetadata({ ...local, seriesPosition: 0 }, 'community.tomeio.hardcover'), false);
  assert.equal(needsProviderMetadata({ ...local, coverPreference: 'provider:community.tomeio.zlibrary' }, 'community.tomeio.zlibrary'), true);
});
