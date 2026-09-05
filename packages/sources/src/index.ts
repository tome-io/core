declare const __DEV__: boolean;
export interface SourceCache {
  read<T>(key: string): Promise<T | null>;
  write<T>(key: string, value: T, ttlMs: number): Promise<void>;
}

export interface SourceHttpOptions {
  fetchFn?: typeof fetch;
  cache?: SourceCache;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface SourceHttpClient {
  json<T>(url: string, ttlMs?: number): Promise<T>;
  text(url: string, ttlMs?: number): Promise<string>;
}

export class SourceRequestError extends Error {
  readonly url: string;

  constructor(
    message: string,
    url: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'SourceRequestError';
    this.url = url;
  }
}

let nextRequestId = 0;
const originQueues = new Map<string, { pending: Promise<void>; nextStart: number }>();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Share Open Library's anonymous-client budget across discovery and enrichment.
export async function fetchSource(url: string, fetchFn: typeof fetch = fetch, init: RequestInit = {}, timeoutMs = 20_000): Promise<Response> {
  const origin = new URL(url).origin;
  const paced = origin === 'https://openlibrary.org';
  const queue = originQueues.get(origin) ?? { pending: Promise.resolve(), nextStart: 0 };
  if (paced) originQueues.set(origin, queue);
  const attempt = async () => {
    const requestId = ++nextRequestId;
    const queuedAt = performance.now();
    let slotStartedAt = queuedAt;
    if (paced) {
      // Reserve a start slot, not the entire response lifetime. Slow upstream
      // responses must not serialize otherwise independent requests.
      const slot = queue.pending.then(async () => {
        slotStartedAt = performance.now();
        await sleep(Math.max(0, queue.nextStart - Date.now()));
        queue.nextStart = Date.now() + 1_100;
      });
      queue.pending = slot.catch(() => {});
      await slot;
    }
    const startedAt = performance.now();
    let status: number | undefined;
    try {
      const response = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      status = response.status;
      return response;
    } finally {
      if (typeof __DEV__ !== 'undefined' && __DEV__) console.info('[source-timing]', {
        requestId, origin, status: status ?? 'network-error',
        queueMs: Math.round(slotStartedAt - queuedAt), pacingMs: Math.round(startedAt - slotStartedAt),
        networkMs: Math.round(performance.now() - startedAt),
      });
    }
  };
  for (let index = 0; ; index += 1) {
    let response: Response;
    try {
      response = await attempt();
    } catch (cause) {
      if (index < 1) { await sleep(750); continue; }
      throw new SourceRequestError(`Could not reach ${new URL(url).hostname}. Please retry.`, url, { cause });
    }
    if (index < 1 && [429, 500, 502, 503, 504].includes(response.status)) {
      const retryAfter = response.headers.get('retry-after');
      const seconds = retryAfter == null ? NaN : Number(retryAfter);
      const delay = Number.isFinite(seconds) ? seconds * 1000 : retryAfter ? Date.parse(retryAfter) - Date.now() : 750;
      // Do not retry earlier than the server asks; long backoffs stay user-driven.
      if (delay > 5000) return response;
      await response.body?.cancel();
      await sleep(Math.max(750, Number.isFinite(delay) ? delay : 750));
      continue;
    }
    return response;
  }
}

export function createSourceHttpClient(options: SourceHttpOptions = {}): SourceHttpClient {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const pending = new Map<string, Promise<unknown>>();

  async function request<T>(
    url: string,
    kind: 'json' | 'text',
    ttlMs: number
  ): Promise<T> {
    const key = `${kind}:${url}`;
    const active = pending.get(key);
    if (active) return active as Promise<T>;

    const operation = (async () => {
      const cached = await options.cache?.read<T>(key);
      if (cached != null) return cached;

      let response: Response;
      try {
        const headers = new Headers(options.headers);
        headers.set('Accept', kind === 'json' ? 'application/json' : '*/*');
        response = await fetchSource(url, fetchFn, { headers }, timeoutMs);
      } catch (cause) {
        if (cause instanceof SourceRequestError) throw cause;
        throw new SourceRequestError(`Could not reach ${new URL(url).hostname}. Please retry.`, url, { cause });
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new SourceRequestError(
          `Source returned HTTP ${response.status}. Please retry.`,
          url
        );
      }
      let value: T;
      try {
        value = (kind === 'json' ? await response.json() : await response.text()) as T;
      } catch (cause) {
        throw new SourceRequestError(`Source returned invalid ${kind} for ${url}.`, url, {
          cause,
        });
      }
      await options.cache?.write(key, value, ttlMs);
      return value;
    })();

    pending.set(key, operation);
    try {
      return await operation;
    } finally {
      pending.delete(key);
    }
  }

  return {
    json: <T>(url: string, ttlMs = 15 * 60_000) => request<T>(url, 'json', ttlMs),
    text: (url: string, ttlMs = 15 * 60_000) => request<string>(url, 'text', ttlMs),
  };
}

export function firstString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    return value.find((candidate) => typeof candidate === 'string' && candidate.trim())?.trim();
  }
  return undefined;
}

export function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((candidate): candidate is string => typeof candidate === 'string');
  }
  return typeof value === 'string' && value.trim() ? [value.trim()] : [];
}
