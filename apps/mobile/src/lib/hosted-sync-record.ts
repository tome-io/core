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
    (left.coverPreference ?? 'auto') === (right.coverPreference ?? 'auto') &&
    (left.coverPreferenceUpdatedAt ?? 0) === (right.coverPreferenceUpdatedAt ?? 0) &&
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
    (left.readingTimeMs ?? 0) === (right.readingTimeMs ?? 0) &&
    (left.wordsRead ?? 0) === (right.wordsRead ?? 0) &&
    (left.lastReadAt ?? 0) === (right.lastReadAt ?? 0) &&
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
      ...(record.documentAliases ?? [record.document]).flatMap((value) => [`hosted-document:koreader-partial-md5-v1:${value}`, `fingerprint:koreader-partial-md5-v1:${value}`]),
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
      ...(record.documentAliases ?? [record.document]).flatMap((value) => [`hosted-document:koreader-partial-md5-v1:${value}`, `fingerprint:koreader-partial-md5-v1:${value}`])],
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

// Canonicalize transport content. Event timestamps still travel on the wire,
// but observing a remote timestamp does not make an unchanged payload dirty.
export function syncPayloadContent(payload: Record<string, unknown>): string {
  const { updatedAt: _updatedAt, ...content } = payload;
  if (content.coverPreference === 'auto' && !content.coverPreferenceUpdatedAt) {
    delete content.coverPreference;
    delete content.coverPreferenceUpdatedAt;
  }
  if (content.metadata && typeof content.metadata === 'object') {
    const metadata = content.metadata as Record<string, unknown>;
    if (metadata.syncRecord && typeof metadata.syncRecord === 'object') {
      const { identity: _identity, aliases: _aliases, ...stats } = metadata.syncRecord as Record<string, unknown>;
      for (const key of ['readingTimeMs', 'wordsRead', 'lastReadAt']) {
        if (stats[key] === 0) delete stats[key];
      }
      content.metadata = { ...metadata, syncRecord: stats };
    }
  }
  if (Array.isArray(content.aliases)) content.aliases = [...new Set(content.aliases)].sort();
  if (Array.isArray(content.readerAliases)) content.readerAliases = [...content.readerAliases].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
    return value;
  };
  return JSON.stringify(canonical(content));
}
