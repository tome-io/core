import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readingIntervals } from '../src/lib/reading-session-model';
const session = { sessionId: 'session', accountId: null, bookKey: 'book', document: 'digest' };
test('splits reading at local midnight without losing or duplicating milliseconds', () => {
  const start = Date.parse('2026-09-01T21:59:50Z');
  const result = readingIntervals(session, start, start + 30_000, -120);
  assert.equal(result.length, 2);
  assert.equal(result[0].endedAt, result[1].startedAt);
  assert.equal(result.reduce((total, value) => total + value.endedAt - value.startedAt, 0), 30_000);
  assert.notEqual(result[0].id, result[1].id);
});
test('does not count suspended or invalid heartbeat gaps', () => {
  assert.deepEqual(readingIntervals(session, 0, 300_000, 0), []);
  assert.deepEqual(readingIntervals(session, 100, 0, 0), []);
});
