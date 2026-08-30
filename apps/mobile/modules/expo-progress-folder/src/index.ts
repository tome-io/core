import { requireNativeModule } from 'expo-modules-core';

export interface ProgressFolderFile {
  name: string;
  uri: string;
  size: number | null;
  modifiedAt: number | null;
  mimeType: string | null;
}

export interface FolderDirectoryEntry extends ProgressFolderFile {
  isDirectory: boolean;
}

export interface ProgressFolderDiagnostics {
  authority: string | null;
  displayName?: string | null;
  storageKind?: 'cloud' | 'device' | 'unknown';
  isTreeUri: boolean;
  persistedReadPermission: boolean;
  persistedWritePermission: boolean;
  directChildCount: number;
  providerLoading: boolean;
  providerError: string | null;
}

export interface RenderedPdfCover {
  uri: string;
  width: number;
  height: number;
}

interface ProgressFolderNativeModule {
  pickDirectory?(initialDirectoryUri?: string | null): Promise<{ uri: string } | null>;
  listFiles(directoryUri: string): Promise<ProgressFolderFile[]>;
  listDirectoryEntries?(directoryUri: string): Promise<FolderDirectoryEntry[]>;
  readTextFile(fileUri: string): Promise<string>;
  createTextFile(
    directoryUri: string,
    filename: string,
    contents: string
  ): Promise<string>;
  writeTextFile(fileUri: string, contents: string): Promise<void>;
  getDirectoryDiagnostics(directoryUri: string): Promise<ProgressFolderDiagnostics>;
  copyFileToDirectory(
    sourceUri: string,
    directoryUri: string,
    filename: string,
    mimeType: string
  ): Promise<string>;
  ensureDirectory?(directoryUri: string, name: string): Promise<string>;
  copyFileToLocal?(sourceUri: string, destinationUri: string): Promise<void>;
  renderPdfCover?(
    sourceUri: string,
    destinationUri: string,
    maxWidth: number
  ): Promise<RenderedPdfCover>;
  deleteFile(fileUri: string): Promise<void>;
  forgetDirectory?(directoryUri: string): Promise<void>;
  openDirectory?(directoryUri: string): Promise<void>;
}

let nativeModule: ProgressFolderNativeModule | null = null;

try {
  nativeModule = requireNativeModule<ProgressFolderNativeModule>('ProgressFolder');
} catch {
  nativeModule = null;
}

export function hasNativeProgressFolder(): boolean {
  return nativeModule !== null;
}

function requireProgressFolderModule(): ProgressFolderNativeModule {
  if (!nativeModule) {
    throw new Error(
      'Tomeio folder access requires an installed development build. Run `bun run mobile:ios` or `bun run android` from the repository root.'
    );
  }
  return nativeModule;
}

export function isNativeFolderLocation(
  location: string | null | undefined
): boolean {
  return !!location && location.startsWith('tomeio-folder:');
}

export function pickNativeDirectory(
  initialDirectoryUri?: string | null
): Promise<{ uri: string } | null> {
  const module = requireProgressFolderModule();
  if (!module.pickDirectory) {
    throw new Error(
      'Choosing an iOS folder requires a rebuilt Tomeio app. Run `bun run mobile:ios` from the repository root.'
    );
  }
  return module.pickDirectory(initialDirectoryUri);
}

export function listNativeProgressFolderFiles(
  directoryUri: string
): Promise<ProgressFolderFile[]> {
  return requireProgressFolderModule().listFiles(directoryUri);
}

export function listNativeDirectoryEntries(
  directoryUri: string
): Promise<FolderDirectoryEntry[]> {
  const module = requireProgressFolderModule();
  if (!module.listDirectoryEntries) {
    throw new Error(
      'Scanning a selected folder requires a rebuilt Tomeio app. Rebuild the native app for this device.'
    );
  }
  return module.listDirectoryEntries(directoryUri);
}

export function readNativeProgressFolderFile(fileUri: string): Promise<string> {
  return requireProgressFolderModule().readTextFile(fileUri);
}

export function createNativeProgressFolderFile(
  directoryUri: string,
  filename: string,
  contents: string
): Promise<string> {
  return requireProgressFolderModule().createTextFile(
    directoryUri,
    filename,
    contents
  );
}

export function writeNativeProgressFolderFile(
  fileUri: string,
  contents: string
): Promise<void> {
  return requireProgressFolderModule().writeTextFile(fileUri, contents);
}

export function getNativeProgressFolderDiagnostics(
  directoryUri: string
): Promise<ProgressFolderDiagnostics> {
  return requireProgressFolderModule().getDirectoryDiagnostics(directoryUri);
}

export function copyNativeFileToDirectory(
  sourceUri: string,
  directoryUri: string,
  filename: string,
  mimeType: string
): Promise<string> {
  return requireProgressFolderModule().copyFileToDirectory(
    sourceUri,
    directoryUri,
    filename,
    mimeType
  );
}

export function ensureNativeDirectory(
  directoryUri: string,
  name: string
): Promise<string> {
  const module = requireProgressFolderModule();
  if (!module.ensureDirectory) {
    throw new Error(
      'Mirroring nested book folders requires a rebuilt Tomeio app. Rebuild the native app for this device.'
    );
  }
  return module.ensureDirectory(directoryUri, name);
}

export function copyNativeFileToLocal(
  sourceUri: string,
  destinationUri: string
): Promise<void> {
  const module = requireProgressFolderModule();
  if (!module.copyFileToLocal) {
    throw new Error(
      'Reading a selected cloud file requires a rebuilt Tomeio app. Rebuild the native app for this device.'
    );
  }
  return module.copyFileToLocal(sourceUri, destinationUri);
}

export function renderNativePdfCover(
  sourceUri: string,
  destinationUri: string,
  maxWidth = 900
): Promise<RenderedPdfCover> {
  const module = requireProgressFolderModule();
  if (!module.renderPdfCover) {
    throw new Error(
      'PDF cover extraction requires a rebuilt Tomeio app. Rebuild the native app for this device.'
    );
  }
  return module.renderPdfCover(sourceUri, destinationUri, maxWidth);
}

export function deleteNativeProgressFolderFile(fileUri: string): Promise<void> {
  return requireProgressFolderModule().deleteFile(fileUri);
}

export function forgetNativeDirectory(directoryUri: string): Promise<void> {
  if (!isNativeFolderLocation(directoryUri)) return Promise.resolve();
  const module = requireProgressFolderModule();
  return module.forgetDirectory?.(directoryUri) ?? Promise.resolve();
}

export function openNativeProgressFolder(directoryUri: string): Promise<void> {
  const module = requireProgressFolderModule();
  if (!module.openDirectory) {
    throw new Error(
      'Show in Files requires a rebuilt Tomeio Android app. Run `bun run android` from the repository root.'
    );
  }
  return module.openDirectory(directoryUri);
}
