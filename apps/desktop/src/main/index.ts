import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type OpenDialogOptions,
} from 'electron';
import { DESKTOP_IPC, type LibrarySnapshot } from '@tomeio/contracts';
import { ExtensionRegistry } from '@tomeio/extension-runtime';
import { officialExtensionManifests } from '@tomeio/official-extensions';
import { JsonExtensionStore } from './extension-store';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 600,
    backgroundColor: '#08090c',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function registerHandlers(): void {
  const store = new JsonExtensionStore(
    join(app.getPath('userData'), 'extensions.json')
  );
  const registry = new ExtensionRegistry(store, officialExtensionManifests);

  ipcMain.handle(DESKTOP_IPC.systemPlatform, () => process.platform);
  ipcMain.handle(DESKTOP_IPC.chooseDirectory, async () => {
    const options: OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    const path = result.filePaths[0];
    return result.canceled || !path
      ? null
      : { path, displayName: path.split('/').filter(Boolean).pop() ?? path };
  });
  ipcMain.handle(DESKTOP_IPC.librarySnapshot, async (): Promise<LibrarySnapshot> => {
    throw new Error(
      'The macOS library adapter is not configured yet. Choose a library directory first.'
    );
  });
  ipcMain.handle(DESKTOP_IPC.extensionsList, () => registry.list());
  ipcMain.handle(DESKTOP_IPC.extensionsInstall, (_event, repositoryUrl: unknown) => {
    if (typeof repositoryUrl !== 'string') throw new TypeError('repositoryUrl must be a string.');
    return registry.install(repositoryUrl);
  });
  ipcMain.handle(DESKTOP_IPC.extensionsRemove, (_event, id: unknown) => {
    if (typeof id !== 'string') throw new TypeError('id must be a string.');
    return registry.remove(id);
  });
  ipcMain.handle(
    DESKTOP_IPC.extensionsSetEnabled,
    (_event, id: unknown, enabled: unknown) => {
      if (typeof id !== 'string' || typeof enabled !== 'boolean') {
        throw new TypeError('Extension id and enabled state are invalid.');
      }
      return registry.setEnabled(id, enabled);
    }
  );
}

app.whenReady().then(() => {
  registerHandlers();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
