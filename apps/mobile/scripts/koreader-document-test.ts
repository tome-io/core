import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import {
  collectKoreaderPartialMd5Samples,
  koreaderPartialMd5Offsets,
} from '@tomeio/sync';

test('uses KOReader partial-MD5 sample offsets', () => {
  assert.deepEqual(koreaderPartialMd5Offsets(), [
    0,
    1_024,
    4_096,
    16_384,
    65_536,
    262_144,
    1_048_576,
    4_194_304,
    16_777_216,
    67_108_864,
    268_435_456,
    1_073_741_824,
  ]);
});

test('hashes the concatenated available samples', () => {
  const file = Uint8Array.from({ length: 2_000_000 }, (_, index) => index % 251);
  const sampled = collectKoreaderPartialMd5Samples((offset, length) =>
    offset >= file.byteLength
      ? new Uint8Array()
      : file.subarray(offset, Math.min(offset + length, file.byteLength))
  );
  assert.equal(sampled.byteLength, 7_168);
  assert.equal(createHash('md5').update(sampled).digest('hex'), 'da96d9df9e3ed2a4e922f3641ba40600');
});
