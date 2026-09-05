import assert from 'node:assert/strict';
import { test } from 'node:test';
import { identityGroups, normalizeIsbn, publicationAliases } from '@tomeio/domain';
import { mergeCollectionSyncRecords } from '../src/lib/library-sync-model';
import { mergeProgressRecords } from '../src/lib/progress-sync-model';
import { groupLibraryBooks, sameLibraryBook } from '../src/lib/library-book-groups';
import type { LibraryBook } from '../src/lib/library';

test('normalizes equivalent ISBNs and rejects invalid checksums', () => {
  assert.equal(normalizeIsbn('0-306-40615-2'), '9780306406157');
  assert.equal(normalizeIsbn('urn:isbn:9780306406157'), '9780306406157');
  assert.equal(normalizeIsbn('9780306406158'), null);
});

test('retains volume numbers and requires authors for title matching', () => {
  assert.deepEqual(publicationAliases('Harry Potter 2', ['Unknown']), []);
  assert.notDeepEqual(publicationAliases('Harry Potter 2', ['Rowling']), publicationAliases('Harry Potter 3', ['Rowling']));
});

test('a shared identity bridges all previously separate file groups', () => {
  const rows = [{ identity: 'a', aliases: ['isbn'] }, { identity: 'b', aliases: ['title'] },
    { identity: 'c', aliases: ['isbn', 'title'] }];
  assert.equal(identityGroups(rows).length, 1);
  const collections = rows.map((row) => ({ ...row, title: 'Book', author: 'Author', format: 'epub',
    addedAt: 1, sortAt: 1, updatedAt: 1 }));
  assert.equal(mergeCollectionSyncRecords(collections).length, 1);
  const progress = collections.map((row, index) => ({ ...row, isRead: false, progress: index * 25 }));
  assert.equal(mergeProgressRecords(progress).length, 1);
  assert.equal(mergeProgressRecords(progress)[0].progress, 50);
});

test('one library reference retains both local EPUB variants and shared progress', () => {
  const book = (key: string, title: string, isbn: string, progress: number): LibraryBook => ({
    key, id: key, title, author: 'Author', identifiers: { isbn }, progress,
    genre: 'Fiction', cover: '', description: '', year: '', addedAt: 1, format: 'epub',
    local: { uri: `file:///${key}.epub`, filename: `${key}.epub`, format: 'epub', size: 100, modificationTime: 1 },
  });
  const first = book('a', 'Book', '0306406152', 25);
  const second = book('b', 'Book: an alternate title', '9780306406157', 50);
  const grouped = groupLibraryBooks([first, second]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].localFiles?.length, 2);
  assert.equal(grouped[0].progress, 50);
  assert.equal(sameLibraryBook(grouped[0], second), true);
});
