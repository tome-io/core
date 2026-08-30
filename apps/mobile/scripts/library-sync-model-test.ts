import assert from "node:assert/strict";
import test from "node:test";

import {
  isCollectionRecordRemoved,
  mergeCollectionSyncRecords,
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
  assert.deepEqual(merged[0]?.aliases, ["logical"]);
  assert.equal(merged[0]?.identity, "fingerprint:abc");
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
  assert.deepEqual(merged[0]?.aliases, ["logical"]);
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
