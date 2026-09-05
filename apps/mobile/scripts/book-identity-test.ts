import assert from 'node:assert/strict';
import { test } from 'node:test';
import { identityGroups, normalizeIsbn, publicationAliases } from '@tomeio/domain';
import { mergeCollectionSyncRecords } from '../src/lib/library-sync-model';
import { mergeProgressRecords } from '../src/lib/progress-sync-model';

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
