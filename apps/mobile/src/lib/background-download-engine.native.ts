import {
  completeHandler,
  createDownloadTask,
  getExistingDownloadTasks,
  setConfig,
} from '@kesha-antonov/react-native-background-downloader';
import { NativeModules } from 'react-native';

import type {
  BackgroundDownloadTask,
  CreateBackgroundDownloadInput,
} from './background-download-engine.types';

export type { BackgroundDownloadTask } from './background-download-engine.types';

function ensureEventListenerBookkeeping(): void {
  const nativeModule = NativeModules.RNBackgroundDownloader;
  if (!nativeModule) return;

  // React Native 0.86 validates these methods before subscribing. The Android
  // TurboModule still emits through RCTDeviceEventEmitter, but codegen does not
  // expose its native listener bookkeeping methods to JavaScript.
  if (typeof nativeModule.addListener !== 'function') {
    nativeModule.addListener = () => undefined;
  }
  if (typeof nativeModule.removeListeners !== 'function') {
    nativeModule.removeListeners = () => undefined;
  }
}

export function configureBackgroundDownloads(): void {
  ensureEventListenerBookkeeping();
  setConfig({
    progressInterval: 750,
    progressMinBytes: 256 * 1024,
    showNotificationsEnabled: true,
    showCompletionNotification: false,
    showCancelAction: false,
    notificationsGrouping: {
      enabled: true,
      mode: 'individual',
      texts: {
        downloadTitle: 'Tomeio download',
        downloadStarting: 'Starting download…',
        downloadProgress: 'Downloading… {progress}%',
        downloadPaused: 'Download paused',
        downloadFinished: 'Download complete',
        groupTitle: 'Tomeio downloads',
        groupText: '{count} downloads in progress',
      },
    },
    iosDataProtection: 'completeUntilFirstUserAuthentication',
  });
}

export function createBackgroundDownload(
  input: CreateBackgroundDownloadInput
): BackgroundDownloadTask {
  return createDownloadTask({
    ...input,
    metadata: {
      ...input.metadata,
      notificationTitle: input.notificationTitle,
    },
    groupId: 'tomeio-books',
    groupName: 'Tomeio downloads',
  });
}

export async function getBackgroundDownloads(): Promise<BackgroundDownloadTask[]> {
  return getExistingDownloadTasks();
}

export async function completeBackgroundDownload(id: string): Promise<void> {
  await completeHandler(id);
}
