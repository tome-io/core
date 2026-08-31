import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

import { verifyProxyRequest } from './proxy-auth';

const MAX_BODY_BYTES = 16_384;
const MAX_CLOCK_SKEW_MS = 60_000;
const NONCE_TTL_MS = 5 * 60_000;
const ALLOWED_ORIGIN = 'https://openapi.rakuten.co.jp';
const ALLOWED_PATHS = new Set([
  '/services/api/Kobo/EbookSearch/20170426',
  '/services/api/Kobo/GenreSearch/20131010',
]);
const ALLOWED_PARAMETERS = new Set([
  'NGKeyword',
  'affiliateId',
  'applicationId',
  'author',
  'elements',
  'field',
  'format',
  'formatVersion',
  'genreInformationFlag',
  'hits',
  'itemNumber',
  'keyword',
  'koboGenreId',
  'language',
  'orFlag',
  'page',
  'publisherName',
  'salesType',
  'sort',
  'title',
]);

class OutboundRateLimiter {
  private nextSlot = 0;

  async wait(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    const delay = slot - now;
    if (delay > 10_000) throw new Error('rate_limit_queue_full');
    this.nextSlot = slot + 200;
    if (delay > 0) await Bun.sleep(delay);
  }
}

interface ProxyPayload {
  url?: unknown;
  headers?: {
    accept?: unknown;
    accessKey?: unknown;
  };
}

const app = new Hono();
const rateLimiter = new OutboundRateLimiter();
const usedNonces = new Map<string, number>();

app.use('*', secureHeaders());
app.get('/health', (context) => context.json({ status: 'ok' }));
app.post('/v1/fetch', async (context) => {
  const secret = process.env.EGRESS_PROXY_SECRET?.trim();
  if (!secret) return context.json({ error: 'proxy_not_configured' }, 503);

  const body = await context.req.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    return context.json({ error: 'request_too_large' }, 413);
  }
  const timestamp = context.req.header('X-Tomeio-Timestamp') ?? '';
  const nonce = context.req.header('X-Tomeio-Nonce') ?? '';
  const signature = context.req.header('X-Tomeio-Signature') ?? '';
  const timestampNumber = Number(timestamp);
  if (
    !Number.isFinite(timestampNumber) ||
    Math.abs(Date.now() - timestampNumber) > MAX_CLOCK_SKEW_MS ||
    !/^[a-f0-9-]{36}$/i.test(nonce)
  ) {
    return context.json({ error: 'invalid_authentication' }, 401);
  }

  const now = Date.now();
  for (const [candidate, expiresAt] of usedNonces) {
    if (expiresAt <= now) usedNonces.delete(candidate);
  }
  if (usedNonces.has(nonce)) return context.json({ error: 'replayed_request' }, 409);
  if (!(await verifyProxyRequest(secret, timestamp, nonce, body, signature))) {
    return context.json({ error: 'invalid_authentication' }, 401);
  }
  usedNonces.set(nonce, now + NONCE_TTL_MS);

  let payload: ProxyPayload;
  try {
    payload = JSON.parse(body) as ProxyPayload;
  } catch {
    return context.json({ error: 'invalid_json' }, 400);
  }
  if (typeof payload.url !== 'string') return context.json({ error: 'invalid_url' }, 400);

  let target: URL;
  try {
    target = new URL(payload.url);
  } catch {
    return context.json({ error: 'invalid_url' }, 400);
  }
  if (target.origin !== ALLOWED_ORIGIN || !ALLOWED_PATHS.has(target.pathname)) {
    return context.json({ error: 'destination_not_allowed' }, 403);
  }
  if ([...target.searchParams.keys()].some((key) => !ALLOWED_PARAMETERS.has(key))) {
    return context.json({ error: 'parameter_not_allowed' }, 403);
  }
  const accessKey = payload.headers?.accessKey;
  if (typeof accessKey !== 'string' || !accessKey.trim()) {
    return context.json({ error: 'access_key_required' }, 400);
  }

  try {
    await rateLimiter.wait();
  } catch {
    return context.json({ error: 'rate_limit_queue_full' }, 429);
  }
  const response = await fetch(target, {
    headers: {
      Accept:
        typeof payload.headers?.accept === 'string'
          ? payload.headers.accept
          : 'application/json',
      accessKey,
    },
    redirect: 'error',
  });
  return new Response(response.body, {
    status: response.status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
    },
  });
});

export default {
  hostname: '0.0.0.0',
  port: 3241,
  fetch: app.fetch,
};
