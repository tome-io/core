interface FileVersion { uri: string; size: number; modifiedAt: number }

// Session-scoped only. Unknown timestamps must never reuse a potentially stale hash.
export function createDocumentHashCache(limit = 256) {
  const entries = new Map<string, { version: string; value: Promise<string> }>();
  return (file: FileVersion, compute: () => Promise<string>): Promise<string> => {
    if (!(file.size > 0 && file.modifiedAt > 0)) return compute();
    const version = `${file.size}:${file.modifiedAt}`;
    const cached = entries.get(file.uri);
    if (cached?.version === version) return cached.value;
    const value = Promise.resolve().then(compute).catch((cause) => {
      if (entries.get(file.uri)?.value === value) entries.delete(file.uri);
      throw cause;
    });
    entries.delete(file.uri);
    entries.set(file.uri, { version, value });
    if (entries.size > limit) entries.delete(entries.keys().next().value!);
    return value;
  };
}
