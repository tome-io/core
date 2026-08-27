import {
  completeHandler,
  createDownloadTask,
  getExistingDownloadTasks,
  setConfig,
} from '@kesha-antonov/react-native-background-downloader';

import type {
  BackgroundDownloadTask,
  CreateBackgroundDownloadInput,
} from './background-download-engine.types';

export type { BackgroundDownloadTask } from './background-download-engine.types';

export function configureBackgroundDownloads(): void {
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
