import { publicationAliases } from '@tomeio/domain';
import {
  isProgressSyncRecord,
  type ProgressSyncRecord,
} from './progress-sync-model';
import type { CollectionSyncRecord } from './library-sync-model';
import type { ReaderLocator } from './reader-state';

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
    left.sourceUrl === right.sourceUrl &&
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
  documentAliases?: string[];
  locatorDocument?: string | null;
  documentMetadata: {
    title: string | null;
    authors: string[];
    format: string | null;
    identifiers?: Record<string, string>;
  } | null;
  percentage: number;
  locator?: {
    spineIndex?: number;
    href?: string;
    progression?: number;
    textOffset?: number;
    koreaderXPointer?: string;
    precision?: 'exact' | 'nearest-anchor';
  } | null;
  locatorPrecision?: 'exact' | 'nearest-anchor' | 'percentage';
  metadata: Record<string, unknown> | null;
  source: 'tomeio' | 'koreader' | 'moonreader' | 'kobo';
  updatedAt: number;
  serverUpdatedAt: number;
  removedAt: number | null;
}

export function progressRecordFromHosted(
  record: HostedProgressRecord,
): ProgressSyncRecord | null {
  const embedded = record.metadata?.progressRecord;
  if (isProgressSyncRecord(embedded)) return {
    ...embedded,
    aliases: [...new Set([...embedded.aliases,
      ...(record.documentMetadata ? publicationAliases(record.documentMetadata.title ?? '', record.documentMetadata.authors, record.documentMetadata.identifiers) : []),
      ...(record.documentAliases ?? [record.document]).map((value) => `hosted-document:koreader-partial-md5-v1:${value}`),
    ])],
  };
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
    aliases: [...aliases, ...publicationAliases(shared.title, shared.authors, shared.identifiers),
      ...(record.documentAliases ?? [record.document]).map((value) => `hosted-document:koreader-partial-md5-v1:${value}`)],
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

export function readerLocatorFromHosted(
  record: HostedProgressRecord,
  format?: string,
  localDocument?: string,
): ReaderLocator | undefined {
  if (!localDocument || record.locatorDocument !== localDocument) return undefined;
  const href = record.locator?.href;
  if (!href) return undefined;
  const progression = record.locator?.progression;
  return {
    href,
    type:
      format?.toLowerCase() === 'pdf'
        ? 'application/pdf'
        : 'application/xhtml+xml',
    locations: {
      ...(typeof progression === 'number' ? { progression } : {}),
      totalProgression: Math.max(0, Math.min(1, record.percentage)),
    },
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
