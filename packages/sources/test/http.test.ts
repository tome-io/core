import { expect, test } from 'bun:test';
import { createSourceHttpClient, fetchSource } from '../src';

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

test('paces Open Library starts without waiting for earlier responses', async () => {
  let releaseFirst!: () => void;
  let firstStarted!: () => void;
  let secondStarted!: () => void;
  const held = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const firstReady = new Promise<void>((resolve) => { firstStarted = resolve; });
  const secondReady = new Promise<void>((resolve) => { secondStarted = resolve; });
  const starts: number[] = [];
  const fetchFn: typeof fetch = async () => {
    starts.push(Date.now());
    if (starts.length === 1) { firstStarted(); await held; }
    else secondStarted();
    return Response.json({ ok: true });
  };
  const first = fetchSource('https://openlibrary.org/first', fetchFn);
  await firstReady;
  const second = fetchSource('https://openlibrary.org/second', fetchFn);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([secondReady, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Second request waited for the first response')), 3000);
    })]);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(1000);
  } finally {
    clearTimeout(timeout);
    releaseFirst();
    await Promise.all([first, second]);
  }
});
