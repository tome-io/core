export type SyncedCollection = "library" | "reading-list";

export interface CollectionSyncRecord {
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

  for (const record of groups.flat()) {
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
