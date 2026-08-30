import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { BookAcquisition, BookMetadata } from '@tomeio/domain';

import {
  ACQUISITION_CANDIDATE_PAGE_SIZE,
  acquisitionActionKind,
  primaryAcquisition,
  searchAcquisitionCandidatePage,
  type AcquisitionSearchProvider,
} from '../src/lib/acquisition-options';

describe('acquisition action', () => {
  test('treats a URL-less inline file as a download that still needs resolving', () => {
    assert.equal(acquisitionActionKind({}), 'download');
  });

  test('only opens acquisitions that explicitly provide an external page', () => {
    assert.equal(acquisitionActionKind({ openUrl: 'https://example.com/book' }), 'open');
    assert.equal(
      acquisitionActionKind({
        openUrl: 'https://example.com/book',
        downloadUrl: 'https://example.com/book.epub',
      }),
      'download'
    );
  });

  test('prefers a downloadable EPUB without presenting an intermediate file list', () => {
    const acquisitions: BookAcquisition[] = [
      {
        id: 'page',
        bookId: 'book',
        format: 'web',
        label: 'Read online',
        openUrl: 'https://example.com/book',
      },
      {
        id: 'pdf',
        bookId: 'book',
        format: 'pdf',
        label: 'PDF',
        downloadUrl: 'https://example.com/book.pdf',
      },
      {
        id: 'epub',
        bookId: 'book',
        format: 'epub',
        label: 'EPUB',
        downloadUrl: 'https://example.com/book.epub',
      },
    ];

    assert.equal(primaryAcquisition(acquisitions)?.id, 'epub');
  });

  test('falls back to an open link and ignores unusable acquisition records', () => {
    const acquisitions: BookAcquisition[] = [
      { id: 'missing', bookId: 'book', format: 'epub', label: 'Missing URL' },
      {
        id: 'page',
        bookId: 'book',
        format: 'web',
        label: 'Read online',
        openUrl: 'https://example.com/book',
      },
    ];

    assert.equal(primaryAcquisition(acquisitions)?.id, 'page');
    assert.equal(primaryAcquisition([acquisitions[0]!]), null);
  });
});

function book(id: string): BookMetadata {
  return {
    id,
    title: `Book ${id}`,
    authors: ['Author'],
    subjects: [],
    identifiers: {},
  };
}

describe('cross-provider acquisition lookup', () => {
  test('searches for no more than three candidates without resolving their files', async () => {
    const searchQueries: unknown[] = [];
    let acquisitionCalls = 0;
    const provider: AcquisitionSearchProvider & { acquisition(id: string): Promise<never[]> } = {
      search: async (query) => {
        searchQueries.push(query);
        const items = ['1', '2', '3', '4', '5'].map(book);
        items[0]!.acquisitions = [
          {
            id: 'file-1',
            bookId: '1',
            format: 'epub',
            label: 'EPUB',
            downloadUrl: 'https://download.example/book.epub',
          },
        ];
        return { items, nextPage: 2 };
      },
      acquisition: async () => {
        acquisitionCalls += 1;
        return [];
      },
    };

    const result = await searchAcquisitionCandidatePage(provider, 'Example Author', 1);

    assert.deepEqual(searchQueries, [
      { query: 'Example Author', page: 1, limit: ACQUISITION_CANDIDATE_PAGE_SIZE },
    ]);
    assert.deepEqual(result.items.map(({ id }) => id), ['1', '2', '3']);
    assert.equal(result.items[0]?.acquisitions?.[0]?.format, 'epub');
    assert.equal(acquisitionCalls, 0);
    assert.equal(result.nextPage, 2);
  });

  test('uses the provider next page and stops after a short page', async () => {
    let searchPage = 1;
    const provider: AcquisitionSearchProvider = {
      search: async ({ page }) => {
        searchPage = page ?? 1;
        return searchPage === 4
          ? { items: [book('10'), book('11'), book('12')], nextPage: 7 }
          : { items: [book('20')] };
      },
    };

    const fourthPage = await searchAcquisitionCandidatePage(provider, 'Example', 4);
    assert.equal(fourthPage.nextPage, 7);
    const seventhPage = await searchAcquisitionCandidatePage(provider, 'Example', 7);
    assert.equal(seventhPage.nextPage, null);
  });

  test('surfaces search failures', async () => {
    const provider: AcquisitionSearchProvider = {
      search: async () => {
        throw new Error('provider failed');
      },
    };

    await assert.rejects(
      searchAcquisitionCandidatePage(provider, 'Example', 1),
      /provider failed/
    );
  });
});
