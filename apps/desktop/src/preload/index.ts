import { contextBridge, ipcRenderer } from 'electron';
import { DESKTOP_IPC, type DesktopBridge } from '@readoi/contracts';

const bridge: DesktopBridge = {
  library: {
    snapshot: () => ipcRenderer.invoke(DESKTOP_IPC.librarySnapshot),
    chooseDirectory: () => ipcRenderer.invoke(DESKTOP_IPC.chooseDirectory),
  },
  extensions: {
    list: () => ipcRenderer.invoke(DESKTOP_IPC.extensionsList),
    install: (repositoryUrl) =>
      ipcRenderer.invoke(DESKTOP_IPC.extensionsInstall, repositoryUrl),
    remove: (id) => ipcRenderer.invoke(DESKTOP_IPC.extensionsRemove, id),
    setEnabled: (id, enabled) =>
      ipcRenderer.invoke(DESKTOP_IPC.extensionsSetEnabled, id, enabled),
  },
  system: {
    platform: () => ipcRenderer.invoke(DESKTOP_IPC.systemPlatform),
  },
};

contextBridge.exposeInMainWorld('readio', bridge);
