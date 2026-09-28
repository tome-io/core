import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BookExtension, ExtensionReviewsQuery } from '@tomeio/extension-protocol';
import { createExtensionReviewLoader, reviewQueryKey } from '../src/lib/extension-reviews';

const query: ExtensionReviewsQuery = {
  book: { title: 'Example', authors: ['Author'], identifiers: { source: '123', isbn: '456' } },
  page: 1, limit: 10,
};
const provider = (reviews: NonNullable<BookExtension['reviews']>): BookExtension => ({
  manifest: {
    manifestVersion: 1, id: 'community.example.reviews', version: '1.0.0',
    name: 'Example', description: 'Review provider', types: ['book'],
    resources: [{ name: 'reviews' }],
    transport: { kind: 'declarative', definitionUrl: 'https://example.com/workflow.json' },
  },
  reviews,
});

test('equivalent metadata replacements keep the same review request key', () => {
  const replacement = { ...query, book: { ...query.book, identifiers: { isbn: '456', source: '123' } } };
  assert.equal(reviewQueryKey(query), reviewQueryKey(replacement));
  assert.notEqual(reviewQueryKey(query), reviewQueryKey({ ...query, page: 2 }));
  assert.notEqual(reviewQueryKey(query), reviewQueryKey({ ...query, book: { ...query.book, title: 'Other' } }));
});

test('shares concurrent reads while keeping pages, providers, and configuration scopes separate', async () => {
  let calls = 0;
  const read = async () => { calls++; return { items: [] }; };
  // Real extension loads return a fresh wrapper, so coalesce before loading.
  const first = createExtensionReviewLoader(async () => provider(read));
  const second = createExtensionReviewLoader(async () => provider(read));
  await Promise.all([
    first('one', query),
    first('one', structuredClone(query)),
    first('one', { ...query, page: 2 }),
    first('two', query),
    second('one', query),
  ]);
  assert.equal(calls, 4);
  await first('one', query);
  assert.equal(calls, 5, 'completed account-specific results are not retained');
});

test('a failed read can be retried', async () => {
  let calls = 0;
  const source = provider(async () => {
    if (++calls === 1) throw new Error('Unavailable');
    return { items: [] };
  });
  const load = createExtensionReviewLoader(async () => source);
  await assert.rejects(load('one', query), /Unavailable/);
  assert.deepEqual(await load('one', query), { items: [] });
  assert.equal(calls, 2);
});
