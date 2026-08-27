import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
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
import { reconcileLibraryStateWithLocalCatalog } from '@/lib/library-state';
import {
  clearMoonReaderCatalog,
  deleteLocalCatalogBook,
  invalidateCatalogMetadata,
  loadLocalCatalog,
  loadMoonReaderCatalog,
  loadProgressSyncCatalog,
  markCatalogBookRead,
  removeProgressSyncBook,
} from '@/lib/library-db';
import { enrichIndexedLocalLibrary, indexLocalLibrary } from '@/lib/library-sync';
import {
  enrichIndexedMoonReaderCatalog,
  indexMoonReaderCatalog,
} from '@/lib/moon-reader-sync';
import { synchronizeProgressFolder } from '@/lib/progress-sync';
import { deleteNativeProgressFolderFile } from '../../modules/expo-progress-folder/src';

interface LibraryCatalogValue {
  downloaded: LibraryBook[];
  ready: boolean;
}

interface LibraryReadingListValue {
  readingList: LibraryBook[];
  ready: boolean;
}

interface LibraryUiStatusValue {
  scanning: boolean;
  error: string | null;
  warning: string | null;
  dismissWarning: () => void;
  showWarning: (message: string) => void;
}

interface LibrarySyncStatusValue {
  cloudSyncing: boolean;
  cloudLastSyncedAt: number | null;
}

interface LibraryActionsValue {
  refreshLocalBooks: () => Promise<void>;
  syncCloudProgress: () => Promise<void>;
  refreshBookMetadata: (book: LibraryBook) => Promise<void>;
  markAsRead: (book: LibraryBook) => Promise<void>;
  removeLocalFile: (book: LibraryBook) => Promise<void>;
  removeLibraryBook: (book: LibraryBook) => Promise<void>;
  isOnReadingList: (key: string) => boolean;
  toggleReadingList: (book: LibraryBook) => Promise<boolean>;
  recordDownload: (book: LibraryBook, fileUri: string) => Promise<void>;
}

interface LibraryContextValue
  extends LibraryCatalogValue,
    LibraryReadingListValue,
    LibraryUiStatusValue,
    LibrarySyncStatusValue,
    LibraryActionsValue {}

function createBookBatcher(setBooks: Dispatch<SetStateAction<LibraryBook[]>>) {
  let pending = new Map<string, LibraryBook>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    if (pending.size === 0) return;
    const updates = pending;
    pending = new Map();
    setBooks((current) => {
      let changed = false;
      const next = current.map((item) => {
        const updated = updates.get(item.key);
        if (!updated || updated === item) return item;
        changed = true;
        return updated;
      });
      return changed ? next : current;
    });
  };

  return {
    update(book: LibraryBook) {
      pending.set(book.key, book);
      if (!timer) timer = setTimeout(flush, 120);
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending = new Map();
    },
  };
}

function useBookBatcher(setBooks: Dispatch<SetStateAction<LibraryBook[]>>) {
  const [batcher] = useState(() => createBookBatcher(setBooks));
  return batcher;
}

const LibraryCatalogContext = createContext<LibraryCatalogValue>({
  downloaded: [],
  ready: false,
});
const LibraryReadingListContext = createContext<LibraryReadingListValue>({
  readingList: [],
  ready: false,
});
const LibraryUiStatusContext = createContext<LibraryUiStatusValue>({
  scanning: false,
  error: null,
  warning: null,
  dismissWarning: () => {},
  showWarning: () => {},
});
const LibrarySyncStatusContext = createContext<LibrarySyncStatusValue>({
  cloudSyncing: false,
  cloudLastSyncedAt: null,
});
const LibraryActionsContext = createContext<LibraryActionsValue>({
  refreshLocalBooks: async () => {},
  syncCloudProgress: async () => {},
  refreshBookMetadata: async () => {},
  markAsRead: async () => {},
  removeLocalFile: async () => {},
  removeLibraryBook: async () => {},
  isOnReadingList: () => false,
  toggleReadingList: async () => false,
  recordDownload: async () => {},
});

async function deleteSourceFile(uri: string): Promise<void> {
  if (uri.startsWith('content:')) {
    await deleteNativeProgressFolderFile(uri);
    return;
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
  const [progressSyncBooks, setProgressSyncBooks] = useState<LibraryBook[]>([]);
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
  const localBookBatcher = useBookBatcher(setLocalBooks);
  const moonReaderBookBatcher = useBookBatcher(setMoonReaderBooks);
  const progressSyncBookBatcher = useBookBatcher(setProgressSyncBooks);

  const commit = useCallback(
    (update: (current: LibraryState) => LibraryState): Promise<void> => {
      const operation = mutationQueue.current.then(async () => {
        const next = update(stateRef.current);
        if (next === stateRef.current) return;
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
        const [syncedLocal, syncedMoonReader, syncedProgressBooks] = await Promise.all([
          loadLocalCatalog(localKey),
          settings.moonReaderBackupLocation
            ? loadMoonReaderCatalog(moonReaderKey)
            : Promise.resolve([]),
          loadProgressSyncCatalog(),
        ]);
        localBookBatcher.cancel();
        moonReaderBookBatcher.cancel();
        progressSyncBookBatcher.cancel();
        setLocalBooks(syncedLocal);
        setMoonReaderBooks(syncedMoonReader);
        setProgressSyncBooks(syncedProgressBooks);
        setCloudLastSyncedAt(result.syncedAt);
        setSyncError(null);
        console.info(
          `[progress-sync] Imported ${result.importedRecords} updates; ${result.recordCount} records available.`
        );
      })
      .catch((cause) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        setSyncError(`Progress folder sync failed: ${message}`);
        console.error('[progress-sync] Synchronization failed:', cause);
        throw cause;
      })
      .finally(() => {
        setCloudSyncing(false);
        if (pendingCloudSync.current === promise) pendingCloudSync.current = null;
      });
    pendingCloudSync.current = promise;
    return promise;
  }, [
    localBookBatcher,
    moonReaderBookBatcher,
    progressSyncBookBatcher,
    settings.localLibraryLocation,
    settings.moonReaderBackupLocation,
    settings.progressSyncLocation,
    settingsReady,
  ]);

  const refreshLocalBooks = useCallback((): Promise<void> => {
    if (!settingsReady || !ready) return Promise.resolve();

    const localKey = settings.localLibraryLocation ?? '__app_downloads__';
    const moonReaderLocation = settings.moonReaderBackupLocation;
    const moonReaderKey = moonReaderLocation ?? '__no_moonreader_backup__';
    const progressSyncKey = settings.progressSyncLocation ?? '__no_progress_sync__';
    const key = `${localKey}|${moonReaderKey}|${progressSyncKey}`;
    if (pendingScan.current?.key === key) return pendingScan.current.promise;

    const generation = ++scanGeneration.current;
    localBookBatcher.cancel();
    moonReaderBookBatcher.cancel();
    progressSyncBookBatcher.cancel();
    const directoryChanged = lastScanKey.current !== key;
    lastScanKey.current = key;
    setScanning(true);
    setSyncError(null);
    setWarning(null);

    let promise: Promise<void>;
    promise = (async () => {
      if (!moonReaderLocation) await clearMoonReaderCatalog();
      const [cachedLocal, cachedMoonReader, cachedProgressBooks] = await Promise.all([
        loadLocalCatalog(localKey),
        moonReaderLocation ? loadMoonReaderCatalog(moonReaderKey) : Promise.resolve([]),
        loadProgressSyncCatalog(),
      ]);
      if (scanGeneration.current !== generation) return;
      if (directoryChanged) {
        setLocalBooks(cachedLocal);
        setMoonReaderBooks(cachedMoonReader);
        setProgressSyncBooks(cachedProgressBooks);
      }

      const warnings: string[] = [];
      let local = { books: cachedLocal, warnings: [] as string[] };
      let localIndexSucceeded = false;
      try {
        local = await indexLocalLibrary({
          directoryKey: localKey,
          directoryUri: settings.localLibraryLocation,
        });
        localIndexSucceeded = true;
      } catch (err: any) {
        warnings.push(`Local book indexing failed: ${err.message || String(err)}`);
      }
      if (scanGeneration.current !== generation) return;
      if (localIndexSucceeded) {
        await commit((current) =>
          reconcileLibraryStateWithLocalCatalog(current, local.books)
        );
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
      let enrichmentProgressBooks = cachedProgressBooks;

      if (settings.progressSyncLocation) {
        try {
          await syncCloudProgress();
          [enrichmentLocalBooks, enrichmentMoonReaderBooks, enrichmentProgressBooks] =
            await Promise.all([
            loadLocalCatalog(localKey),
            moonReaderLocation
              ? loadMoonReaderCatalog(moonReaderKey)
              : Promise.resolve([]),
            loadProgressSyncCatalog(),
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

      const [enrichedLocal, enrichedMoonReader, enrichedProgress] = await Promise.all([
        enrichIndexedLocalLibrary({
          directoryKey: localKey,
          books: localWithMoonReaderMetadata,
          onBookUpdated: (enriched) => {
            if (scanGeneration.current !== generation) return;
            localBookBatcher.update(enriched);
          },
        }).catch((err: any) => ({
          books: localWithMoonReaderMetadata,
          warnings: [`Local metadata enrichment failed: ${err.message || String(err)}`],
        })),
        enrichIndexedMoonReaderCatalog(enrichmentMoonReaderBooks, (enriched) => {
          if (scanGeneration.current !== generation) return;
          moonReaderBookBatcher.update(enriched);
        }).catch((err: any) => ({
          books: enrichmentMoonReaderBooks,
          warnings: [`Moon+ Reader metadata enrichment failed: ${err.message || String(err)}`],
        })),
        enrichIndexedMoonReaderCatalog(enrichmentProgressBooks, (enriched) => {
          if (scanGeneration.current !== generation) return;
          progressSyncBookBatcher.update(enriched);
        }).catch((err: any) => ({
          books: enrichmentProgressBooks,
          warnings: [`Synced library metadata enrichment failed: ${err.message || String(err)}`],
        })),
      ]);
      if (scanGeneration.current !== generation) return;
      localBookBatcher.cancel();
      moonReaderBookBatcher.cancel();
      progressSyncBookBatcher.cancel();
      setLocalBooks(enrichedLocal.books);
      setMoonReaderBooks(enrichedMoonReader.books);
      setProgressSyncBooks(enrichedProgress.books);
      warnings.push(
        ...local.warnings,
        ...moonReader.warnings,
        ...enrichedLocal.warnings,
        ...enrichedMoonReader.warnings,
        ...enrichedProgress.warnings
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
    localBookBatcher,
    commit,
    moonReaderBookBatcher,
    progressSyncBookBatcher,
    settings.localLibraryLocation,
    settings.moonReaderBackupLocation,
    settings.progressSyncLocation,
    settingsReady,
    ready,
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
      localBookBatcher.cancel();
      moonReaderBookBatcher.cancel();
      progressSyncBookBatcher.cancel();
    },
    [localBookBatcher, moonReaderBookBatcher, progressSyncBookBatcher]
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

  const isOnReadingList = useCallback(
    (key: string) => stateRef.current.readingList.some((item) => item.key === key),
    []
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
      setProgressSyncBooks((current) => current.map(applyRead));
      await commit((current) => ({
        downloaded: current.downloaded.map(applyRead),
        readingList: current.readingList.map(applyRead),
      }));
      if (settings.progressSyncLocation) await syncCloudProgress();
    },
    [commit, settings.progressSyncLocation, syncCloudProgress]
  );

  const removeLocalFile = useCallback(
    async (book: LibraryBook) => {
      if (!book.local?.uri) throw new Error('This library item has no local source file.');
      try {
        await deleteSourceFile(book.local.uri);
      } catch (err: any) {
        const message = `Could not delete ${book.local.filename}: ${err.message || String(err)}`;
        setError(message);
        throw new Error(message);
      }

      setLocalBooks((current) =>
        current.filter(
          (item) =>
            item.key !== book.key && item.local?.uri !== book.local?.uri
        )
      );
      try {
        await deleteLocalCatalogBook(book.local.uri);
        const markUnavailable = (item: LibraryBook) =>
          item.key === book.key ||
          (item.local?.uri ?? item.fileUri) === book.local?.uri
            ? { ...item, availableLocally: false }
            : item;
        await commit((current) => ({
          downloaded: current.downloaded.map(markUnavailable),
          readingList: current.readingList.map(markUnavailable),
        }));
      } catch (err: any) {
        const message = `The local file was removed, but Library state could not be updated: ${err.message || String(err)}`;
        setError(message);
        throw new Error(message);
      }
    },
    [commit]
  );

  const removeLibraryBook = useCallback(
    async (book: LibraryBook) => {
      const uri = book.local?.uri ?? book.fileUri;
      if (book.availableLocally !== false && book.local?.uri) {
        await deleteSourceFile(book.local.uri);
      }
      if (book.local?.uri) await deleteLocalCatalogBook(book.local.uri);
      await removeProgressSyncBook(book);
      const identity = bookIdentity(book.title, book.author);
      setLocalBooks((current) =>
        current.filter(
          (item) => item.key !== book.key && (!uri || item.local?.uri !== uri)
        )
      );
      setProgressSyncBooks((current) =>
        current.filter(
          (item) =>
            item.key !== book.key && bookIdentity(item.title, item.author) !== identity
        )
      );
      setMoonReaderBooks((current) =>
        current.filter((item) => bookIdentity(item.title, item.author) !== identity)
      );
      await commit((current) => ({
        downloaded: current.downloaded.filter(
          (item) =>
            item.key !== book.key &&
            (!uri || (item.local?.uri ?? item.fileUri) !== uri) &&
            bookIdentity(item.title, item.author) !== identity
        ),
        readingList: current.readingList.filter(
          (item) =>
            item.key !== book.key &&
            (!uri || (item.local?.uri ?? item.fileUri) !== uri) &&
            bookIdentity(item.title, item.author) !== identity
        ),
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
      setProgressSyncBooks((current) =>
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
              availableLocally: true,
              moonReader: { ...localBook.moonReader, ...moonBook.moonReader },
            }
          : moonBook
      );
      if (catalogKey !== moonBook.key) catalog.delete(moonBook.key);
    }

    const catalogByIdentity = new Map(
      [...catalog.values()].map((book) => [bookIdentity(book.title, book.author), book] as const)
    );
    for (const syncedBook of progressSyncBooks) {
      const catalogBook =
        catalog.get(syncedBook.key) ??
        catalogByIdentity.get(bookIdentity(syncedBook.title, syncedBook.author));
      if (!catalogBook) {
        catalog.set(syncedBook.key, syncedBook);
        catalogByIdentity.set(
          bookIdentity(syncedBook.title, syncedBook.author),
          syncedBook
        );
        continue;
      }

      const localProgress = catalogBook.isRead ? 100 : catalogBook.progress ?? 0;
      const syncedProgress = syncedBook.isRead ? 100 : syncedBook.progress ?? 0;
      const mergedProgress = Math.max(localProgress, syncedProgress);
      const mergedBook: LibraryBook = {
        ...syncedBook,
        ...catalogBook,
        availableLocally:
          catalogBook.availableLocally ?? !!catalogBook.local,
        progress: mergedProgress,
        isRead: catalogBook.isRead || syncedBook.isRead || mergedProgress >= 100,
        readingTimeMs: Math.max(
          catalogBook.readingTimeMs ?? 0,
          syncedBook.readingTimeMs ?? 0
        ) || undefined,
        wordsRead: Math.max(catalogBook.wordsRead ?? 0, syncedBook.wordsRead ?? 0) || undefined,
        lastReadAt: Math.max(catalogBook.lastReadAt ?? 0, syncedBook.lastReadAt ?? 0) || undefined,
        moonReader: {
          ...syncedBook.moonReader,
          ...catalogBook.moonReader,
          availableLocally: !!catalogBook.local || catalogBook.moonReader?.availableLocally,
        },
      };
      catalog.set(catalogBook.key, mergedBook);
      catalogByIdentity.set(bookIdentity(mergedBook.title, mergedBook.author), mergedBook);
      if (catalogBook.key !== syncedBook.key) catalog.delete(syncedBook.key);
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
  }, [localBooks, moonReaderBooks, progressSyncBooks, state.downloaded]);

  const readingList = useMemo(() => {
    const libraryByKey = new Map(downloaded.map((book) => [book.key, book]));
    return state.readingList.map((book) => {
      const enriched = libraryByKey.get(book.key);
      return enriched ? { ...enriched, addedAt: book.addedAt } : book;
    });
  }, [downloaded, state.readingList]);

  const catalogValue = useMemo<LibraryCatalogValue>(
    () => ({ downloaded, ready }),
    [downloaded, ready]
  );
  const readingListValue = useMemo<LibraryReadingListValue>(
    () => ({ readingList, ready }),
    [readingList, ready]
  );
  const uiStatusValue = useMemo<LibraryUiStatusValue>(
    () => ({
      scanning,
      error: error || syncError,
      warning,
      dismissWarning,
      showWarning,
    }),
    [dismissWarning, error, scanning, showWarning, syncError, warning]
  );
  const syncStatusValue = useMemo<LibrarySyncStatusValue>(
    () => ({ cloudSyncing, cloudLastSyncedAt }),
    [cloudLastSyncedAt, cloudSyncing]
  );
  const actionsValue = useMemo<LibraryActionsValue>(
    () => ({
      refreshLocalBooks,
      syncCloudProgress,
      refreshBookMetadata,
      markAsRead,
      removeLocalFile,
      removeLibraryBook,
      isOnReadingList,
      toggleReadingList,
      recordDownload,
    }),
    [
      removeLocalFile,
      isOnReadingList,
      markAsRead,
      recordDownload,
      refreshBookMetadata,
      refreshLocalBooks,
      removeLibraryBook,
      syncCloudProgress,
      toggleReadingList,
    ]
  );

  return (
    <LibraryCatalogContext.Provider value={catalogValue}>
      <LibraryReadingListContext.Provider value={readingListValue}>
        <LibraryUiStatusContext.Provider value={uiStatusValue}>
          <LibrarySyncStatusContext.Provider value={syncStatusValue}>
            <LibraryActionsContext.Provider value={actionsValue}>
              {children}
            </LibraryActionsContext.Provider>
          </LibrarySyncStatusContext.Provider>
        </LibraryUiStatusContext.Provider>
      </LibraryReadingListContext.Provider>
    </LibraryCatalogContext.Provider>
  );
}

export function useLibraryCatalog(): LibraryCatalogValue {
  return useContext(LibraryCatalogContext);
}

export function useLibraryReadingList(): LibraryReadingListValue {
  return useContext(LibraryReadingListContext);
}

export function useLibraryUiStatus(): LibraryUiStatusValue {
  return useContext(LibraryUiStatusContext);
}

export function useLibrarySyncStatus(): LibrarySyncStatusValue {
  return useContext(LibrarySyncStatusContext);
}

export function useLibraryActions(): LibraryActionsValue {
  return useContext(LibraryActionsContext);
}

export function useLibrary(): LibraryContextValue {
  return {
    ...useLibraryCatalog(),
    ...useLibraryReadingList(),
    ...useLibraryUiStatus(),
    ...useLibrarySyncStatus(),
    ...useLibraryActions(),
  };
}
