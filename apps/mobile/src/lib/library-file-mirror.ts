import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  copyNativeFileToDirectory,
  deleteNativeProgressFolderFile,
  ensureNativeDirectory,
  listNativeDirectoryEntries,
} from '../../modules/expo-progress-folder/src';

import { bookMimeType, isSafLocation } from './download';
import { isSupportedBookFilename } from './local-library';

const MIRROR_STATE_VERSION = 1;
const IGNORED_DIRECTORIES = new Set(['.moonreader', '.moon+', 'moonreader']);

interface MirroredBookFile {
  name: string;
  directoryPath: string;
  uri: string;
  size: number;
  modifiedAt: number;
}

interface MirrorEntryState {
  primary: string | null;
  mirror: string | null;
}

interface MirrorState {
  version: number;
  primaryLocation: string;
  mirrorLocation: string;
  files: Record<string, MirrorEntryState>;
}

export interface LibraryFileMirrorResult {
  copiedToPrimary: number;
  copiedToMirror: number;
  deletedFromPrimary: number;
  deletedFromMirror: number;
  conflictsResolvedFromPrimary: number;
  fileCount: number;
  primaryChanged: boolean;
}

export interface LibraryFileMirrorProgress {
  phase: 'scanning' | 'matching' | 'finalizing';
  completed: number;
  total: number;
  currentFile?: string;
  detail: string;
}

export interface LibraryFileMirrorOptions {
  onProgress?: (progress: LibraryFileMirrorProgress) => void;
}

function finiteNumber(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function signature(file: MirroredBookFile | undefined): string | null {
  return file ? `${file.size}:${file.modifiedAt}` : null;
}

function stateKey(primaryLocation: string, mirrorLocation: string): string {
  let hash = 2166136261;
  for (const character of `${primaryLocation}\n${mirrorLocation}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `library_file_mirror_v${MIRROR_STATE_VERSION}:${(hash >>> 0).toString(36)}`;
}

async function loadState(
  primaryLocation: string,
  mirrorLocation: string,
): Promise<MirrorState | null> {
  const raw = await AsyncStorage.getItem(stateKey(primaryLocation, mirrorLocation));
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<MirrorState>;
  if (
    parsed.version !== MIRROR_STATE_VERSION ||
    parsed.primaryLocation !== primaryLocation ||
    parsed.mirrorLocation !== mirrorLocation ||
    !parsed.files
  ) {
    return null;
  }
  return parsed as MirrorState;
}

async function saveState(
  primaryLocation: string,
  mirrorLocation: string,
  primaryFiles: Map<string, MirroredBookFile>,
  mirrorFiles: Map<string, MirroredBookFile>,
): Promise<void> {
  const files: Record<string, MirrorEntryState> = {};
  const paths = new Set([...primaryFiles.keys(), ...mirrorFiles.keys()]);
  for (const path of paths) {
    files[path] = {
      primary: signature(primaryFiles.get(path)),
      mirror: signature(mirrorFiles.get(path)),
    };
  }
  const state: MirrorState = {
    version: MIRROR_STATE_VERSION,
    primaryLocation,
    mirrorLocation,
    files,
  };
  await AsyncStorage.setItem(
    stateKey(primaryLocation, mirrorLocation),
    JSON.stringify(state),
  );
}

function childPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

async function scanBookFiles(
  directoryUri: string,
  directoryPath = '',
  output = new Map<string, MirroredBookFile>(),
  visited = new Set<string>(),
): Promise<Map<string, MirroredBookFile>> {
  if (visited.has(directoryUri)) return output;
  visited.add(directoryUri);
  const entries = await listNativeDirectoryEntries(directoryUri);
  for (const entry of entries) {
    const normalizedName = entry.name.toLowerCase();
    if (entry.isDirectory) {
      if (entry.name.startsWith('.') || IGNORED_DIRECTORIES.has(normalizedName)) continue;
      await scanBookFiles(
        entry.uri,
        childPath(directoryPath, entry.name),
        output,
        visited,
      );
      continue;
    }
    if (!isSupportedBookFilename(entry.name)) continue;
    const relativePath = childPath(directoryPath, entry.name);
    output.set(relativePath, {
      name: entry.name,
      directoryPath,
      uri: entry.uri,
      size: finiteNumber(entry.size),
      modifiedAt: finiteNumber(entry.modifiedAt),
    });
  }
  return output;
}

async function destinationDirectory(
  rootUri: string,
  directoryPath: string,
  cache: Map<string, string>,
): Promise<string> {
  if (!directoryPath) return rootUri;
  const cached = cache.get(directoryPath);
  if (cached) return cached;
  let currentUri = rootUri;
  let currentPath = '';
  for (const segment of directoryPath.split('/')) {
    currentPath = childPath(currentPath, segment);
    const known = cache.get(currentPath);
    if (known) {
      currentUri = known;
      continue;
    }
    currentUri = await ensureNativeDirectory(currentUri, segment);
    cache.set(currentPath, currentUri);
  }
  return currentUri;
}

async function copyBook(
  source: MirroredBookFile,
  destinationRoot: string,
  directoryCache: Map<string, string>,
): Promise<void> {
  const directory = await destinationDirectory(
    destinationRoot,
    source.directoryPath,
    directoryCache,
  );
  await copyNativeFileToDirectory(
    source.uri,
    directory,
    source.name,
    bookMimeType(source.name),
  );
}

function newerFile(
  primary: MirroredBookFile,
  mirror: MirroredBookFile,
): 'primary' | 'mirror' {
  if (primary.modifiedAt > mirror.modifiedAt) return 'primary';
  if (mirror.modifiedAt > primary.modifiedAt) return 'mirror';
  return 'primary';
}

export async function synchronizeLibraryBookFiles(
  primaryLocation: string,
  mirrorLocation: string,
  options: LibraryFileMirrorOptions = {},
): Promise<LibraryFileMirrorResult> {
  if (!isSafLocation(primaryLocation) || !isSafLocation(mirrorLocation)) {
    throw new Error('Book folder mirroring requires two Android document-provider folders.');
  }
  if (primaryLocation === mirrorLocation) {
    throw new Error('The primary library and device mirror must be different folders.');
  }

  options.onProgress?.({
    phase: 'scanning',
    completed: 0,
    total: 0,
    detail: 'Reading the primary library and on-device mirror…',
  });
  const [previous, primaryFiles, mirrorFiles] = await Promise.all([
    loadState(primaryLocation, mirrorLocation),
    scanBookFiles(primaryLocation),
    scanBookFiles(mirrorLocation),
  ]);
  const result: LibraryFileMirrorResult = {
    copiedToPrimary: 0,
    copiedToMirror: 0,
    deletedFromPrimary: 0,
    deletedFromMirror: 0,
    conflictsResolvedFromPrimary: 0,
    fileCount: 0,
    primaryChanged: false,
  };
  const previousEntries = Object.values(previous?.files ?? {});
  const previouslyHadPrimaryBooks = previousEntries.some((entry) => entry.primary !== null);
  const previouslyHadMirrorBooks = previousEntries.some((entry) => entry.mirror !== null);
  if (previouslyHadPrimaryBooks && primaryFiles.size === 0 && mirrorFiles.size > 0) {
    throw new Error(
      'The primary library unexpectedly returned no book files. Tomeio stopped before applying deletions; check that the cloud folder is available and try again.',
    );
  }
  if (previouslyHadMirrorBooks && mirrorFiles.size === 0 && primaryFiles.size > 0) {
    throw new Error(
      'The on-device mirror unexpectedly returned no book files. Tomeio stopped before applying deletions; check folder access and try again.',
    );
  }
  const primaryDirectories = new Map<string, string>();
  const mirrorDirectories = new Map<string, string>();
  const paths = [...new Set([...primaryFiles.keys(), ...mirrorFiles.keys()])].sort();
  options.onProgress?.({
    phase: 'matching',
    completed: 0,
    total: paths.length,
    detail: `Comparing ${paths.length} book file${paths.length === 1 ? '' : 's'}…`,
  });

  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index];
    if (!path) continue;
    options.onProgress?.({
      phase: 'matching',
      completed: index,
      total: paths.length,
      currentFile: path,
      detail: `Checking ${index + 1} of ${paths.length}…`,
    });
    const primary = primaryFiles.get(path);
    const mirror = mirrorFiles.get(path);
    const prior = previous?.files[path];

    if (primary && mirror) {
      const primarySignature = signature(primary);
      const mirrorSignature = signature(mirror);
      if (!prior) {
        if (primary.size === mirror.size) continue;
        if (newerFile(primary, mirror) === 'mirror') {
          await copyBook(mirror, primaryLocation, primaryDirectories);
          result.copiedToPrimary += 1;
          result.primaryChanged = true;
        } else {
          await copyBook(primary, mirrorLocation, mirrorDirectories);
          result.copiedToMirror += 1;
        }
        continue;
      }

      const primaryChanged = primarySignature !== prior.primary;
      const mirrorChanged = mirrorSignature !== prior.mirror;
      if (primaryChanged && !mirrorChanged) {
        await copyBook(primary, mirrorLocation, mirrorDirectories);
        result.copiedToMirror += 1;
      } else if (mirrorChanged && !primaryChanged) {
        await copyBook(mirror, primaryLocation, primaryDirectories);
        result.copiedToPrimary += 1;
        result.primaryChanged = true;
      } else if (primaryChanged && mirrorChanged && primarySignature !== mirrorSignature) {
        await copyBook(primary, mirrorLocation, mirrorDirectories);
        result.copiedToMirror += 1;
        result.conflictsResolvedFromPrimary += 1;
      }
      continue;
    }

    if (primary) {
      if (prior?.primary && prior.mirror) {
        await deleteNativeProgressFolderFile(primary.uri);
        result.deletedFromPrimary += 1;
        result.primaryChanged = true;
      } else {
        await copyBook(primary, mirrorLocation, mirrorDirectories);
        result.copiedToMirror += 1;
      }
      continue;
    }

    if (mirror) {
      if (prior?.primary && prior.mirror) {
        await deleteNativeProgressFolderFile(mirror.uri);
        result.deletedFromMirror += 1;
      } else {
        await copyBook(mirror, primaryLocation, primaryDirectories);
        result.copiedToPrimary += 1;
        result.primaryChanged = true;
      }
    }
  }

  options.onProgress?.({
    phase: 'finalizing',
    completed: paths.length,
    total: paths.length,
    detail: 'Verifying both folders…',
  });
  const [nextPrimaryFiles, nextMirrorFiles] = await Promise.all([
    scanBookFiles(primaryLocation),
    scanBookFiles(mirrorLocation),
  ]);
  await saveState(primaryLocation, mirrorLocation, nextPrimaryFiles, nextMirrorFiles);
  result.fileCount = new Set([...nextPrimaryFiles.keys(), ...nextMirrorFiles.keys()]).size;
  return result;
}

export function libraryFileMirrorSummary(result: LibraryFileMirrorResult): string {
  const copied = result.copiedToPrimary + result.copiedToMirror;
  const deleted = result.deletedFromPrimary + result.deletedFromMirror;
  const changes = [
    copied ? `${copied} copied` : null,
    deleted ? `${deleted} removed` : null,
    result.conflictsResolvedFromPrimary
      ? `${result.conflictsResolvedFromPrimary} resolved from the primary library`
      : null,
  ].filter(Boolean);
  return changes.length
    ? `${changes.join(', ')}. ${result.fileCount} book file${result.fileCount === 1 ? '' : 's'} matched.`
    : `${result.fileCount} book file${result.fileCount === 1 ? '' : 's'} already matched.`;
}
