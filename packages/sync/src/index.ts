export const PROGRESS_SYNC_KIND = 'reader-progress-sync';
export const PROGRESS_SYNC_VERSION = 3;
export type ProgressSyncVersion = 1 | 2 | typeof PROGRESS_SYNC_VERSION;

export const KOREADER_PARTIAL_MD5_SAMPLE_SIZE = 1_024;

export function koreaderPartialMd5Offsets(): number[] {
  return Array.from({ length: 12 }, (_, index) =>
    index === 0
      ? 0
      : KOREADER_PARTIAL_MD5_SAMPLE_SIZE * 2 ** (2 * (index - 1))
  );
}

export function collectKoreaderPartialMd5Samples(
  readAt: (offset: number, length: number) => Uint8Array
): Uint8Array {
  const samples: Uint8Array[] = [];
  let totalLength = 0;
  for (const offset of koreaderPartialMd5Offsets()) {
    const sample = readAt(offset, KOREADER_PARTIAL_MD5_SAMPLE_SIZE);
    if (sample.byteLength === 0) break;
    const bounded = sample.subarray(0, KOREADER_PARTIAL_MD5_SAMPLE_SIZE);
    samples.push(bounded);
    totalLength += bounded.byteLength;
  }
  const combined = new Uint8Array(totalLength);
  let combinedOffset = 0;
  for (const sample of samples) {
    combined.set(sample, combinedOffset);
    combinedOffset += sample.byteLength;
  }
  return combined;
}

export interface ProgressSyncRecord {
  identity: string;
  aliases: string[];
  title: string;
  author: string;
  format: string;
  progress: number;
  isRead: boolean;
  readingTimeMs?: number;
  wordsRead?: number;
  lastReadAt?: number;
  updatedAt: number;
  removedAt?: number;
}

export interface ProgressSyncDocument {
  kind: typeof PROGRESS_SYNC_KIND;
  version: ProgressSyncVersion;
  deviceId?: string;
  generatedAt: number;
  records: ProgressSyncRecord[];
}

export function isProgressSyncRecord(value: unknown): value is ProgressSyncRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ProgressSyncRecord>;
  return (
    typeof record.identity === 'string' &&
    Array.isArray(record.aliases) &&
    record.aliases.every((alias) => typeof alias === 'string') &&
    typeof record.title === 'string' &&
    typeof record.author === 'string' &&
    typeof record.format === 'string' &&
    typeof record.progress === 'number' &&
    Number.isFinite(record.progress) &&
    typeof record.isRead === 'boolean' &&
    typeof record.updatedAt === 'number' &&
    Number.isFinite(record.updatedAt) &&
    (record.removedAt == null ||
      (typeof record.removedAt === 'number' && Number.isFinite(record.removedAt)))
  );
}

function newerRecord(left: ProgressSyncRecord, right: ProgressSyncRecord): ProgressSyncRecord {
  if (left.isRead !== right.isRead) return left.isRead ? left : right;
  if (left.progress !== right.progress) return left.progress > right.progress ? left : right;
  return left.updatedAt >= right.updatedAt ? left : right;
}

function greatestOptional(left?: number, right?: number): number | undefined {
  if (left == null) return right;
  if (right == null) return left;
  return Math.max(left, right);
}

export function isProgressRecordRemoved(record: ProgressSyncRecord): boolean {
  return record.removedAt != null && record.removedAt >= record.updatedAt;
}

export function mergeProgressRecords(
  ...groups: ProgressSyncRecord[][]
): ProgressSyncRecord[] {
  const merged: ProgressSyncRecord[] = [];
  const identityIndexes = new Map<string, number>();
  const aliasIndexes = new Map<string, number>();

  for (const record of groups.flat()) {
    const matchingIndexes = [
      identityIndexes.get(record.identity),
      ...record.aliases.map((alias) => aliasIndexes.get(alias)),
    ].filter((index): index is number => index != null);
    const index = matchingIndexes.length ? Math.min(...matchingIndexes) : -1;
    if (index === -1) {
      const nextIndex = merged.length;
      const next = { ...record, aliases: [...new Set(record.aliases)].sort() };
      merged.push(next);
      identityIndexes.set(next.identity, nextIndex);
      for (const alias of next.aliases) {
        if (!aliasIndexes.has(alias)) aliasIndexes.set(alias, nextIndex);
      }
      continue;
    }
    const current = merged[index];
    if (!current) continue;
    const winner = newerRecord(current, record);
    const removedAt = greatestOptional(current.removedAt, record.removedAt);
    const next: ProgressSyncRecord = {
      ...winner,
      aliases: [...new Set([...current.aliases, ...record.aliases])].sort(),
      isRead: current.isRead || record.isRead,
      progress:
        current.isRead || record.isRead
          ? 100
          : Math.max(current.progress, record.progress),
      readingTimeMs: greatestOptional(current.readingTimeMs, record.readingTimeMs),
      wordsRead: greatestOptional(current.wordsRead, record.wordsRead),
      lastReadAt: greatestOptional(current.lastReadAt, record.lastReadAt),
      updatedAt: Math.max(current.updatedAt, record.updatedAt),
    };
    if (removedAt != null && removedAt >= next.updatedAt) next.removedAt = removedAt;
    else delete next.removedAt;
    merged[index] = next;
    if (current.identity !== next.identity && identityIndexes.get(current.identity) === index) {
      identityIndexes.delete(current.identity);
    }
    identityIndexes.set(next.identity, index);
    for (const alias of next.aliases) {
      if (!aliasIndexes.has(alias)) aliasIndexes.set(alias, index);
    }
  }
  return merged.sort((left, right) => left.identity.localeCompare(right.identity));
}
