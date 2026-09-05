import { syncPayloadContent } from '../src/lib/hosted-sync-record';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  hostedAccountMetadata,
  matchingSyncRecord,
  progressRecordFromHosted,
  readerLocatorFromHosted,
  sameCollectionSyncContent,
  sameProgressSyncContent,
} from '../src/lib/hosted-sync-record';
import { shouldEnrichReaderMetadata } from '../src/lib/reader-metadata-policy';

test('creates a remote-only library record from shared document metadata', () => {
  assert.deepEqual(progressRecordFromHosted({
    document: '0415cf9c2d689bf88caea70729528842',
    documentMetadata: {
      title: 'Project Hail Mary',
      authors: ['Andy Weir'],
      format: 'epub',
    },
    percentage: 0.64,
    metadata: null,
    source: 'koreader',
    updatedAt: 1_780_000_000_000,
    serverUpdatedAt: 1_780_000_000_100,
    removedAt: null,
  }), {
    identity: 'fingerprint:koreader-partial-md5-v1:0415cf9c2d689bf88caea70729528842',
    aliases: ['publication:["project hail mary",["andy weir"]]', 'hosted-document:koreader-partial-md5-v1:0415cf9c2d689bf88caea70729528842', 'fingerprint:koreader-partial-md5-v1:0415cf9c2d689bf88caea70729528842'],
    title: 'Project Hail Mary',
    author: 'Andy Weir',
    format: 'epub',
    progress: 64,
    isRead: false,
    readingTimeMs: undefined,
    wordsRead: undefined,
    lastReadAt: undefined,
    updatedAt: 1_780_000_000_000,
  });
});

test('converts hosted progress into a Readium locator for the same file', () => {
  assert.deepEqual(readerLocatorFromHosted({
    locatorDocument: 'document',
    document: '0415cf9c2d689bf88caea70729528842',
    documentMetadata: null,
    percentage: 0.0661,
    locator: {
      href: 'OEBPS/Text/Section0002.xhtml',
      progression: 0.42857142857142855,
    },
    metadata: null,
    source: 'tomeio',
    updatedAt: 1_780_000_000_000,
    serverUpdatedAt: 1_780_000_000_100,
    removedAt: null,
  }, 'epub', 'document'), {
    href: 'OEBPS/Text/Section0002.xhtml',
    type: 'application/xhtml+xml',
    locations: {
      progression: 0.42857142857142855,
      totalProgression: 0.0661,
    },
  });
});

test('does not repeat bibliographic metadata in the private progress payload', () => {
  const metadata = hostedAccountMetadata({
    identity: 'book:project-hail-mary',
    aliases: [],
    title: 'Project Hail Mary',
    author: 'Andy Weir',
    format: 'epub',
    progress: 64,
    isRead: false,
    readingTimeMs: 12_000,
    updatedAt: 1_780_000_000_000,
  });
  assert.deepEqual(metadata, {
    syncRecord: {
      identity: 'book:project-hail-mary',
      aliases: [],
      readingTimeMs: 12_000,
    },
  });
  assert.equal('title' in (metadata.syncRecord as Record<string, unknown>), false);
});

test('forces metadata enrichment after hosted sync even during the failure retry window', () => {
  const now = 1_780_000_000_000;
  const book = {
    key: 'progress:fingerprint',
    id: 'progress:fingerprint',
    title: 'Project Hail Mary',
    author: 'Andy Weir',
    cover: '',
    description: '',
    year: '',
    genre: 'Other',
    addedAt: now,
    metadataPending: true,
    metadataUpdatedAt: now - 1_000,
    metadataVersion: 7,
  };
  assert.equal(shouldEnrichReaderMetadata(book, now), false);
  assert.equal(shouldEnrichReaderMetadata(book, now, true), true);
});

test('matches sync records through aliases', () => {
  const candidate = {
    identity: 'book:project-hail-mary',
    aliases: ['fingerprint:project-hail-mary'],
  };
  assert.equal(
    matchingSyncRecord(
      {
        identity: 'fingerprint:project-hail-mary',
        aliases: [],
      },
      [candidate]
    ),
    candidate
  );
});

test('ignores sync timestamps when progress content is unchanged', () => {
  const base = {
    identity: 'book:project-hail-mary',
    aliases: [],
    title: 'Project Hail Mary',
    author: 'Andy Weir',
    format: 'epub',
    progress: 64,
    isRead: false,
    updatedAt: 100,
  };
  assert.equal(sameProgressSyncContent(base, { ...base, updatedAt: 200 }), true);
  assert.equal(sameProgressSyncContent(base, { ...base, progress: 65 }), false);
});

test('detects meaningful collection changes without repeating timestamp-only writes', () => {
  const base = {
    identity: 'book:project-hail-mary',
    aliases: [],
    title: 'Project Hail Mary',
    author: 'Andy Weir',
    format: 'epub',
    addedAt: 10,
    sortAt: 20,
    updatedAt: 30,
  };
  assert.equal(sameCollectionSyncContent(base, { ...base, updatedAt: 40 }), true);
  assert.equal(sameCollectionSyncContent(base, { ...base, sortAt: 21 }), false);
});


test('never imports exact locators from another EPUB or legacy untagged data', () => {
  const remote = { document: 'canonical', locatorDocument: 'file-a', documentMetadata: null,
    percentage: 0.5, locator: { href: 'chapter.xhtml', progression: 0.3 }, metadata: null,
    source: 'tomeio' as const, updatedAt: 1, serverUpdatedAt: 1, removedAt: null };
  assert.equal(readerLocatorFromHosted(remote, 'epub', 'file-b'), undefined);
  assert.equal(readerLocatorFromHosted({ ...remote, locatorDocument: undefined }, 'epub', 'file-a'), undefined);
});

test('upload content ignores bookkeeping timestamps, key order and alias ordering', () => {
  const a = { updatedAt: 10, percentage: 0.4, aliases: ['b', 'a'], documentMetadata: { title: 'Book', format: 'epub' } };
  const b = { documentMetadata: { format: 'epub', title: 'Book' }, aliases: ['a', 'b', 'a'], percentage: 0.4, updatedAt: 20, coverPreference: 'auto', coverPreferenceUpdatedAt: 0 };
  assert.equal(syncPayloadContent(a), syncPayloadContent(b));
  assert.notEqual(syncPayloadContent(a), syncPayloadContent({ ...a, percentage: 0.5 }));
  assert.notEqual(syncPayloadContent(a), syncPayloadContent({ ...a, removedAt: 30 }));
  assert.notEqual(syncPayloadContent(a), syncPayloadContent({ ...a, coverPreference: 'auto', coverPreferenceUpdatedAt: 30 }));
});

test('learning local sync aliases does not dirty unchanged reading content', () => {
  const payload = { percentage: 0.4, metadata: { syncRecord: { identity: 'old', aliases: ['old'], readingTimeMs: 100 } } };
  assert.equal(syncPayloadContent(payload), syncPayloadContent({ ...payload,
    metadata: { syncRecord: { identity: 'new', aliases: ['new', 'old'], readingTimeMs: 100 } } }));
});

test('absent and zero reading counters are the same upload content', () => {
  assert.equal(syncPayloadContent({ metadata: { syncRecord: {} } }),
    syncPayloadContent({ metadata: { syncRecord: { readingTimeMs: 0, wordsRead: 0, lastReadAt: 0 } } }));
});
