import { newerCoverPreference, type CoverPreferenceRecord } from './book-cover';
import { identityGroups } from '@tomeio/domain';
export type SyncedCollection = "library" | "reading-list";

export interface CollectionSyncRecord extends CoverPreferenceRecord {
  identity: string;
  aliases: string[];
  title: string;
  author: string;
  format: string;
  sourceUrl?: string;
  addedAt: number;
  sortAt: number;
  updatedAt: number;
  removedAt?: number;
}

export function isCollectionRecordRemoved(
  record: CollectionSyncRecord,
): boolean {
  return record.removedAt != null && record.removedAt >= record.updatedAt;
}

function eventTime(record: CollectionSyncRecord): number {
  return Math.max(record.updatedAt, record.removedAt ?? 0);
}

export function mergeCollectionSyncRecords(
  ...groups: CollectionSyncRecord[][]
): CollectionSyncRecord[] {
  const merged: CollectionSyncRecord[] = [];
  const indexes = new Map<string, number>();

  const connected = identityGroups(groups.flat()).flatMap((group) => {
    const aliases = [...new Set(group.flatMap((record) => [record.identity, ...record.aliases]))];
    return group.map((record) => ({ ...record, aliases }));
  });
  for (const record of connected) {
    const matching = [record.identity, ...record.aliases]
      .flatMap((alias) => {
        const index = indexes.get(alias);
        return index == null ? [] : [index];
      });
    const index = matching.length ? Math.min(...matching) : -1;
    if (index === -1) {
      const next = {
        ...record,
        aliases: [...new Set(record.aliases)].sort(),
      };
      const nextIndex = merged.length;
      merged.push(next);
      for (const alias of [next.identity, ...next.aliases]) {
        indexes.set(alias, nextIndex);
      }
      continue;
    }

    const current = merged[index];
    if (!current) continue;
    const winner = eventTime(record) >= eventTime(current) ? record : current;
    const next: CollectionSyncRecord = {
      ...winner,
      ...newerCoverPreference(current, record),
      aliases: [...new Set([...current.aliases, ...record.aliases])].sort(),
      addedAt: Math.min(current.addedAt, record.addedAt),
    };
    merged[index] = next;
    for (const alias of [current.identity, record.identity, next.identity, ...next.aliases]) {
      indexes.set(alias, index);
    }
  }

  return merged.sort((left, right) => left.identity.localeCompare(right.identity));
}

// File discovery is not a new membership event. Only explicit membership
// changes may replace an existing logical book's ordering or tombstone.
export function mergeCollectionSnapshots(
  stored: CollectionSyncRecord[],
  snapshots: CollectionSyncRecord[],
): CollectionSyncRecord[] {
  const known = new Set(stored);
  return identityGroups([...stored, ...snapshots]).flatMap((group) => {
    const existing = group.filter((record) => known.has(record));
    if (!existing.length) return mergeCollectionSyncRecords(group);
    const [membership] = mergeCollectionSyncRecords(existing);
    if (!membership) return [];
    return [{
      ...membership,
      ...group.reduce<CoverPreferenceRecord>((preference, record) => newerCoverPreference(preference, record), membership),
      aliases: [...new Set(group.flatMap((record) => [record.identity, ...record.aliases]))].sort(),
    }];
  }).sort((left, right) => left.identity.localeCompare(right.identity));
}
