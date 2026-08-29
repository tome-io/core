import assert from "node:assert/strict";
import test from "node:test";

import {
  isCollectionRecordRemoved,
  mergeCollectionSyncRecords,
  type CollectionSyncRecord,
} from "../src/lib/library-sync-model";

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

