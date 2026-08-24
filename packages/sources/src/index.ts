export interface SourceCache {
  read<T>(key: string): Promise<T | null>;
  write<T>(key: string, value: T, ttlMs: number): Promise<void>;
}

export interface SourceHttpOptions {
  fetchFn?: typeof fetch;
  cache?: SourceCache;
  timeoutMs?: number;
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

export function createSourceHttpClient(options: SourceHttpOptions = {}): SourceHttpClient {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? 12_000;
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
        response = await fetchFn(url, {
          headers: { Accept: kind === 'json' ? 'application/json' : '*/*' },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        throw new SourceRequestError(`Source request failed for ${url}.`, url, { cause });
      }
      if (!response.ok) {
        throw new SourceRequestError(
          `Source request failed (${response.status}) for ${url}.`,
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
