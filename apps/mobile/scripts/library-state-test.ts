import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type LibraryBook,
  type LibraryState,
} from '../src/lib/library';
import { reconcileLibraryStateWithLocalCatalog } from '../src/lib/library-state';

function book(key: string, uri?: string): LibraryBook {
  return {
    key,
    id: key,
    title: key,
    author: 'Author',
    cover: '',
    description: '',
    year: '',
    genre: 'Local',
    addedAt: 1,
    ...(uri
      ? {
          fileUri: uri,
          local: {
            uri,
            filename: `${key}.epub`,
            format: 'epub',
            size: 1,
            modificationTime: 1,
          },
        }
      : {}),
  };
}

describe('library file reconciliation', () => {
  it('keeps missing books in the library and marks their copies unavailable', () => {
    const availableUri = 'content://provider/document/primary%3ABooks%2Favailable.epub';
    const missingUri = 'content://provider/document/primary%3ABooks%2Fmissing.epub';
    const available = book('available', availableUri);
    const missing = book('missing', missingUri);
    const remote = book('remote');
    const state: LibraryState = {
      downloaded: [available, missing, remote],
      readingList: [missing, { ...available, availableLocally: false }, remote],
    };

    const reconciled = reconcileLibraryStateWithLocalCatalog(state, [
      book('scanned', decodeURIComponent(availableUri)),
    ]);

    assert.deepEqual(reconciled.downloaded.map((item) => item.key), [
      'available',
      'missing',
      'remote',
    ]);
    assert.equal(reconciled.downloaded[1]?.availableLocally, false);
    assert.equal(reconciled.readingList[0]?.availableLocally, false);
    assert.equal(reconciled.readingList[1]?.availableLocally, true);
    assert.equal(reconciled.downloaded[2]?.availableLocally, false);
    assert.equal(reconciled.readingList[2]?.availableLocally, false);
  });

  it('removes persisted library copies represented by the scanned catalog', () => {
    const local = book('local', 'file:///books/local.epub');
    const state: LibraryState = { downloaded: [local], readingList: [local] };
    const reconciled = reconcileLibraryStateWithLocalCatalog(state, [local]);

    assert.deepEqual(reconciled.downloaded, []);
    assert.equal(reconciled.readingList[0]?.availableLocally, true);
    assert.equal(reconciled.readingList[0]?.fileUri, local.fileUri);
  });
});
