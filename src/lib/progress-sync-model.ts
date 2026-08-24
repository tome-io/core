export const PROGRESS_SYNC_KIND = 'reader-progress-sync';
export const PROGRESS_SYNC_VERSION = 2;
export type ProgressSyncVersion = 1 | typeof PROGRESS_SYNC_VERSION;

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
}

export interface ProgressSyncDocument {
  kind: typeof PROGRESS_SYNC_KIND;
  version: ProgressSyncVersion;
  deviceId?: string;
  generatedAt: number;
  records: ProgressSyncRecord[];
}

function aliasesOverlap(left: ProgressSyncRecord, right: ProgressSyncRecord): boolean {
  if (left.identity === right.identity) return true;
  const aliases = new Set(left.aliases);
  return right.aliases.some((alias) => aliases.has(alias));
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

export function mergeProgressRecords(
  ...groups: ProgressSyncRecord[][]
): ProgressSyncRecord[] {
  const merged: ProgressSyncRecord[] = [];
  for (const record of groups.flat()) {
    const index = merged.findIndex((candidate) => aliasesOverlap(candidate, record));
    if (index < 0) {
      merged.push({ ...record, aliases: [...new Set(record.aliases)].sort() });
      continue;
    }
    const current = merged[index];
    const winner = newerRecord(current, record);
    merged[index] = {
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
  }
  return merged.sort((left, right) => left.identity.localeCompare(right.identity));
}
