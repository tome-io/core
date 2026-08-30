import type {
  BackgroundDownloadTask,
  CreateBackgroundDownloadInput,
} from './background-download-engine.types';

export type { BackgroundDownloadTask } from './background-download-engine.types';

export declare function configureBackgroundDownloads(): void;
export declare function createBackgroundDownload(
  input: CreateBackgroundDownloadInput
): BackgroundDownloadTask;
export declare function getBackgroundDownloads(): Promise<BackgroundDownloadTask[]>;
export declare function completeBackgroundDownload(id: string): Promise<void>;
