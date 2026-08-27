import * as FileSystem from 'expo-file-system/legacy';

const MAX_BACKUP_SCAN_DEPTH = 4;
const INSPECTION_BATCH_SIZE = 24;

export interface MoonReaderBackupFile {
  uri: string;
  filename: string;
  size: number;
  modificationTime: number;
}

function filenameFromUri(uri: string): string {
  let decoded = uri;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    // Document-provider URIs can contain malformed escapes. The opaque URI is
    // still valid for FileSystem operations.
  }
  return decoded.split(/[/?#]/).filter(Boolean).pop() ?? '';
}

function finiteNumber(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isBackup(filename: string): boolean {
  const normalized = filename.toLowerCase();
  return normalized.endsWith('.mrpro') || normalized === 'cloud.backup';
}

function backupSortTime(backup: MoonReaderBackupFile): number {
  if (backup.modificationTime > 0) return backup.modificationTime;
  const date = backup.filename.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  return date ? Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3])) : 0;
}

function newerBackup(
  current: MoonReaderBackupFile | null,
  candidate: MoonReaderBackupFile
): MoonReaderBackupFile {
  if (!current) return candidate;
  const currentTime = backupSortTime(current);
  const candidateTime = backupSortTime(candidate);
  if (candidateTime !== currentTime) {
    return candidateTime > currentTime ? candidate : current;
  }
  return candidate.filename.localeCompare(current.filename) > 0 ? candidate : current;
}

async function inspectUris(uris: string[]) {
  const entries: {
    uri: string;
    info: Awaited<ReturnType<typeof FileSystem.getInfoAsync>>;
  }[] = [];
  for (let offset = 0; offset < uris.length; offset += INSPECTION_BATCH_SIZE) {
    const batch = uris.slice(offset, offset + INSPECTION_BATCH_SIZE);
    entries.push(
      ...(await Promise.all(
        batch.map(async (uri) => ({ uri, info: await FileSystem.getInfoAsync(uri) }))
      ))
    );
  }
  return entries;
}

async function scanSafFolder(
  directoryUri: string,
  depth: number,
  visited: Set<string>
): Promise<MoonReaderBackupFile | null> {
  if (visited.has(directoryUri) || depth > MAX_BACKUP_SCAN_DEPTH) return null;
  visited.add(directoryUri);
  let newest: MoonReaderBackupFile | null = null;
  const children = await FileSystem.StorageAccessFramework.readDirectoryAsync(directoryUri);
  for (const { uri, info } of await inspectUris(children)) {
    if (!info.exists) continue;
    if (info.isDirectory) {
      const nested = await scanSafFolder(uri, depth + 1, visited);
      if (nested) newest = newerBackup(newest, nested);
      continue;
    }
    const filename = filenameFromUri(uri);
    if (!isBackup(filename)) continue;
    newest = newerBackup(newest, {
      uri,
      filename,
      size: finiteNumber(info.size),
      modificationTime: finiteNumber(info.modificationTime) * 1000,
    });
  }
  return newest;
}

async function scanFileFolder(
  directoryUri: string,
  depth: number,
  visited: Set<string>
): Promise<MoonReaderBackupFile | null> {
  if (visited.has(directoryUri) || depth > MAX_BACKUP_SCAN_DEPTH) return null;
  visited.add(directoryUri);
  let newest: MoonReaderBackupFile | null = null;
  const children = await FileSystem.readDirectoryAsync(directoryUri);
  const entries = await inspectUris(
    children.map((name) => `${directoryUri.replace(/\/$/, '')}/${name}`)
  );
  for (let index = 0; index < entries.length; index += 1) {
    const name = children[index];
    const { uri, info } = entries[index];
    if (!info.exists) continue;
    if (info.isDirectory) {
      const nested = await scanFileFolder(uri, depth + 1, visited);
      if (nested) newest = newerBackup(newest, nested);
      continue;
    }
    if (!isBackup(name)) continue;
    newest = newerBackup(newest, {
      uri,
      filename: name,
      size: finiteNumber(info.size),
      modificationTime: finiteNumber(info.modificationTime) * 1000,
    });
  }
  return newest;
}

export async function findLatestMoonReaderBackup(
  directoryUri: string
): Promise<MoonReaderBackupFile> {
  const backup = directoryUri.startsWith('content:')
    ? await scanSafFolder(directoryUri, 0, new Set())
    : await scanFileFolder(directoryUri, 0, new Set());
  if (!backup) {
    throw new Error('No Moon+ Reader .mrpro or cloud.backup file was found in this folder.');
  }
  return backup;
}
