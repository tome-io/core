import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  hostedAccountMetadata,
  progressRecordFromHosted,
} from '../src/lib/hosted-sync-record';

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
    aliases: [],
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
