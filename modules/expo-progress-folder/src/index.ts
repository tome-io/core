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
    throw new Error('Google Drive progress sync requires a native Reader build.');
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
