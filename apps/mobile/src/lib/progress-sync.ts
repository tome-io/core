import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ProgressFolderFile } from '../../modules/expo-progress-folder/src';
import {
  applyProgressSyncRecords,
  loadProgressSyncRecords,
} from './library-db';
import {
  createProgressFolderFile,
  listProgressFolderFiles,
  readProgressFolderFile,
  writeProgressFolderFile,
} from './progress-folder-provider';
import {
  mergeProgressRecords,
  PROGRESS_SYNC_KIND,
  PROGRESS_SYNC_VERSION,
  type ProgressSyncDocument,
  type ProgressSyncRecord,
  type ProgressSyncVersion,
} from './progress-sync-model';
import { isExternalFolderLocation } from './download';

const LEGACY_SYNC_FILENAME = 'reader-progress-v1.json';
const SYNC_FILENAME_PREFIX = 'reader-progress-';
const DEVICE_ID_KEY = 'reader_progress_device_id_v1';
const PREVIOUS_LOCATOR_PREFIX = 'reader_progress_sync_file_v2:';
const LEGACY_LOCATOR_PREFIX = 'reader_progress_sync_file_v1:';
const MAX_SYNC_FILE_BYTES = 2 * 1024 * 1024;
const MAX_DISCOVERY_FILES = 80;

export interface ProgressSyncResult {
  fileUri: string;
  importedRecords: number;
  wroteChanges: boolean;
  recordCount: number;
  syncedAt: number;
}

interface LocatedSyncFiles {
  ownFileUri: string | null;
  ownDocument: ProgressSyncDocument | null;
  documents: ProgressSyncDocument[];
}

function createDeviceId(): string {
  const random = () => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${random()}-${random()}`;
}

async function getDeviceId(): Promise<string> {
  const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (stored) return stored;
  const deviceId = createDeviceId();
  await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
  return deviceId;
}

function syncFilename(deviceId: string): string {
  return `${SYNC_FILENAME_PREFIX}${deviceId}.json`;
}

function validRecord(value: unknown): value is ProgressSyncRecord {
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

function parseSyncDocument(contents: string, required: boolean): ProgressSyncDocument | null {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    if (!required) return null;
    throw new Error(`The sync progress file is not valid JSON: ${String(error)}`);
  }
  if (!value || typeof value !== 'object') {
    if (!required) return null;
    throw new Error('The sync progress file does not contain an object.');
  }

  const document = value as Partial<ProgressSyncDocument>;
  if (document.kind !== PROGRESS_SYNC_KIND) {
    if (!required) return null;
    throw new Error('The selected sync progress file belongs to another application.');
  }
  if (document.version !== 1 && document.version !== 2 && document.version !== PROGRESS_SYNC_VERSION) {
    throw new Error(`Sync progress version ${String(document.version)} is not supported.`);
  }
  if (
    document.version >= 2 &&
    (typeof document.deviceId !== 'string' || !document.deviceId)
  ) {
    throw new Error('The sync progress file has no device identifier.');
  }
  if (!Array.isArray(document.records) || !document.records.every(validRecord)) {
    throw new Error('The sync progress file contains invalid reading records.');
  }

  return {
    kind: PROGRESS_SYNC_KIND,
    version: document.version as ProgressSyncVersion,
    deviceId: document.deviceId,
    generatedAt:
      typeof document.generatedAt === 'number' && Number.isFinite(document.generatedAt)
        ? document.generatedAt
        : 0,
    records: document.records,
  };
}

async function readSyncDocument(
  file: ProgressFolderFile,
  required: boolean
): Promise<ProgressSyncDocument | null> {
  if (typeof file.size === 'number' && file.size > MAX_SYNC_FILE_BYTES) {
    if (!required) return null;
    throw new Error('The sync progress file is unexpectedly large.');
  }
  const contents = await readProgressFolderFile(file.uri);
  return parseSyncDocument(contents, required);
}

function isNamedSyncFile(filename: string): boolean {
  const normalized = filename.toLowerCase();
  return (
    normalized === LEGACY_SYNC_FILENAME ||
    (normalized.startsWith(SYNC_FILENAME_PREFIX) && normalized.endsWith('.json'))
  );
}

async function locateSyncFiles(
  directoryUri: string,
  deviceId: string
): Promise<LocatedSyncFiles> {
  const expectedFilename = syncFilename(deviceId).toLowerCase();
  const documentsByUri = new Map<string, ProgressSyncDocument>();
  let ownFileUri: string | null = null;
  let ownDocument: ProgressSyncDocument | null = null;

  const children = await listProgressFolderFiles(directoryUri);
  const candidates = children
    .filter((file) => {
      const name = file.name.toLowerCase();
      return isNamedSyncFile(name) || !name.includes('.');
    })
    .slice(0, MAX_DISCOVERY_FILES);

  for (const candidate of candidates) {
    const name = candidate.name.toLowerCase();
    const namedSyncFile = isNamedSyncFile(name);
    const document = await readSyncDocument(candidate, namedSyncFile);
    if (!document) continue;
    documentsByUri.set(candidate.uri, document);

    if (document.deviceId === deviceId) {
      if (ownFileUri && ownFileUri !== candidate.uri) {
        throw new Error('This installation has more than one sync progress file.');
      }
      ownFileUri = candidate.uri;
      ownDocument = document;
    } else if (name === expectedFilename) {
      throw new Error('This installation’s sync filename belongs to another device.');
    }
  }

  return {
    ownFileUri,
    ownDocument,
    documents: [...documentsByUri.values()],
  };
}

function recordPayload(records: ProgressSyncRecord[]): string {
  return JSON.stringify(records);
}

export async function synchronizeProgressFolder(
  directoryUri: string
): Promise<ProgressSyncResult> {
  if (!isExternalFolderLocation(directoryUri)) {
    throw new Error('Progress folder sync requires a user-selected shared folder.');
  }

  const deviceId = await getDeviceId();
  const located = await locateSyncFiles(directoryUri, deviceId);
  const localRecords = await loadProgressSyncRecords();
  const folderRecords = located.documents.flatMap((document) => document.records);
  console.info(
    `[progress-sync] Found ${located.documents.length} sync file(s) containing ${folderRecords.length} record(s).`
  );
  const mergedBeforeImport = mergeProgressRecords(folderRecords, localRecords);
  const importedRecords = await applyProgressSyncRecords(mergedBeforeImport);
  const merged = mergeProgressRecords(folderRecords, await loadProgressSyncRecords());
  const wroteChanges =
    !located.ownDocument ||
    recordPayload(located.ownDocument.records) !== recordPayload(merged);
  const syncedAt = Date.now();
  let ownFileUri = located.ownFileUri;

  if (wroteChanges) {
    const document: ProgressSyncDocument = {
      kind: PROGRESS_SYNC_KIND,
      version: PROGRESS_SYNC_VERSION,
      deviceId,
      generatedAt: syncedAt,
      records: merged,
    };
    const contents = JSON.stringify(document);
    if (ownFileUri) {
      await writeProgressFolderFile(ownFileUri, contents);
    } else {
      ownFileUri = await createProgressFolderFile(
        directoryUri,
        syncFilename(deviceId),
        contents
      );
    }
  }
  if (!ownFileUri) {
    throw new Error('Reader could not locate or create its progress sync file.');
  }

  console.info(
    `[progress-sync] Applied ${importedRecords} update(s); ${merged.length} merged record(s); ${wroteChanges ? 'wrote this device file' : 'no write required'}.`
  );

  return {
    fileUri: ownFileUri,
    importedRecords,
    wroteChanges,
    recordCount: merged.length,
    syncedAt,
  };
}

export async function forgetProgressSyncFolder(directoryUri: string): Promise<void> {
  const deviceId = await getDeviceId();
  await AsyncStorage.multiRemove([
    `${PREVIOUS_LOCATOR_PREFIX}${deviceId}:${directoryUri}`,
    `${LEGACY_LOCATOR_PREFIX}${directoryUri}`,
  ]);
}
