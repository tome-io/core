import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { AppState } from 'react-native';

import { useSettings } from '@/context/settings-context';
import { bookIdentity } from '@/lib/book-metadata';
import { isFolderPickerActive } from '@/lib/folder-picker-lock';
import {
  EMPTY_LIBRARY,
  loadLibrary,
  saveLibrary,
  type LibraryBook,
  type LibraryState,
} from '@/lib/library';
import {
  clearMoonReaderCatalog,
  deleteLocalCatalogBook,
  invalidateCatalogMetadata,
  loadLocalCatalog,
  loadMoonReaderCatalog,
  markCatalogBookRead,
} from '@/lib/library-db';
import { enrichIndexedLocalLibrary, indexLocalLibrary } from '@/lib/library-sync';
import {
  enrichIndexedMoonReaderCatalog,
  indexMoonReaderCatalog,
} from '@/lib/moon-reader-sync';
import { synchronizeProgressFolder } from '@/lib/progress-sync';

interface LibraryContextValue extends LibraryState {
  ready: boolean;
  scanning: boolean;
  cloudSyncing: boolean;
  cloudLastSyncedAt: number | null;
  error: string | null;
  warning: string | null;
  dismissWarning: () => void;
  showWarning: (message: string) => void;
  refreshLocalBooks: () => Promise<void>;
  syncCloudProgress: () => Promise<void>;
  refreshBookMetadata: (book: LibraryBook) => Promise<void>;
  markAsRead: (book: LibraryBook) => Promise<void>;
  deleteLocalBook: (book: LibraryBook) => Promise<void>;
  isOnReadingList: (key: string) => boolean;
  toggleReadingList: (book: LibraryBook) => Promise<boolean>;
  recordDownload: (book: LibraryBook, fileUri: string) => Promise<void>;
}

const LibraryContext = createContext<LibraryContextValue>({
  ...EMPTY_LIBRARY,
  ready: false,
  scanning: false,
  cloudSyncing: false,
  cloudLastSyncedAt: null,
  error: null,
  warning: null,
  dismissWarning: () => {},
  showWarning: () => {},
  refreshLocalBooks: async () => {},
  syncCloudProgress: async () => {},
  refreshBookMetadata: async () => {},
  markAsRead: async () => {},
  deleteLocalBook: async () => {},
  isOnReadingList: () => false,
  toggleReadingList: async () => false,
  recordDownload: async () => {},
});

async function deleteSourceFile(uri: string): Promise<void> {
  if (uri.startsWith('content:')) {
    throw new Error(
      'Deleting files from a selected Android folder is disabled until it can be done safely. Delete this file with the device file manager, then refresh Library.'
    );
  }
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) return;
  await FileSystem.deleteAsync(uri);
}

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const { settings, ready: settingsReady } = useSettings();
  const [state, setState] = useState<LibraryState>(EMPTY_LIBRARY);
  const [localBooks, setLocalBooks] = useState<LibraryBook[]>([]);
  const [moonReaderBooks, setMoonReaderBooks] = useState<LibraryBook[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [cloudLastSyncedAt, setCloudLastSyncedAt] = useState<number | null>(null);
  const stateRef = useRef(state);
  const mutationQueue = useRef<Promise<void>>(Promise.resolve());
  const scanGeneration = useRef(0);
  const lastScanKey = useRef<string | null>(null);
  const pendingScan = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const pendingCloudSync = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let active = true;
    loadLibrary()
      .then((stored) => {
        if (!active) return;
        stateRef.current = stored;
        setState(stored);
      })
      .catch((err) => active && setError(err.message || String(err)))
      .finally(() => active && setReady(true));
    return () => {
      active = false;
    };
  }, []);

  const syncCloudProgress = useCallback((): Promise<void> => {
    if (!settingsReady || !settings.progressSyncLocation) return Promise.resolve();
    if (pendingCloudSync.current) return pendingCloudSync.current;

    setCloudSyncing(true);
    const localKey = settings.localLibraryLocation ?? '__app_downloads__';
    const moonReaderKey = settings.moonReaderBackupLocation ?? '__no_moonreader_backup__';
    let promise: Promise<void>;
    promise = synchronizeProgressFolder(settings.progressSyncLocation)
      .then(async (result) => {
        const [syncedLocal, syncedMoonReader] = await Promise.all([
          loadLocalCatalog(localKey),
          settings.moonReaderBackupLocation
            ? loadMoonReaderCatalog(moonReaderKey)
            : Promise.resolve([]),
        ]);
        setLocalBooks(syncedLocal);
        setMoonReaderBooks(syncedMoonReader);
        setCloudLastSyncedAt(result.syncedAt);
      })
      .finally(() => {
        setCloudSyncing(false);
        if (pendingCloudSync.current === promise) pendingCloudSync.current = null;
      });
    pendingCloudSync.current = promise;
    return promise;
  }, [
    settings.localLibraryLocation,
    settings.moonReaderBackupLocation,
    settings.progressSyncLocation,
    settingsReady,
  ]);

  const refreshLocalBooks = useCallback((): Promise<void> => {
    if (!settingsReady) return Promise.resolve();

    const localKey = settings.localLibraryLocation ?? '__app_downloads__';
    const moonReaderLocation = settings.moonReaderBackupLocation;
    const moonReaderKey = moonReaderLocation ?? '__no_moonreader_backup__';
    const progressSyncKey = settings.progressSyncLocation ?? '__no_progress_sync__';
    const key = `${localKey}|${moonReaderKey}|${progressSyncKey}`;
    if (pendingScan.current?.key === key) return pendingScan.current.promise;

    const generation = ++scanGeneration.current;
    const directoryChanged = lastScanKey.current !== key;
    lastScanKey.current = key;
    setScanning(true);
    setSyncError(null);
    setWarning(null);

    let promise: Promise<void>;
    promise = (async () => {
      if (!moonReaderLocation) await clearMoonReaderCatalog();
      const [cachedLocal, cachedMoonReader] = await Promise.all([
        loadLocalCatalog(localKey),
        moonReaderLocation ? loadMoonReaderCatalog(moonReaderKey) : Promise.resolve([]),
      ]);
      if (scanGeneration.current !== generation) return;
      if (directoryChanged) {
        setLocalBooks(cachedLocal);
        setMoonReaderBooks(cachedMoonReader);
      }

      const warnings: string[] = [];
      let local = { books: cachedLocal, warnings: [] as string[] };
      try {
        local = await indexLocalLibrary({
          directoryKey: localKey,
          directoryUri: settings.localLibraryLocation,
        });
      } catch (err: any) {
        warnings.push(`Local book indexing failed: ${err.message || String(err)}`);
      }
      if (scanGeneration.current !== generation) return;
      setLocalBooks(local.books);

      let moonReader = { books: cachedMoonReader, warnings: [] as string[] };
      if (moonReaderLocation) {
        try {
          moonReader = await indexMoonReaderCatalog(
            moonReaderKey,
            moonReaderLocation,
            local.books
          );
        } catch (err: any) {
          warnings.push(`Moon+ Reader synchronization failed: ${err.message || String(err)}`);
        }
      }
      if (scanGeneration.current !== generation) return;
      setMoonReaderBooks(moonReader.books);
      setScanning(false);

      let enrichmentLocalBooks = local.books;
      let enrichmentMoonReaderBooks = moonReader.books;

      if (settings.progressSyncLocation) {
        try {
          await syncCloudProgress();
          [enrichmentLocalBooks, enrichmentMoonReaderBooks] = await Promise.all([
            loadLocalCatalog(localKey),
            moonReaderLocation
              ? loadMoonReaderCatalog(moonReaderKey)
              : Promise.resolve([]),
          ]);
        } catch (err: any) {
          warnings.push(`Progress folder sync failed: ${err.message || String(err)}`);
        }
      }

      const moonLocalByKey = new Map(
        enrichmentMoonReaderBooks
          .filter((book) => !!book.local)
          .map((book) => [book.key, book] as const)
      );
      const localWithMoonReaderMetadata = enrichmentLocalBooks.map(
        (book) => moonLocalByKey.get(book.key) ?? book
      );

      const [enrichedLocal, enrichedMoonReader] = await Promise.all([
        enrichIndexedLocalLibrary({
          directoryKey: localKey,
          books: localWithMoonReaderMetadata,
          onBookUpdated: (enriched) => {
            if (scanGeneration.current !== generation) return;
            setLocalBooks((current) =>
              current.map((book) => (book.key === enriched.key ? enriched : book))
            );
          },
        }).catch((err: any) => ({
          books: localWithMoonReaderMetadata,
          warnings: [`Local metadata enrichment failed: ${err.message || String(err)}`],
        })),
        enrichIndexedMoonReaderCatalog(enrichmentMoonReaderBooks, (enriched) => {
          if (scanGeneration.current !== generation) return;
          setMoonReaderBooks((current) =>
            current.map((book) => (book.key === enriched.key ? enriched : book))
          );
        }).catch((err: any) => ({
          books: enrichmentMoonReaderBooks,
          warnings: [`Moon+ Reader metadata enrichment failed: ${err.message || String(err)}`],
        })),
      ]);
      if (scanGeneration.current !== generation) return;
      setLocalBooks(enrichedLocal.books);
      setMoonReaderBooks(enrichedMoonReader.books);
      warnings.push(
        ...local.warnings,
        ...moonReader.warnings,
        ...enrichedLocal.warnings,
        ...enrichedMoonReader.warnings
      );
      setWarning(warnings.length ? warnings.join(' ') : null);
    })()
      .catch((err) => {
        if (scanGeneration.current === generation) {
          setSyncError(`Library synchronization failed: ${err.message || String(err)}`);
        }
      })
      .finally(() => {
        if (scanGeneration.current === generation) setScanning(false);
        if (pendingScan.current?.promise === promise) pendingScan.current = null;
      });

    pendingScan.current = { key, promise };
    return promise;
  }, [
    settings.localLibraryLocation,
    settings.moonReaderBackupLocation,
    settings.progressSyncLocation,
    settingsReady,
    syncCloudProgress,
  ]);

  useEffect(() => {
    void refreshLocalBooks();
  }, [refreshLocalBooks]);

  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const returningToApp = /inactive|background/.test(previousState) && nextState === 'active';
      previousState = nextState;
      if (returningToApp && !isFolderPickerActive()) void refreshLocalBooks();
    });
    return () => subscription.remove();
  }, [refreshLocalBooks]);

  useEffect(
    () => () => {
      scanGeneration.current += 1;
    },
    []
  );

  const commit = useCallback(
    (update: (current: LibraryState) => LibraryState): Promise<void> => {
      const operation = mutationQueue.current.then(async () => {
        const next = update(stateRef.current);
        await saveLibrary(next);
        stateRef.current = next;
        setState(next);
        setError(null);
      });
      mutationQueue.current = operation.catch(() => {});
      return operation.catch((err) => {
        setError(err.message || String(err));
        throw err;
      });
    },
    []
  );

  const toggleReadingList = useCallback(
    async (book: LibraryBook) => {
      const exists = stateRef.current.readingList.some((item) => item.key === book.key);
      await commit((current) => ({
        ...current,
        readingList: exists
          ? current.readingList.filter((item) => item.key !== book.key)
          : [book, ...current.readingList],
      }));
      return !exists;
    },
    [commit]
  );

  const recordDownload = useCallback(
    async (book: LibraryBook, fileUri: string) => {
      await commit((current) => {
        const downloaded = {
          ...book,
          fileUri,
          downloadedAt: Date.now(),
        };
        return {
          ...current,
          downloaded: [
            downloaded,
            ...current.downloaded.filter((item) => item.key !== downloaded.key),
          ],
        };
      });
      await refreshLocalBooks();
    },
    [commit, refreshLocalBooks]
  );

  const deleteLocalBook = useCallback(
    async (book: LibraryBook) => {
      if (!book.local?.uri) throw new Error('This library item has no local source file.');
      try {
        await deleteSourceFile(book.local.uri);
      } catch (err: any) {
        const message = `Could not delete ${book.local.filename}: ${err.message || String(err)}`;
        setError(message);
        throw new Error(message);
      }

      setLocalBooks((current) => current.filter((item) => item.key !== book.key));
      try {
        await deleteLocalCatalogBook(book.local.uri);
        await commit((current) => ({
          downloaded: current.downloaded.filter(
            (item) => item.key !== book.key && item.fileUri !== book.local?.uri
          ),
          readingList: current.readingList.filter((item) => item.key !== book.key),
        }));
      } catch (err: any) {
        const message = `The file was deleted, but Library state could not be updated: ${err.message || String(err)}`;
        setError(message);
        throw new Error(message);
      }
    },
    [commit]
  );

  const isOnReadingList = useCallback(
    (key: string) => state.readingList.some((item) => item.key === key),
    [state.readingList]
  );
  const dismissWarning = useCallback(() => setWarning(null), []);
  const showWarning = useCallback((message: string) => setWarning(message), []);

  const markAsRead = useCallback(
    async (book: LibraryBook) => {
      await markCatalogBookRead(book.key);
      const applyRead = (item: LibraryBook) =>
        item.key === book.key ? { ...item, isRead: true, progress: 100 } : item;
      setLocalBooks((current) => current.map(applyRead));
      setMoonReaderBooks((current) => current.map(applyRead));
      await commit((current) => ({
        downloaded: current.downloaded.map(applyRead),
        readingList: current.readingList.map(applyRead),
      }));
      if (settings.progressSyncLocation) await syncCloudProgress();
    },
    [commit, settings.progressSyncLocation, syncCloudProgress]
  );

  const refreshBookMetadata = useCallback(
    async (book: LibraryBook) => {
      if (pendingScan.current) await pendingScan.current.promise;
      await invalidateCatalogMetadata(book.key);
      const invalidRemoteCover =
        !book.local || book.cover?.includes('covers.openlibrary.org/b/isbn/');
      const invalidated: LibraryBook = {
        ...book,
        cover: invalidRemoteCover ? '' : book.cover,
        discovery: undefined,
        rating: undefined,
        ratingsCount: undefined,
        metadataPending: true,
        metadataUpdatedAt: undefined,
        metadataVersion: undefined,
      };
      setWarning(null);

      if (invalidated.local) {
        const directoryKey = settings.localLibraryLocation ?? '__app_downloads__';
        const result = await enrichIndexedLocalLibrary({
          directoryKey,
          books: [invalidated],
        });
        const refreshed = result.books[0];
        setLocalBooks((current) =>
          current.map((item) => (item.key === refreshed.key ? refreshed : item))
        );
        setWarning(result.warnings.length ? result.warnings.join(' ') : null);
        return;
      }

      const result = await enrichIndexedMoonReaderCatalog([invalidated]);
      const refreshed = result.books[0];
      setMoonReaderBooks((current) =>
        current.map((item) => (item.key === refreshed.key ? refreshed : item))
      );
      setWarning(result.warnings.length ? result.warnings.join(' ') : null);
    },
    [settings.localLibraryLocation]
  );

  const downloaded = useMemo(() => {
    const catalog = new Map<string, LibraryBook>();
    const localByIdentity = new Map<string, LibraryBook>();
    for (const book of localBooks) {
      catalog.set(book.key, book);
      localByIdentity.set(
        bookIdentity(book.title, book.author, book.format || book.local?.format || ''),
        book
      );
    }
    for (const moonBook of moonReaderBooks) {
      const localBook =
        catalog.get(moonBook.key) ??
        localByIdentity.get(
          bookIdentity(
            moonBook.title,
            moonBook.author,
            moonBook.format || moonBook.local?.format || ''
          )
        );
      const catalogKey = localBook?.key ?? moonBook.key;
      catalog.set(
        catalogKey,
        localBook
          ? {
              ...moonBook,
              ...localBook,
              progress: moonBook.progress,
              isRead: moonBook.isRead,
              readingTimeMs: moonBook.readingTimeMs,
              wordsRead: moonBook.wordsRead,
              lastReadAt: moonBook.lastReadAt,
              moonReader: { ...localBook.moonReader, ...moonBook.moonReader },
            }
          : moonBook
      );
      if (catalogKey !== moonBook.key) catalog.delete(moonBook.key);
    }
    const seen = new Set<string>();
    const seenIdentities = new Set(
      [...catalog.values()].map((book) =>
        bookIdentity(book.title, book.author, book.format || book.local?.format || '')
      )
    );
    // The scanner entry is live and gains embedded/MoonReader metadata as it is
    // enriched. Prefer it over the immutable download record for the same URI.
    return [...catalog.values(), ...state.downloaded].filter((book, index) => {
      const rawKey = book.fileUri || book.key;
      let key = rawKey;
      try {
        key = decodeURIComponent(rawKey);
      } catch {
        // Document providers are allowed to return opaque, non-decodable URIs.
      }
      if (seen.has(key)) return false;
      if (index >= catalog.size) {
        const identity = bookIdentity(
          book.title,
          book.author,
          book.format || book.local?.format || ''
        );
        if (seenIdentities.has(identity)) return false;
        seenIdentities.add(identity);
      }
      seen.add(key);
      return true;
    });
  }, [localBooks, moonReaderBooks, state.downloaded]);

  const readingList = useMemo(() => {
    const libraryByKey = new Map(downloaded.map((book) => [book.key, book]));
    return state.readingList.map((book) => {
      const enriched = libraryByKey.get(book.key);
      return enriched ? { ...enriched, addedAt: book.addedAt } : book;
    });
  }, [downloaded, state.readingList]);

  return (
    <LibraryContext.Provider
      value={{
        ...state,
        downloaded,
        readingList,
        ready,
        scanning,
        cloudSyncing,
        cloudLastSyncedAt,
        error: error || syncError,
        warning,
        dismissWarning,
        showWarning,
        refreshLocalBooks,
        syncCloudProgress,
        refreshBookMetadata,
        markAsRead,
        deleteLocalBook,
        isOnReadingList,
        toggleReadingList,
        recordDownload,
      }}
    >
      {children}
    </LibraryContext.Provider>
  );
}

export function useLibrary(): LibraryContextValue {
  return useContext(LibraryContext);
}
