import {
  isProgressSyncRecord,
  type ProgressSyncRecord,
} from './progress-sync-model';
import type { CollectionSyncRecord } from './library-sync-model';

interface SyncIdentityRecord {
  identity: string;
  aliases: string[];
}

function sameOptionalNumber(
  left: number | undefined,
  right: number | undefined
): boolean {
  return left === right;
}

export function matchingSyncRecord<T extends SyncIdentityRecord>(
  record: SyncIdentityRecord,
  candidates: T[]
): T | undefined {
  const identities = new Set([record.identity, ...record.aliases]);
  return candidates.find((candidate) =>
    [candidate.identity, ...candidate.aliases].some((identity) =>
      identities.has(identity)
    )
  );
}

export function sameCollectionSyncContent(
  left: CollectionSyncRecord,
  right: CollectionSyncRecord
): boolean {
  return (
    left.title === right.title &&
    left.author === right.author &&
    left.format === right.format &&
    left.addedAt === right.addedAt &&
    left.sortAt === right.sortAt &&
    (left.removedAt ?? undefined) === (right.removedAt ?? undefined)
  );
}

export function sameProgressSyncContent(
  left: ProgressSyncRecord,
  right: ProgressSyncRecord
): boolean {
  return (
    Math.abs(left.progress - right.progress) < 0.000001 &&
    left.isRead === right.isRead &&
    left.title === right.title &&
    left.author === right.author &&
    left.format === right.format &&
    sameOptionalNumber(left.readingTimeMs, right.readingTimeMs) &&
    sameOptionalNumber(left.wordsRead, right.wordsRead) &&
    sameOptionalNumber(left.lastReadAt, right.lastReadAt) &&
    sameOptionalNumber(left.removedAt, right.removedAt)
  );
}

export interface HostedProgressRecord {
  document: string;
  documentMetadata: {
    title: string | null;
    authors: string[];
    format: string | null;
  } | null;
  percentage: number;
  metadata: Record<string, unknown> | null;
  source: 'tomeio' | 'koreader' | 'moonreader';
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
