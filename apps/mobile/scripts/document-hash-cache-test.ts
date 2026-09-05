import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDocumentHashCache } from '../src/lib/document-hash-cache';

test('unchanged files reuse in-flight and completed hashes; changed files are rehashed', async () => {
  const hash = createDocumentHashCache();
  const file = { uri: 'file:test', size: 100, modifiedAt: 1 };
  let calls = 0;
  const compute = async () => String(++calls);
  assert.deepEqual(await Promise.all([hash(file, compute), hash(file, compute)]), ['1', '1']);
  assert.equal(await hash(file, compute), '1');
  assert.equal(await hash({ ...file, modifiedAt: 2 }, compute), '2');
  assert.equal(await hash({ ...file, size: 200 }, compute), '3');
});

test('unknown timestamps and failures cannot poison the hash cache', async () => {
  const hash = createDocumentHashCache();
  const file = { uri: 'file:test', size: 100, modifiedAt: 0 };
  let calls = 0;
  const compute = async () => String(++calls);
  await hash(file, compute);
  await hash(file, compute);
  assert.equal(calls, 2);
  const versioned = { ...file, modifiedAt: 1 };
  await assert.rejects(hash(versioned, async () => { throw new Error('offline'); }));
  assert.equal(await hash(versioned, compute), '3');
});
