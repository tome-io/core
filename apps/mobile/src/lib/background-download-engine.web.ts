import type {
  BackgroundDownloadTask,
  CreateBackgroundDownloadInput,
} from './background-download-engine.types';

export type { BackgroundDownloadTask } from './background-download-engine.types';

export function configureBackgroundDownloads(): void {}

export function createBackgroundDownload(
  _input: CreateBackgroundDownloadInput
): BackgroundDownloadTask {
  throw new Error('Downloading books is unavailable on web.');
}

export async function getBackgroundDownloads(): Promise<BackgroundDownloadTask[]> {
  return [];
}

export async function completeBackgroundDownload(_id: string): Promise<void> {}
