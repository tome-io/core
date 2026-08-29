import {
  isProgressSyncRecord,
  type ProgressSyncRecord,
} from './progress-sync-model';

export interface HostedProgressRecord {
  document: string;
  documentMetadata: {
    title: string | null;
    authors: string[];
    format: string | null;
  } | null;
  percentage: number;
  metadata: Record<string, unknown> | null;
  source: 'tomeio' | 'koreader';
  updatedAt: number;
  serverUpdatedAt: number;
  removedAt: number | null;
}

export function progressRecordFromHosted(
  record: HostedProgressRecord,
): ProgressSyncRecord | null {
  const embedded = record.metadata?.progressRecord;
  if (isProgressSyncRecord(embedded)) return embedded;
  const shared = record.documentMetadata;
  if (shared?.title == null) return null;
  const syncMetadata = record.metadata?.syncRecord;
  const syncRecord = syncMetadata != null && typeof syncMetadata === 'object'
    ? syncMetadata as Record<string, unknown>
    : null;
  const aliases = Array.isArray(syncRecord?.aliases)
    ? syncRecord.aliases.filter((alias): alias is string => typeof alias === 'string')
    : [];
  const optionalNumber = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  return {
    identity:
      typeof syncRecord?.identity === 'string'
        ? syncRecord.identity
        : `fingerprint:koreader-partial-md5-v1:${record.document}`,
    aliases,
    title: shared.title,
    author: shared.authors.join(', ') || 'Unknown',
    format: shared.format ?? '',
    progress: Math.max(0, Math.min(100, record.percentage * 100)),
    isRead: record.percentage >= 1,
    readingTimeMs: optionalNumber(syncRecord?.readingTimeMs),
    wordsRead: optionalNumber(syncRecord?.wordsRead),
    lastReadAt: optionalNumber(syncRecord?.lastReadAt),
    updatedAt: record.updatedAt,
    ...(record.removedAt == null ? {} : { removedAt: record.removedAt }),
  };
}

export function hostedAccountMetadata(record: ProgressSyncRecord): Record<string, unknown> {
  return {
    syncRecord: {
      identity: record.identity,
      aliases: record.aliases,
      ...(record.readingTimeMs == null ? {} : { readingTimeMs: record.readingTimeMs }),
      ...(record.wordsRead == null ? {} : { wordsRead: record.wordsRead }),
      ...(record.lastReadAt == null ? {} : { lastReadAt: record.lastReadAt }),
    },
  };
}
