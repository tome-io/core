import { describe, expect, test } from 'bun:test';

import { createOpenLibraryExtension } from '../src';
import { createAddonHandler, parseExtensionManifest } from '@tomeio/addon-sdk';

function jsonResponse(value: unknown): Response {
  return Response.json(value);
}

describe('Open Library genre search', () => {
  test('filters at the source and retains the genre on later pages', async () => {
    const requested: URL[] = [];
    const extension = createOpenLibraryExtension({ fetchFn: async (input) => {
      requested.push(new URL(String(input)));
      return jsonResponse({ docs: [], numFound: 0 });
    } });
    await extension.search!({ subject: 'horror', page: 1 });
    await extension.search!({ query: 'ghost', subject: 'horror', page: 2 });
    expect(requested[0].searchParams.get('q')).toBe('subject_key:(horror OR horror_fiction OR ghost_stories)');
    expect(requested[1].searchParams.get('q')).toContain('ghost_stories');
    expect(requested[1].searchParams.get('page')).toBe('2');
    expect(parseExtensionManifest(extension.manifest).resources.find((resource) => resource.name === 'search')?.subjectFilters)
      .toContainEqual({ id: 'horror', name: 'Horror & ghosts' });
  });
  test('rejects unsupported genre IDs', async () => {
    const extension = createOpenLibraryExtension();
    await expect(extension.search!({ subject: 'not-a-genre' })).rejects.toThrow('Unsupported Open Library genre');
  });
  test('preserves genre through the HTTP add-on transport', async () => {
    let requested: URL | undefined;
    const extension = createOpenLibraryExtension({ fetchFn: async (input) => {
      requested = new URL(String(input));
      return jsonResponse({ docs: [], numFound: 0 });
    } });
    const response = await createAddonHandler(extension)(new Request('https://addon.example/search/book.json?subject=horror&page=2'));
    expect(response.status).toBe(200);
    expect(requested?.searchParams.get('q')).toContain('horror_fiction');
    expect(requested?.searchParams.get('page')).toBe('2');
  });
});

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
