import assert from "node:assert/strict";
import test from "node:test";

import {
  isCollectionRecordRemoved,
  mergeCollectionSyncRecords,
  mergeCollectionSnapshots,
  type CollectionSyncRecord,
} from "../src/lib/library-sync-model";
import {
  isProgressRecordRemoved,
  mergeProgressRecords,
  type ProgressSyncRecord,
} from "../src/lib/progress-sync-model";

function record(overrides: Partial<CollectionSyncRecord> = {}): CollectionSyncRecord {
  return {
    identity: "book:project-hail-mary:andy-weir",
    aliases: [],
    title: "Project Hail Mary",
    author: "Andy Weir",
    format: "EPUB",
    addedAt: 10,
    sortAt: 10,
    updatedAt: 10,
    ...overrides,
  };
}

test("collection sync uses the newest membership event", () => {
  const merged = mergeCollectionSyncRecords(
    [record()],
    [record({ updatedAt: 20, removedAt: 20 })],
  );
  assert.equal(merged.length, 1);
  assert.equal(isCollectionRecordRemoved(merged[0]!), true);
});

test("collection aliases merge renditions without duplicating the logical book", () => {
  const merged = mergeCollectionSyncRecords(
    [record({ aliases: ["logical"] })],
    [record({ identity: "fingerprint:abc", aliases: ["logical"], updatedAt: 20 })],
  );
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0]?.aliases, ["book:project-hail-mary:andy-weir", "fingerprint:abc", "logical"]);
  assert.equal(merged[0]?.identity, "fingerprint:abc");
  assert.equal(mergeCollectionSyncRecords(merged, [record({ updatedAt: 30 })]).length, 1,
    "the old identity must still match after the winning rendition changes");
});

function progressRecord(
  overrides: Partial<ProgressSyncRecord> = {},
): ProgressSyncRecord {
  return {
    identity: "book:project-hail-mary:andy-weir",
    aliases: [],
    title: "Project Hail Mary",
    author: "Andy Weir",
    format: "EPUB",
    progress: 20,
    isRead: false,
    updatedAt: 10,
    ...overrides,
  };
}

test("progress aliases match an existing record identity in either direction", () => {
  const merged = mergeProgressRecords(
    [progressRecord({ identity: "logical", aliases: [] })],
    [progressRecord({ identity: "fingerprint", aliases: ["logical"] })],
  );
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0]?.aliases, ["fingerprint", "logical"]);
  assert.equal(mergeProgressRecords(merged, [progressRecord({ identity: "fingerprint", updatedAt: 30 })]).length, 1);
});

test("a newer progress removal wins over stale active progress", () => {
  const merged = mergeProgressRecords(
    [progressRecord({ progress: 80, updatedAt: 20 })],
    [progressRecord({ updatedAt: 10, removedAt: 30 })],
  );
  assert.equal(merged.length, 1);
  assert.equal(isProgressRecordRemoved(merged[0]!), true);
});

test("a strictly newer progress event can re-add a removed book", () => {
  const merged = mergeProgressRecords(
    [progressRecord({ updatedAt: 10, removedAt: 30 })],
    [progressRecord({ progress: 40, updatedAt: 31 })],
  );
  assert.equal(merged.length, 1);
  assert.equal(isProgressRecordRemoved(merged[0]!), false);
  assert.equal(merged[0]?.progress, 40);
});

test('cover preference merges independently from library membership, including an explicit reset', () => {
  const current = record({ updatedAt: 100, coverPreference: 'provider:hardcover', coverPreferenceUpdatedAt: 20 });
  const remote = record({ updatedAt: 50, removedAt: 50, coverPreference: 'auto', coverPreferenceUpdatedAt: 30 });
  for (const groups of [[[current], [remote]], [[remote], [current]]]) {
    const [merged] = mergeCollectionSyncRecords(...groups);
    assert.equal(merged?.updatedAt, 100);
    assert.equal(merged?.removedAt, undefined);
    assert.equal(merged?.coverPreference, 'auto');
    assert.equal(merged?.coverPreferenceUpdatedAt, 30);
  }
});

test("file rediscovery preserves logical membership and removals", () => {
  const stored = record({ aliases: ["isbn:123"], sortAt: 12, updatedAt: 20 });
  const rendition = record({ identity: "file:other", aliases: ["isbn:123"], sortAt: 999, updatedAt: 999 });
  const [merged] = mergeCollectionSnapshots([stored], [rendition]);
  assert.equal(merged?.sortAt, 12);
  assert.equal(merged?.updatedAt, 20);
  assert.equal(merged?.identity, stored.identity);
  const [removed] = mergeCollectionSnapshots([{ ...stored, removedAt: 30, updatedAt: 30 }], [rendition]);
  assert.equal(isCollectionRecordRemoved(removed!), true);
  const [readded] = mergeCollectionSyncRecords([removed!], [record({ updatedAt: 40, sortAt: 40 })]);
  assert.equal(isCollectionRecordRemoved(readded!), false);
  assert.equal(readded?.sortAt, 40);
});

test("rediscovered renditions can carry a newer explicit cover preference", () => {
  const [merged] = mergeCollectionSnapshots([record()], [record({
    coverPreference: "provider:hardcover", coverPreferenceUpdatedAt: 50, updatedAt: 99,
  })]);
  assert.equal(merged?.coverPreference, "provider:hardcover");
  assert.equal(merged?.updatedAt, 10);
});
