export interface BackgroundDownloadTask {
  id: string;
  state: 'PENDING' | 'DOWNLOADING' | 'PAUSED' | 'DONE' | 'FAILED' | 'STOPPED';
  metadata: Record<string, unknown>;
  destination?: string;
  bytesDownloaded: number;
  bytesTotal: number;
  begin(handler: (event: { expectedBytes: number }) => void): BackgroundDownloadTask;
  progress(
    handler: (event: { bytesDownloaded: number; bytesTotal: number }) => void
  ): BackgroundDownloadTask;
  done(
    handler: (event: {
      location: string;
      bytesDownloaded: number;
      bytesTotal: number;
    }) => void
  ): BackgroundDownloadTask;
  error(
    handler: (event: { error: string; errorCode: number }) => void
  ): BackgroundDownloadTask;
  start(): void;
  resume(): Promise<void>;
}

export interface CreateBackgroundDownloadInput {
  id: string;
  url: string;
  destination: string;
  headers: Record<string, string>;
  metadata: Record<string, unknown>;
  notificationTitle: string;
}
