import { requireNativeModule } from 'expo-modules-core';

export interface ProgressFolderFile {
  name: string;
  uri: string;
  size: number | null;
  modifiedAt: number | null;
  mimeType: string | null;
}

export interface ProgressFolderDiagnostics {
  authority: string | null;
  isTreeUri: boolean;
  persistedReadPermission: boolean;
  persistedWritePermission: boolean;
  directChildCount: number;
  providerLoading: boolean;
  providerError: string | null;
}

interface ProgressFolderNativeModule {
  listFiles(directoryUri: string): Promise<ProgressFolderFile[]>;
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
  deleteFile(fileUri: string): Promise<void>;
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
      'Tomeio folder access requires the installed development build. Run `bun run android` from the repository root.'
    );
  }
  return nativeModule;
}

export function listNativeProgressFolderFiles(
  directoryUri: string
): Promise<ProgressFolderFile[]> {
  return requireProgressFolderModule().listFiles(directoryUri);
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

export function deleteNativeProgressFolderFile(fileUri: string): Promise<void> {
  return requireProgressFolderModule().deleteFile(fileUri);
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
