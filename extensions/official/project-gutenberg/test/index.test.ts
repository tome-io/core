import { describe, expect, test } from 'bun:test';

import { createProjectGutenbergExtension } from '../src';

const searchFeed = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <link rel="next" href="/ebooks/search.opds/?query=pride&amp;start_index=26" />
  <entry>
    <id>https://www.gutenberg.org/ebooks/1342.opds</id>
    <title>Pride and Prejudice</title>
    <content type="text">Jane Austen</content>
    <link type="image/png" rel="http://opds-spec.org/image/thumbnail" href="data:image/png;base64,placeholder" />
  </entry>
  <entry>
    <id>https://www.gutenberg.org/ebooks/123.opds</id>
    <title>Pieces of History</title>
    <content type="text">Example Author</content>
  </entry>
</feed>`;

const detailFeed = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>urn:gutenberg:1342:2</id>
    <title>Pride and Prejudice</title>
    <author><name>Austen, Jane</name></author>
    <link type="application/epub+zip" rel="http://opds-spec.org/acquisition" title="EPUB" length="1234" href="https://www.gutenberg.org/ebooks/1342.epub.images" />
  </entry>
  <entry>
    <id>urn:gutenberg:1342:3</id>
    <title>Pride and Prejudice</title>
    <author><name>Austen, Jane</name></author>
    <link type="application/epub+zip" rel="http://opds-spec.org/acquisition" title="EPUB" length="1234" href="https://www.gutenberg.org/ebooks/1342.epub.images" />
  </entry>
</feed>`;

function response(body: string): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/atom+xml' } });
}

describe('Project Gutenberg extension', () => {
  test('maps search authors, rejects loose multi-token matches, and avoids inline placeholders', async () => {
    const requests: RequestInit[] = [];
    const extension = createProjectGutenbergExtension({
      fetchFn: async (_url, init) => {
        requests.push(init ?? {});
        return response(searchFeed);
      },
    });

    const page = await extension.search!({ query: 'Pride Prejudice', limit: 25 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: '1342',
      title: 'Pride and Prejudice',
      authors: ['Jane Austen'],
      coverUrl: 'https://www.gutenberg.org/cache/epub/1342/pg1342.cover.medium.jpg',
    });
    expect(page.nextPage).toBe(2);
    expect(new Headers(requests[0]?.headers).get('user-agent')).toContain('Tomeio/');
  });

  test('returns no unrelated results for the multi-token query from the reported UI', async () => {
    const extension = createProjectGutenbergExtension({
      fetchFn: async () => response(searchFeed),
    });

    const page = await extension.search!({ query: 'One piece' });
    expect(page.items).toEqual([]);
  });

  test('loads and deduplicates acquisitions from the per-book OPDS feed', async () => {
    const extension = createProjectGutenbergExtension({
      fetchFn: async (url) =>
        response(String(url).includes('/ebooks/1342.opds') ? detailFeed : searchFeed),
    });

    const acquisitions = await extension.acquisition!('1342');
    expect(acquisitions).toEqual([
      expect.objectContaining({
        bookId: '1342',
        format: 'epub',
        label: 'EPUB',
        downloadUrl: 'https://www.gutenberg.org/ebooks/1342.epub.images',
        sizeBytes: 1234,
      }),
    ]);
  });
});
