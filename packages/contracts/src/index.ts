import type { BookMetadata, BookProgress } from '@tomeio/domain';
import type { ExtensionRegistrySnapshot, InstalledExtension } from '@tomeio/extension-runtime';

export interface LibrarySnapshot {
  books: BookMetadata[];
  progress: Record<string, BookProgress>;
}

export interface DirectorySelection {
  path: string;
  displayName: string;
}

export interface DesktopBridge {
  library: {
    snapshot(): Promise<LibrarySnapshot>;
    chooseDirectory(): Promise<DirectorySelection | null>;
  };
  extensions: {
    list(): Promise<ExtensionRegistrySnapshot>;
    install(repositoryUrl: string): Promise<InstalledExtension>;
    remove(id: string): Promise<void>;
    setEnabled(id: string, enabled: boolean): Promise<void>;
  };
  system: {
    platform(): Promise<'aix' | 'android' | 'darwin' | 'freebsd' | 'haiku' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'cygwin' | 'netbsd'>;
  };
}

export const DESKTOP_IPC = {
  librarySnapshot: 'library:snapshot',
  chooseDirectory: 'library:choose-directory',
  extensionsList: 'extensions:list',
  extensionsInstall: 'extensions:install',
  extensionsRemove: 'extensions:remove',
  extensionsSetEnabled: 'extensions:set-enabled',
  systemPlatform: 'system:platform',
} as const;
