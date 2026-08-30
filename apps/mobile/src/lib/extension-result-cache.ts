const DEFAULT_TTL_MS = 15 * 60 * 1000;

interface CachedResult {
  expiresAt: number;
  value: unknown;
}

const results = new Map<string, CachedResult>();
const pending = new Map<string, Promise<unknown>>();

export async function cachedExtensionResult<T>(
  key: string,
  load: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS,
): Promise<T> {
  const cached = results.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  if (cached) results.delete(key);

  const inFlight = pending.get(key);
  if (inFlight) return inFlight as Promise<T>;

  const request = (async () => {
    const { getCachedContent, setCachedContent } = await import('./library-db');
    const persisted = await getCachedContent<T>(`extension:${key}`);
    if (persisted != null) {
      results.set(key, persisted);
      return persisted.value;
    }

    const value = await load();
    const expiresAt = Date.now() + ttlMs;
    results.set(key, { value, expiresAt });
    await setCachedContent(`extension:${key}`, value, ttlMs);
    return value;
  })();
  pending.set(key, request);
  try {
    return await request;
  } finally {
    pending.delete(key);
  }
}
