import { expect, test } from 'bun:test';

import { createProjectGutenbergExtension } from '../src';

const extension = createProjectGutenbergExtension({ timeoutMs: 20_000 });

test('live OPDS search maps a known book and its downloadable EPUB', async () => {
  const page = await extension.search!({ query: 'Pride and Prejudice', limit: 25 });
  const book = page.items.find((candidate) => candidate.id === '1342');

  expect(book?.title).toBe('Pride and Prejudice');
  expect(book?.authors.join(' ')).toContain('Austen');
  expect(book?.coverUrl).toStartWith('https://www.gutenberg.org/');

  const acquisitions = await extension.acquisition!('1342');
  expect(acquisitions.some((candidate) => candidate.format === 'epub')).toBe(true);
});

test('live OPDS search does not expose loose matches for "One piece"', async () => {
  const page = await extension.search!({ query: 'One piece', limit: 25 });
  expect(page.items).toEqual([]);
});
