import * as FileSystem from 'expo-file-system/legacy';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { PermissionsAndroid, Platform } from 'react-native';

import { useLibraryActions, useLibraryCatalog } from '@/context/library-context';
import {
  completeBackgroundDownload,
  configureBackgroundDownloads,
  createBackgroundDownload,
  getBackgroundDownloads,
  type BackgroundDownloadTask,
} from '@/lib/background-download-engine';
import { bookMimeType, isExternalFolderLocation, isSafLocation } from '@/lib/download';
import type { LibraryBook } from '@/lib/library';
import { copyNativeFileToDirectory } from '../../modules/expo-progress-folder/src';

export type BookDownloadStatus = 'downloading' | 'finalizing' | 'done' | 'error';

export interface BookDownloadJob {
  id: string;
  requestKey: string;
  status: BookDownloadStatus;
  bytesWritten: number;
  totalBytes: number;
  uri?: string;
  error?: string;
}

interface StartBookDownloadInput {
  requestKey: string;
  url: string;
  filename: string;
  headers: Record<string, string>;
  destinationDirectoryUri: string | null;
  book: LibraryBook;
}

interface DownloadMetadata {
  kind: 'tomeio-book';
  requestKey: string;
  filename: string;
  destinationDirectoryUri: string | null;
  finalPath: string;
  sourceHost?: string;
  book: LibraryBook;
}

interface DownloadContextValue {
  jobs: Record<string, BookDownloadJob>;
  startBookDownload(input: StartBookDownloadInput): Promise<void>;
}

const DownloadContext = createContext<DownloadContextValue | null>(null);

function fileUri(path: string): string {
  return path.startsWith('file:') || path.startsWith('content:') || path.startsWith('tomeio-folder:')
    ? path
    : `file://${path}`;
}

function nativeFilePath(uri: string): string {
  return uri.replace(/^file:\/\//, '');
}

async function removeStagedFiles(...locations: (string | undefined)[]): Promise<void> {
  const uris = [...new Set(locations.filter((value): value is string => !!value).map(fileUri))];
  for (const uri of uris) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  }
}

function metadataFor(task: BackgroundDownloadTask): DownloadMetadata | null {
  const metadata = task.metadata as Partial<DownloadMetadata>;
  if (
    metadata.kind !== 'tomeio-book' ||
    typeof metadata.requestKey !== 'string' ||
    typeof metadata.filename !== 'string' ||
    typeof metadata.finalPath !== 'string' ||
    !metadata.book ||
    typeof metadata.book.key !== 'string'
  ) {
    return null;
  }
  return metadata as DownloadMetadata;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function DownloadProvider({ children }: { children: React.ReactNode }) {
  const { recordDownload } = useLibraryActions();
  const { ready: libraryReady } = useLibraryCatalog();
  const [jobs, setJobs] = useState<Record<string, BookDownloadJob>>({});
  const jobsRef = useRef(jobs);
  const tasksRef = useRef(new Map<string, BackgroundDownloadTask>());
  const finalizingRef = useRef(new Set<string>());
  const reconnectRef = useRef<Promise<void>>(Promise.resolve());
  const reconnectErrorRef = useRef<unknown>(null);
  const initializedRef = useRef(false);

  const updateJob = useCallback(
    (requestKey: string, update: (current?: BookDownloadJob) => BookDownloadJob) => {
      setJobs((current) => {
        const next = { ...current, [requestKey]: update(current[requestKey]) };
        jobsRef.current = next;
        return next;
      });
    },
    []
  );

  const finalizeTask = useCallback(
    async (task: BackgroundDownloadTask, metadata: DownloadMetadata, location?: string) => {
      if (finalizingRef.current.has(task.id)) return;
      finalizingRef.current.add(task.id);
      updateJob(metadata.requestKey, (current) => ({
        id: task.id,
        requestKey: metadata.requestKey,
        status: 'finalizing',
        bytesWritten: task.bytesDownloaded || current?.bytesWritten || 0,
        totalBytes: task.bytesTotal || current?.totalBytes || 0,
      }));

      const stagedUri = fileUri(location ?? task.destination ?? '');
      try {
        if (!location && !task.destination) {
          throw new Error('The completed background download has no saved file location.');
        }

        let finalUri: string;
        if (isExternalFolderLocation(metadata.destinationDirectoryUri)) {
          if (isSafLocation(metadata.destinationDirectoryUri) && Platform.OS !== 'android') {
            throw new Error('Android folder access is unavailable on this platform.');
          }
          finalUri = await copyNativeFileToDirectory(
            stagedUri,
            metadata.destinationDirectoryUri!,
            metadata.filename,
            bookMimeType(metadata.filename)
          );
        } else {
          finalUri = fileUri(metadata.finalPath);
          const stagedInfo = await FileSystem.getInfoAsync(stagedUri);
          if (stagedInfo.exists) {
            const finalDirectory = metadata.finalPath.slice(
              0,
              metadata.finalPath.lastIndexOf('/')
            );
            await FileSystem.makeDirectoryAsync(fileUri(finalDirectory), {
              intermediates: true,
            });
            await FileSystem.deleteAsync(finalUri, { idempotent: true });
            await FileSystem.moveAsync({ from: stagedUri, to: finalUri });
          } else {
            const finalInfo = await FileSystem.getInfoAsync(finalUri);
            if (!finalInfo.exists) {
              throw new Error('The completed background download could not be found.');
            }
          }
        }

        await completeBackgroundDownload(task.id);
        await removeStagedFiles(
          ...[location, task.destination].filter(
            (candidate) => candidate && fileUri(candidate) !== finalUri
          )
        );
        await recordDownload(metadata.book, finalUri);
        tasksRef.current.delete(task.id);
        updateJob(metadata.requestKey, () => ({
          id: task.id,
          requestKey: metadata.requestKey,
          status: 'done',
          bytesWritten: task.bytesDownloaded,
          totalBytes: task.bytesTotal,
          uri: finalUri,
        }));
      } catch (cause) {
        updateJob(metadata.requestKey, (current) => ({
          id: task.id,
          requestKey: metadata.requestKey,
          status: 'error',
          bytesWritten: current?.bytesWritten ?? task.bytesDownloaded,
          totalBytes: current?.totalBytes ?? task.bytesTotal,
          error: errorMessage(cause),
        }));
      } finally {
        finalizingRef.current.delete(task.id);
      }
    },
    [recordDownload, updateJob]
  );

  const attachTask = useCallback(
    (task: BackgroundDownloadTask, metadata: DownloadMetadata) => {
      tasksRef.current.set(task.id, task);
      updateJob(metadata.requestKey, () => ({
        id: task.id,
        requestKey: metadata.requestKey,
        status: task.state === 'DONE' ? 'finalizing' : 'downloading',
        bytesWritten: task.bytesDownloaded,
        totalBytes: task.bytesTotal,
      }));
      task
        .begin(({ expectedBytes }) => {
          updateJob(metadata.requestKey, (current) => ({
            id: task.id,
            requestKey: metadata.requestKey,
            status: 'downloading',
            bytesWritten: current?.bytesWritten ?? 0,
            totalBytes: expectedBytes,
          }));
        })
        .progress(({ bytesDownloaded, bytesTotal }) => {
          updateJob(metadata.requestKey, () => ({
            id: task.id,
            requestKey: metadata.requestKey,
            status: 'downloading',
            bytesWritten: bytesDownloaded,
            totalBytes: bytesTotal,
          }));
        })
        .done(({ location, bytesDownloaded, bytesTotal }) => {
          task.bytesDownloaded = bytesDownloaded;
          task.bytesTotal = bytesTotal;
          void finalizeTask(task, metadata, location);
        })
        .error(({ error, errorCode }) => {
          const message =
            errorCode === -1
              ? 'Download canceled.'
              : `${error}${metadata.sourceHost ? ` (${metadata.sourceHost})` : ''}`;
          console.error('[downloads] Background download failed:', {
            taskId: task.id,
            sourceHost: metadata.sourceHost,
            errorCode,
            error,
            bytesDownloaded: task.bytesDownloaded,
            bytesTotal: task.bytesTotal,
          });
          updateJob(metadata.requestKey, () => ({
            id: task.id,
            requestKey: metadata.requestKey,
            status: 'error',
            bytesWritten: task.bytesDownloaded,
            totalBytes: task.bytesTotal,
            error: message,
          }));
          void (async () => {
            if (task.destination) {
              await FileSystem.deleteAsync(fileUri(task.destination), {
                idempotent: true,
              }).catch((cause) => {
                console.warn('[downloads] Could not remove the failed download:', cause);
              });
            }
            await completeBackgroundDownload(task.id);
            tasksRef.current.delete(task.id);
          })().catch((cause) => {
            console.error('[downloads] Could not close the failed background task:', cause);
          });
        });
    },
    [finalizeTask, updateJob]
  );

  useEffect(() => {
    if (!libraryReady || initializedRef.current) return;
    initializedRef.current = true;
    configureBackgroundDownloads();
    reconnectRef.current = getBackgroundDownloads()
      .then(async (tasks) => {
        for (const task of tasks) {
          const metadata = metadataFor(task);
          if (!metadata) continue;
          attachTask(task, metadata);
          if (task.state === 'DONE') await finalizeTask(task, metadata, task.destination);
          else if (task.state === 'PAUSED') await task.resume();
          else if (task.state === 'FAILED' || task.state === 'STOPPED') {
            updateJob(metadata.requestKey, () => ({
              id: task.id,
              requestKey: metadata.requestKey,
              status: 'error',
              bytesWritten: task.bytesDownloaded,
              totalBytes: task.bytesTotal,
              error: 'The background download stopped before it completed.',
            }));
            await completeBackgroundDownload(task.id);
            tasksRef.current.delete(task.id);
          }
        }
      })
      .catch((cause) => {
        reconnectErrorRef.current = cause;
        console.error('[downloads] Could not reconnect to background downloads:', cause);
      });
  }, [attachTask, finalizeTask, libraryReady, updateJob]);

  const startBookDownload = useCallback(
    async (input: StartBookDownloadInput) => {
      if (!libraryReady) throw new Error('The library is still loading. Try again in a moment.');
      await reconnectRef.current;
      if (reconnectErrorRef.current) {
        throw new Error(
          `Background downloads could not be restored: ${errorMessage(reconnectErrorRef.current)}`
        );
      }
      const current = jobsRef.current[input.requestKey];
      if (current?.status === 'downloading' || current?.status === 'finalizing') return;
      if (current?.status === 'error') {
        const existingTask = tasksRef.current.get(current.id);
        const existingMetadata = existingTask ? metadataFor(existingTask) : null;
        if (existingTask?.state === 'DONE' && existingMetadata) {
          await finalizeTask(existingTask, existingMetadata, existingTask.destination);
          return;
        }
      }

      if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
        ).catch((cause) => {
          console.warn('[downloads] Notification permission could not be requested:', cause);
        });
      }
      if (Platform.OS === 'web') throw new Error('Downloading books is unavailable on web.');

      if (!FileSystem.cacheDirectory || !FileSystem.documentDirectory) {
        throw new Error('Tomeio storage is unavailable on this device.');
      }

      const id = `book-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const stagingDirectory = nativeFilePath(
        `${FileSystem.cacheDirectory}tomeio-download-staging`
      );
      const destination = `${stagingDirectory}/${id}-${input.filename}`;
      const finalPath = nativeFilePath(
        `${FileSystem.documentDirectory}downloads/${input.filename}`
      );
      await FileSystem.makeDirectoryAsync(fileUri(stagingDirectory), { intermediates: true });
      await FileSystem.deleteAsync(fileUri(destination), { idempotent: true });

      const metadata: DownloadMetadata = {
        kind: 'tomeio-book',
        requestKey: input.requestKey,
        filename: input.filename,
        destinationDirectoryUri: input.destinationDirectoryUri,
        finalPath,
        sourceHost: new URL(input.url).host,
        book: input.book,
      };
      const task = createBackgroundDownload({
        id,
        url: input.url,
        destination,
        headers: input.headers,
        metadata,
        notificationTitle: input.book.title,
      });
      attachTask(task, metadata);
      task.start();
    },
    [attachTask, finalizeTask, libraryReady]
  );

  const value = useMemo(
    () => ({ jobs, startBookDownload }),
    [jobs, startBookDownload]
  );
  return <DownloadContext.Provider value={value}>{children}</DownloadContext.Provider>;
}

export function useDownloads(): DownloadContextValue {
  const value = useContext(DownloadContext);
  if (!value) throw new Error('useDownloads must be used inside DownloadProvider.');
  return value;
}
