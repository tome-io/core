import { expect, test } from 'bun:test';
import { createSourceHttpClient } from '../src';

test('retries a temporary failure and coalesces simultaneous requests', async () => {
  let calls = 0;
  const client = createSourceHttpClient({ fetchFn: async () => ++calls === 1 ? new Response('', { status: 503 }) : Response.json({ ok: true }) });
  const results = await Promise.all([client.json('https://source.test/book'), client.json('https://source.test/book')]);
  expect(results).toEqual([{ ok: true }, { ok: true }]);
  expect(calls).toBe(2);
});

test('does not retry permanent errors or expose request URLs in the user message', async () => {
  let calls = 0;
  const client = createSourceHttpClient({ fetchFn: async () => { calls++; return new Response('', { status: 404 }); } });
  await expect(client.json('https://source.test/book?private=query')).rejects.toThrow('Source returned HTTP 404. Please retry.');
  expect(calls).toBe(1);
});

test('respects a long Retry-After instead of retrying early', async () => {
  let calls = 0;
  const client = createSourceHttpClient({ fetchFn: async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '60' } }); } });
  await expect(client.json('https://source.test/book')).rejects.toThrow('HTTP 429');
  expect(calls).toBe(1);
});

test('bounds repeated network failures', async () => {
  let calls = 0;
  const client = createSourceHttpClient({ fetchFn: async () => { calls++; throw new Error('offline'); } });
  await expect(client.json('https://source.test/book')).rejects.toThrow('Could not reach source.test');
  expect(calls).toBe(2);
});
