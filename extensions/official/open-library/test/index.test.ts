import { describe, expect, test } from 'bun:test';

import { createOpenLibraryExtension } from '../src';

function jsonResponse(value: unknown): Response {
  return Response.json(value);
}

describe('Open Library acquisitions', () => {
  test('returns rights-verified files from an Open Library work scan', async () => {
    const extension = createOpenLibraryExtension({
      fetchFn: async (url) => {
        if (String(url).includes('openlibrary.org/query.json')) {
          return jsonResponse([{ key: '/books/OL1M', ocaid: 'example-book' }]);
        }
        return jsonResponse({
          metadata: {
            collection: ['biodiversity'],
            licenseurl: 'https://creativecommons.org/licenses/by/4.0/',
          },
          files: [
            { name: 'example.epub', format: 'EPUB', size: '2048' },
            { name: 'private.pdf', format: 'PDF', private: 'true' },
          ],
        });
      },
    });

    const acquisitions = await extension.acquisition!('OL1W');
    expect(acquisitions).toEqual([
      expect.objectContaining({
        format: 'epub',
        downloadUrl: 'https://archive.org/download/example-book/example.epub',
        sizeBytes: 2048,
      }),
    ]);
  });

  test('opens Open Library when no rights-verified download is available', async () => {
    const extension = createOpenLibraryExtension({
      fetchFn: async (url) =>
        String(url).includes('openlibrary.org/query.json')
          ? jsonResponse([{ key: '/books/OL1M', ocaid: 'restricted-book' }])
          : jsonResponse({
              metadata: {
                collection: ['inlibrary'],
                'access-restricted-item': true,
              },
            }),
    });

    const acquisitions = await extension.acquisition!('OL1W');
    expect(acquisitions).toEqual([
      expect.objectContaining({
        label: 'View on Open Library',
        openUrl: 'https://openlibrary.org/works/OL1W',
      }),
    ]);
    expect(acquisitions[0]?.downloadUrl).toBeUndefined();
  });
});
