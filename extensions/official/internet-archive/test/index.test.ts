import { describe, expect, test } from 'bun:test';

import { createInternetArchiveExtension } from '../src';

function jsonResponse(value: unknown): Response {
  return Response.json(value);
}

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    metadata: {
      identifier: 'example-book',
      title: 'Example Book',
      collection: ['biodiversity'],
      licenseurl: 'https://creativecommons.org/licenses/by/4.0/',
      ...overrides,
    },
    files: [
      { name: 'example.epub', format: 'EPUB', size: '2048' },
      { name: 'private.pdf', format: 'PDF', private: 'true' },
      { name: 'metadata.xml', format: 'Metadata' },
    ],
  };
}

describe('bundled Internet Archive policy', () => {
  test('downloads an unrestricted, permissively licensed item from a trusted collection', async () => {
    const extension = createInternetArchiveExtension({
      fetchFn: async () => jsonResponse(metadata()),
    });

    const acquisitions = await extension.acquisition!('example-book');
    expect(acquisitions).toEqual([
      expect.objectContaining({
        format: 'epub',
        downloadUrl: 'https://archive.org/download/example-book/example.epub',
        sizeBytes: 2048,
      }),
    ]);
  });

  test('does not download an item whose uploader supplied no explicit license', async () => {
    const extension = createInternetArchiveExtension({
      fetchFn: async () => jsonResponse(metadata({ licenseurl: undefined })),
    });

    const acquisitions = await extension.acquisition!('example-book');
    expect(acquisitions).toEqual([
      expect.objectContaining({
        label: 'View on Internet Archive',
        openUrl: 'https://archive.org/details/example-book',
      }),
    ]);
    expect(acquisitions[0]?.downloadUrl).toBeUndefined();
  });

  test('does not download lending or access-restricted material', async () => {
    const extension = createInternetArchiveExtension({
      fetchFn: async () =>
        jsonResponse(
          metadata({
            collection: ['biodiversity', 'inlibrary'],
            'access-restricted-item': true,
          })
        ),
    });

    const acquisitions = await extension.acquisition!('example-book');
    expect(acquisitions).toHaveLength(1);
    expect(acquisitions[0]?.openUrl).toBe('https://archive.org/details/example-book');
    expect(acquisitions[0]?.downloadUrl).toBeUndefined();
  });

  test('requires trusted provenance in addition to a permissive license', async () => {
    const extension = createInternetArchiveExtension({
      fetchFn: async () => jsonResponse(metadata({ collection: ['opensource'] })),
    });

    const acquisitions = await extension.acquisition!('example-book');
    expect(acquisitions[0]?.openUrl).toBe('https://archive.org/details/example-book');
    expect(acquisitions[0]?.downloadUrl).toBeUndefined();
  });

  test('joins search tokens with AND and excludes lending collections', async () => {
    let requestedUrl = '';
    const extension = createInternetArchiveExtension({
      fetchFn: async (url) => {
        requestedUrl = String(url);
        return jsonResponse({ response: { docs: [], numFound: 0 } });
      },
    });

    await extension.search!({ query: 'One piece' });
    const query = new URL(requestedUrl).searchParams.get('q') ?? '';
    expect(query).toContain('(title:"One" OR creator:"One" OR subject:"One") AND');
    expect(query).toContain('(title:"piece" OR creator:"piece" OR subject:"piece")');
    expect(query).toContain('NOT collection:inlibrary');
    expect(query).toContain('NOT access-restricted-item:true');
  });
});
