import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BookMetadata } from '@tomeio/domain';
import { enrichCatalogRatings } from '../src/lib/extension-book-metadata';

const book = (id: string, rating?: number): BookMetadata => ({
  id, title: id, authors: [], subjects: [], identifiers: {}, rating,
});

test('publishes each rating before later metadata resolves and skips existing ratings', async () => {
  const seen: string[] = [];
  const requested: string[] = [];
  let resolveSecond!: (value: BookMetadata) => void;
  const second = new Promise<BookMetadata>((resolve) => { resolveSecond = resolve; });
  let firstPublished!: () => void;
  const first = new Promise<void>((resolve) => { firstPublished = resolve; });
  const pending = enrichCatalogRatings([book('rated', 0), book('first'), book('second')], {
    hydrate: async (value) => {
      requested.push(value.id);
      return value.id === 'second' ? second : { ...value, rating: 4 };
    },
    onBook: (value) => { seen.push(value.id); firstPublished(); },
    onError: (error) => { throw error; },
    isCurrent: () => true,
  });
  await first;
  assert.deepEqual(seen, ['first']);
  resolveSecond(book('second', 3));
  await pending;
  assert.deepEqual(requested, ['first', 'second']);
  assert.deepEqual(seen, ['first', 'second']);
});

test('cancelled catalogs discard in-flight metadata and schedule no more requests', async () => {
  let active = true;
  let finish!: (value: BookMetadata) => void;
  let started!: () => void;
  const begun = new Promise<void>((resolve) => { started = resolve; });
  const requested: string[] = [];
  const published: BookMetadata[] = [];
  const pending = enrichCatalogRatings([book('first'), book('second')], {
    hydrate: (value) => {
      requested.push(value.id);
      started();
      return new Promise((resolve) => { finish = resolve; });
    },
    onBook: (value) => published.push(value),
    onError: (error) => { throw error; },
    isCurrent: () => active,
  });
  await begun;
  active = false;
  finish(book('first', 4));
  await pending;
  assert.deepEqual(requested, ['first']);
  assert.deepEqual(published, []);
});

test('reports metadata failures and keeps the shared queue available to other catalogs', async () => {
  const errors: unknown[] = [];
  const received: string[] = [];
  await Promise.all([
    enrichCatalogRatings([book('broken'), book('unrequested')], {
      hydrate: async () => { throw new Error('Provider unavailable'); },
      onBook: () => assert.fail('Failed metadata must not be published'),
      onError: (error) => errors.push(error),
      isCurrent: () => true,
    }),
    enrichCatalogRatings([book('working')], {
      hydrate: async (value) => ({ ...value, rating: 5 }),
      onBook: (value) => received.push(value.id),
      onError: (error) => { throw error; },
      isCurrent: () => true,
    }),
  ]);
  assert.equal(errors.length, 1);
  assert.deepEqual(received, ['working']);
});
