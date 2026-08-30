import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as FileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";
import { AppState } from "react-native";

import { useSettings } from "@/context/settings-context";
import { useExtensions } from "@/context/extensions-context";
import { bookIdentity } from "@/lib/book-metadata";
import {
  isUsableBookCoverSize,
  type BookCoverPreference,
  type ExtensionCoverLookup,
} from "@/lib/book-cover";
import { isFolderPickerActive } from "@/lib/folder-picker-lock";
import {
  EMPTY_LIBRARY,
  loadLibrary,
  saveLibrary,
  toExtensionLibraryBook,
  type LibraryBook,
  type LibraryState,
} from "@/lib/library";
import { reconcileLibraryStateWithLocalCatalog } from "@/lib/library-state";
import {
  clearMoonReaderCatalog,
  deleteLocalCatalogBook,
  invalidateCatalogMetadata,
  loadLocalCatalog,
  loadMoonReaderCatalog,
  loadProgressSyncCatalog,
  markCatalogBookRead,
  removeLibrarySyncBook,
  removeProgressSyncBook,
  setCatalogBookCoverPreference,
  setCatalogBookCoverCatalogSource,
  setCatalogBookCoverProviderSource,
  setCatalogBookCoverSources,
  setCollectionSyncMembership,
} from "@/lib/library-db";
import {
  enrichIndexedLocalLibrary,
  indexLocalLibrary,
} from "@/lib/library-sync";
import {
  synchronizeHostedProgressIfEnabled,
  type HostedSyncProgress,
} from "@/lib/hosted-sync";
import {
  indexReaderExtensionCatalog,
  type ReaderExtensionSyncOutput,
} from "@/lib/reader-extension-sync";
import { enrichIndexedReaderCatalog } from "@/lib/moon-reader-sync";
import {
  deleteNativeProgressFolderFile,
  isNativeFolderLocation,
} from "../../modules/expo-progress-folder/src";

interface LibraryCatalogValue {
  downloaded: LibraryBook[];
  ready: boolean;
}

interface LibraryReadingListValue {
  readingList: LibraryBook[];
  ready: boolean;
}

export interface LibraryActivity {
  state: "running" | "success" | "error";
  title: string;
  detail?: string;
  completed?: number;
  total?: number;
}

interface LibraryUiStatusValue {
  scanning: boolean;
  error: string | null;
  warning: string | null;
  activity: LibraryActivity | null;
  lastSyncedAt: number | null;
  dismissError: () => void;
  dismissWarning: () => void;
  dismissActivity: () => void;
  showWarning: (message: string) => void;
}

interface LibraryActionsValue {
  refreshLocalBooks: () => Promise<void>;
  synchronizeLibrary: () => Promise<void>;
  refreshProgressSyncBooks: () => Promise<void>;
  refreshBookMetadata: (book: LibraryBook) => Promise<void>;
  refreshBookCoverSources: (
    book: LibraryBook,
    force?: boolean,
  ) => Promise<string[]>;
  cacheBookCoverSource: (
    book: LibraryBook,
    providerId: string,
    uri: string,
  ) => Promise<void>;
  setBookCoverPreference: (
    book: LibraryBook,
    preference: BookCoverPreference,
  ) => Promise<void>;
  markAsRead: (book: LibraryBook) => Promise<void>;
  removeLocalFile: (book: LibraryBook) => Promise<void>;
  removeLibraryBook: (book: LibraryBook) => Promise<void>;
  isOnReadingList: (key: string) => boolean;
  toggleReadingList: (book: LibraryBook) => Promise<boolean>;
  recordDownload: (book: LibraryBook, fileUri: string) => Promise<void>;
}

interface LibraryContextValue
  extends
    LibraryCatalogValue,
    LibraryReadingListValue,
    LibraryUiStatusValue,
    LibraryActionsValue {}

function stableKey(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
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
  activity: null,
  lastSyncedAt: null,
  dismissError: () => {},
  dismissWarning: () => {},
  dismissActivity: () => {},
  showWarning: () => {},
});
const LibraryActionsContext = createContext<LibraryActionsValue>({
  refreshLocalBooks: async () => {},
  synchronizeLibrary: async () => {},
  refreshProgressSyncBooks: async () => {},
  refreshBookMetadata: async () => {},
  refreshBookCoverSources: async () => [],
  cacheBookCoverSource: async () => {},
  setBookCoverPreference: async () => {},
  markAsRead: async () => {},
  removeLocalFile: async () => {},
  removeLibraryBook: async () => {},
  isOnReadingList: () => false,
  toggleReadingList: async () => false,
  recordDownload: async () => {},
});

async function deleteSourceFile(uri: string): Promise<void> {
  if (uri.startsWith("content:") || isNativeFolderLocation(uri)) {
    await deleteNativeProgressFolderFile(uri);
    return;
  }
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) return;
  await FileSystem.deleteAsync(uri);
}

async function hasUsableRemoteCover(uri: string): Promise<boolean> {
  try {
    const image = await Image.loadAsync(uri);
    const usable = isUsableBookCoverSize(
      image.width * image.scale,
      image.height * image.scale,
    );
    image.release();
    return usable;
  } catch {
    return false;
  }
}

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const { settings, ready: settingsReady } = useSettings();
  const extensions = useExtensions();
  const [readerIntegrations, setReaderIntegrations] = useState<
    { id: string; name: string; configurationKey: string }[]
  >([]);
  const [readerConfigurationReady, setReaderConfigurationReady] =
    useState(false);
  const readerSourceKey = useMemo(
    () =>
      readerIntegrations.length
        ? `readers:${stableKey(
            JSON.stringify(
              readerIntegrations.map(({ id, configurationKey }) => ({
                id,
                configurationKey,
              })),
            ),
          )}`
        : null,
    [readerIntegrations],
  );
  const [state, setState] = useState<LibraryState>(EMPTY_LIBRARY);
  const [localBooks, setLocalBooks] = useState<LibraryBook[]>([]);
  const [moonReaderBooks, setMoonReaderBooks] = useState<LibraryBook[]>([]);
  const [progressSyncBooks, setProgressSyncBooks] = useState<LibraryBook[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [activity, setActivity] = useState<LibraryActivity | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const stateRef = useRef(state);
  const mutationQueue = useRef<Promise<void>>(Promise.resolve());
  const scanGeneration = useRef(0);
  const lastScanKey = useRef<string | null>(null);
  const pendingScan = useRef<{ key: string; promise: Promise<void> } | null>(
    null,
  );
  const enrichmentQueue = useRef<Promise<void>>(Promise.resolve());
  const lastRefreshStartedAt = useRef(0);
  const pendingChangeSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pendingChangeSyncRequested = useRef(false);
  const pendingChangeSyncRunning = useRef(false);

  useEffect(() => {
    if (!extensions.ready) {
      setReaderConfigurationReady(false);
      return;
    }
    let active = true;
    const installedReaders = extensions.thirdParty.filter(
      (candidate) =>
        candidate.enabled &&
        candidate.manifest.id !== "community.tomeio.moon-reader" &&
        candidate.manifest.resources.some(
          (resource) => resource.name === "reader",
        ),
    );
    Promise.all(
      installedReaders.map(async (installed) => {
        const values = await extensions.configuration(installed.manifest);
        const missing = (installed.manifest.config ?? [])
          .filter((field) => field.required)
          .filter((field) => {
            const value = values[field.key];
            return value == null || value === "";
          });
        if (missing.length) return null;
        return {
          id: installed.manifest.id,
          name: installed.manifest.name,
          configurationKey: JSON.stringify(values),
        };
      }),
    )
      .then((integrations) => {
        if (active)
          setReaderIntegrations(integrations.filter((value) => value != null));
      })
      .catch((cause) => {
        if (active) {
          setSyncError(
            `Reader add-on configuration failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
      })
      .finally(() => {
        if (active) setReaderConfigurationReady(true);
      });
    return () => {
      active = false;
    };
  }, [extensions.configuration, extensions.ready, extensions.thirdParty]);

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
    [],
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

  const reportHostedSyncProgress = useCallback(
    (progress: HostedSyncProgress) => {
      setActivity({
        state: "running",
        title: "Synchronizing Tomeio",
        detail: progress.message,
        completed: progress.completed,
        total: progress.total,
      });
    },
    [],
  );

  const extensionCoverLookup = useCallback<ExtensionCoverLookup>(
    async (book) => {
      const warnings: string[] = [];
      for (const provider of extensions
        .coverProviders()
        .filter((candidate) => candidate.id !== "org.tomeio.open-library")) {
        try {
          const uri = await extensions.cover(
            provider.id,
            toExtensionLibraryBook(book),
          );
          if (uri && (await hasUsableRemoteCover(uri))) {
            return { providerId: provider.id, uri };
          }
        } catch (cause) {
          warnings.push(
            `${provider.name}: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
      }
      if (warnings.length) {
        console.info("Cover provider lookup failed:", warnings.join(" "));
      }
      return null;
    },
    [extensions.cover, extensions.coverProviders],
  );
  const coverProviderKey = useMemo(
    () =>
      extensions
        .coverProviders()
        .map((provider) => `${provider.id}@${provider.version}`)
        .join("|"),
    [extensions.coverProviders],
  );

  const refreshLocalBooks = useCallback((): Promise<void> => {
    if (!settingsReady || !readerConfigurationReady || !ready)
      return Promise.resolve();

    const localKey = settings.localLibraryLocation ?? "__app_downloads__";
    const readerKey = readerSourceKey ?? "__no_reader_addons__";
    const key = `${localKey}|${readerKey}`;
    if (pendingScan.current?.key === key) return pendingScan.current.promise;

    const generation = ++scanGeneration.current;
    lastRefreshStartedAt.current = Date.now();
    const directoryChanged = lastScanKey.current !== key;
    lastScanKey.current = key;
    setScanning(true);
    setActivity({
      state: "running",
      title: "Updating library",
      detail: "Indexing books on this device…",
    });
    setSyncError(null);
    setWarning(null);

    let promise: Promise<void>;
    promise = (async () => {
      if (!readerSourceKey) await clearMoonReaderCatalog();
      const [cachedLocal, cachedMoonReader, cachedProgressBooks] =
        await Promise.all([
          loadLocalCatalog(localKey),
          readerSourceKey
            ? loadMoonReaderCatalog(readerKey)
            : Promise.resolve([]),
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
        warnings.push(
          `Local book indexing failed: ${err.message || String(err)}`,
        );
      }
      if (scanGeneration.current !== generation) return;
      if (localIndexSucceeded) {
        await commit((current) =>
          reconcileLibraryStateWithLocalCatalog(current, local.books),
        );
      }
      if (scanGeneration.current !== generation) return;
      setLocalBooks(local.books);

      let moonReader = { books: cachedMoonReader, warnings: [] as string[] };
      if (readerSourceKey) {
        setActivity({
          state: "running",
          title: "Updating library",
          detail: "Importing reader add-on changes…",
        });
        try {
          const requestBooks = local.books.map(toExtensionLibraryBook);
          const outputs: ReaderExtensionSyncOutput[] = await Promise.all(
            readerIntegrations.map(async (integration) => ({
              extensionId: integration.id,
              extensionName: integration.name,
              result: await extensions.readerSync(integration.id, {
                books: requestBooks,
              }),
            })),
          );
          moonReader = await indexReaderExtensionCatalog(
            readerKey,
            local.books,
            outputs,
          );
        } catch (err: any) {
          warnings.push(
            `Reader add-on synchronization failed: ${err.message || String(err)}`,
          );
        }
      }
      if (scanGeneration.current !== generation) return;
      setMoonReaderBooks(moonReader.books);

      let enrichmentLocalBooks = local.books;
      let enrichmentMoonReaderBooks = moonReader.books;
      let enrichmentProgressBooks = cachedProgressBooks;
      let enrichmentCollectionBooks = stateRef.current.downloaded;

      try {
        const hosted = await synchronizeHostedProgressIfEnabled({
          onProgress: reportHostedSyncProgress,
        });
        if (hosted != null) {
          setLastSyncedAt(hosted.syncedAt);
          const syncedState = await loadLibrary();
          stateRef.current = syncedState;
          setState(syncedState);
          enrichmentCollectionBooks = syncedState.downloaded;
          [
            enrichmentLocalBooks,
            enrichmentMoonReaderBooks,
            enrichmentProgressBooks,
          ] = await Promise.all([
            loadLocalCatalog(localKey),
            readerSourceKey
              ? loadMoonReaderCatalog(readerKey)
              : Promise.resolve([]),
            loadProgressSyncCatalog(),
          ]);
        }
      } catch (err: any) {
        warnings.push(`Tomeio Sync failed: ${err.message || String(err)}`);
      }

      const moonLocalByKey = new Map(
        enrichmentMoonReaderBooks
          .filter((book) => !!book.local)
          .map((book) => [book.key, book] as const),
      );
      const localWithMoonReaderMetadata = enrichmentLocalBooks.map(
        (book) => moonLocalByKey.get(book.key) ?? book,
      );

      warnings.push(...local.warnings, ...moonReader.warnings);
      setWarning(warnings.length ? warnings.join(" ") : null);
      if (scanGeneration.current !== generation) return;
      setScanning(false);

      const enrichmentOperation = enrichmentQueue.current.then(async () => {
        if (scanGeneration.current !== generation) return;
        setActivity({
          state: "running",
          title: "Updating book details",
          detail: "Finding covers and metadata in the background…",
        });
        const enrichmentProgress = new Map<
          string,
          { completed: number; total: number }
        >();
        const trackEnrichment = (source: string) =>
          (completed: number, total: number) => {
            if (scanGeneration.current !== generation) return;
            enrichmentProgress.set(source, { completed, total });
            const values = [...enrichmentProgress.values()];
            setActivity({
              state: "running",
              title: "Updating book details",
              detail: "Finding covers and metadata in the background…",
              completed: values.reduce(
                (sum, value) => sum + value.completed,
                0,
              ),
              total: values.reduce((sum, value) => sum + value.total, 0),
            });
          };

      const readerCatalogKeys = new Set<string>();
      for (const book of [
        ...enrichmentMoonReaderBooks,
        ...enrichmentProgressBooks,
      ]) {
        readerCatalogKeys.add(book.key);
        readerCatalogKeys.add(
          `identity:${bookIdentity(book.title, book.author)}`,
        );
      }
      const collectionOnlyBooks = enrichmentCollectionBooks.filter(
        (book) =>
          !book.local &&
          !readerCatalogKeys.has(book.key) &&
          !readerCatalogKeys.has(
            `identity:${bookIdentity(book.title, book.author)}`,
          ),
      );

      const [
        enrichedLocal,
        enrichedMoonReader,
        enrichedProgress,
        enrichedCollection,
      ] =
        await Promise.all([
          enrichIndexedLocalLibrary({
            directoryKey: localKey,
            books: localWithMoonReaderMetadata,
            onProgress: trackEnrichment("local"),
          }).catch((err: any) => ({
            books: localWithMoonReaderMetadata,
            warnings: [
              `Local metadata enrichment failed: ${err.message || String(err)}`,
            ],
          })),
          enrichIndexedReaderCatalog(enrichmentMoonReaderBooks, undefined, {
            onProgress: trackEnrichment("reader"),
            coverLookup: extensionCoverLookup,
            coverLookupKey: coverProviderKey,
          }).catch(
            (err: any) => ({
              books: enrichmentMoonReaderBooks,
              warnings: [
                `Reader add-on metadata enrichment failed: ${err.message || String(err)}`,
              ],
            }),
          ),
          enrichIndexedReaderCatalog(enrichmentProgressBooks, undefined, {
            onProgress: trackEnrichment("progress"),
            coverLookup: extensionCoverLookup,
            coverLookupKey: coverProviderKey,
          }).catch(
            (err: any) => ({
              books: enrichmentProgressBooks,
              warnings: [
                `Synced library metadata enrichment failed: ${err.message || String(err)}`,
              ],
            }),
          ),
          enrichIndexedReaderCatalog(collectionOnlyBooks, undefined, {
            onProgress: trackEnrichment("collection"),
            coverLookup: extensionCoverLookup,
            coverLookupKey: coverProviderKey,
          }).catch((err: any) => ({
              books: collectionOnlyBooks,
              warnings: [
                `Remote library metadata enrichment failed: ${err.message || String(err)}`,
              ],
            })),
        ]);
      if (scanGeneration.current !== generation) return;
      setLocalBooks(enrichedLocal.books);
      setMoonReaderBooks(enrichedMoonReader.books);
      setProgressSyncBooks(enrichedProgress.books);
      if (enrichedCollection.books.length) {
        const refreshedState = await loadLibrary();
        if (scanGeneration.current !== generation) return;
        stateRef.current = refreshedState;
        setState(refreshedState);
      }
      warnings.push(
        ...enrichedLocal.warnings,
        ...enrichedMoonReader.warnings,
        ...enrichedProgress.warnings,
        ...enrichedCollection.warnings,
      );
      setWarning(warnings.length ? warnings.join(" ") : null);
        setActivity({
          state: warnings.length ? "error" : "success",
          title: warnings.length
            ? "Library needs attention"
            : "Library is up to date",
          detail: warnings.length
            ? warnings.join(" ")
            : "Local books, reading progress, and covers are current.",
        });
      });
      enrichmentQueue.current = enrichmentOperation.catch(() => {});
      void enrichmentOperation.catch((err) => {
        if (scanGeneration.current !== generation) return;
        const message = `Book metadata enrichment failed: ${err.message || String(err)}`;
        setWarning(message);
        setActivity({
          state: "error",
          title: "Book details need attention",
          detail: message,
        });
      });
    })()
      .catch((err) => {
        if (scanGeneration.current === generation) {
          const message = `Library synchronization failed: ${err.message || String(err)}`;
          setSyncError(message);
          setActivity({
            state: "error",
            title: "Library synchronization failed",
            detail: message,
          });
        }
      })
      .finally(() => {
        if (scanGeneration.current === generation) setScanning(false);
        if (pendingScan.current?.promise === promise)
          pendingScan.current = null;
      });

    pendingScan.current = { key, promise };
    return promise;
  }, [
    commit,
    settings.localLibraryLocation,
    readerIntegrations,
    readerSourceKey,
    readerConfigurationReady,
    settingsReady,
    ready,
    extensions.readerSync,
    reportHostedSyncProgress,
    extensionCoverLookup,
    coverProviderKey,
  ]);

  const refreshProgressSyncBooks = useCallback(async (): Promise<void> => {
    const activeScan = pendingScan.current?.promise;
    if (activeScan) await activeScan;

    const books = await loadProgressSyncCatalog();
    const enriched = await enrichIndexedReaderCatalog(books, undefined, {
      force: true,
      coverLookup: extensionCoverLookup,
      coverLookupKey: coverProviderKey,
    });
    setProgressSyncBooks(enriched.books);
    if (enriched.warnings.length) setWarning(enriched.warnings.join(" "));
  }, [coverProviderKey, extensionCoverLookup]);

  useEffect(() => {
    void refreshLocalBooks();
  }, [refreshLocalBooks]);

  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener("change", (nextState) => {
      const returningToApp =
        /inactive|background/.test(previousState) && nextState === "active";
      previousState = nextState;
      const refreshIsStale =
        Date.now() - lastRefreshStartedAt.current >= 60_000;
      if (returningToApp && refreshIsStale && !isFolderPickerActive()) {
        void refreshLocalBooks();
      }
    });
    return () => subscription.remove();
  }, [refreshLocalBooks]);

  useEffect(
    () => () => {
      scanGeneration.current += 1;
    },
    [],
  );

  const enrichSyncedBooksInBackground = useCallback(
    (progressBooks: LibraryBook[], collectionBooks: LibraryBook[]) => {
      const candidates = new Map<string, LibraryBook>();
      for (const book of [...progressBooks, ...collectionBooks]) {
        if (!book.local) {
          candidates.set(bookIdentity(book.title, book.author), book);
        }
      }
      const operation = enrichmentQueue.current.then(async () => {
        const result = await enrichIndexedReaderCatalog(
          [...candidates.values()],
          undefined,
          {
            onProgress: (completed, total) => {
              setActivity({
                state: "running",
                title: "Updating book details",
                detail: "Finding covers and metadata in the background…",
                completed,
                total,
              });
            },
            coverLookup: extensionCoverLookup,
            coverLookupKey: coverProviderKey,
          },
        );
        const [refreshedProgress, refreshedState] = await Promise.all([
          loadProgressSyncCatalog(),
          loadLibrary(),
        ]);
        setProgressSyncBooks(refreshedProgress);
        stateRef.current = refreshedState;
        setState(refreshedState);
        setWarning(result.warnings.length ? result.warnings.join(" ") : null);
        setActivity({
          state: result.warnings.length ? "error" : "success",
          title: result.warnings.length
            ? "Book details need attention"
            : "Library is up to date",
          detail: result.warnings.length
            ? result.warnings.join(" ")
            : "Local books, reading progress, and covers are current.",
        });
      });
      enrichmentQueue.current = operation.catch(() => {});
      void operation.catch((cause) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        setWarning(message);
        setActivity({
          state: "error",
          title: "Book details need attention",
          detail: message,
        });
      });
    },
    [coverProviderKey, extensionCoverLookup],
  );

  const synchronizePendingChanges = useCallback(async (): Promise<void> => {
    try {
      const hosted = await synchronizeHostedProgressIfEnabled({
        onProgress: reportHostedSyncProgress,
      });
      if (hosted == null) return;
      setLastSyncedAt(hosted.syncedAt);
      const [syncedState, syncedProgress] = await Promise.all([
        loadLibrary(),
        loadProgressSyncCatalog(),
      ]);
      stateRef.current = syncedState;
      setState(syncedState);
      setProgressSyncBooks(syncedProgress);
      setActivity({
        state: "success",
        title: "Changes synchronized",
        detail: "Your library and reading progress are up to date.",
      });
      enrichSyncedBooksInBackground(syncedProgress, syncedState.downloaded);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setSyncError(message);
      setActivity({
        state: "error",
        title: "Tomeio Sync failed",
        detail: message,
      });
      throw cause;
    }
  }, [enrichSyncedBooksInBackground, reportHostedSyncProgress]);

  const schedulePendingChanges = useCallback(() => {
    pendingChangeSyncRequested.current = true;
    if (pendingChangeSyncTimer.current || pendingChangeSyncRunning.current)
      return;
    pendingChangeSyncTimer.current = setTimeout(() => {
      pendingChangeSyncTimer.current = null;
      pendingChangeSyncRunning.current = true;
      void (async () => {
        try {
          while (pendingChangeSyncRequested.current) {
            pendingChangeSyncRequested.current = false;
            await synchronizePendingChanges();
          }
        } catch {
          // synchronizePendingChanges publishes the failure for the global UI.
        } finally {
          pendingChangeSyncRunning.current = false;
          if (pendingChangeSyncRequested.current) schedulePendingChanges();
        }
      })();
    }, 500);
  }, [synchronizePendingChanges]);

  useEffect(
    () => () => {
      if (pendingChangeSyncTimer.current) {
        clearTimeout(pendingChangeSyncTimer.current);
      }
    },
    [],
  );

  const toggleReadingList = useCallback(
    async (book: LibraryBook) => {
      const exists = stateRef.current.readingList.some(
        (item) => item.key === book.key,
      );
      await commit((current) => ({
        ...current,
        readingList: exists
          ? current.readingList.filter((item) => item.key !== book.key)
          : [book, ...current.readingList],
      }));
      await setCollectionSyncMembership(book, "reading-list", !exists);
      schedulePendingChanges();
      return !exists;
    },
    [commit, schedulePendingChanges],
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
    [commit, refreshLocalBooks],
  );

  const isOnReadingList = useCallback(
    (key: string) =>
      stateRef.current.readingList.some((item) => item.key === key),
    [],
  );
  const dismissError = useCallback(() => {
    setError(null);
    setSyncError(null);
  }, []);
  const dismissWarning = useCallback(() => setWarning(null), []);
  const dismissActivity = useCallback(() => setActivity(null), []);
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
      schedulePendingChanges();
    },
    [commit, schedulePendingChanges],
  );

  const removeLocalFile = useCallback(
    async (book: LibraryBook) => {
      if (!book.local?.uri)
        throw new Error("This library item has no local source file.");
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
            item.key !== book.key && item.local?.uri !== book.local?.uri,
        ),
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
    [commit],
  );

  const removeLibraryBook = useCallback(
    async (book: LibraryBook) => {
      const uri = book.local?.uri ?? book.fileUri;
      await removeLibrarySyncBook(book);
      if (book.availableLocally !== false && book.local?.uri) {
        await deleteSourceFile(book.local.uri);
      }
      if (book.local?.uri) await deleteLocalCatalogBook(book.local.uri);
      await removeProgressSyncBook(book);
      const identity = bookIdentity(book.title, book.author);
      setLocalBooks((current) =>
        current.filter(
          (item) => item.key !== book.key && (!uri || item.local?.uri !== uri),
        ),
      );
      setProgressSyncBooks((current) =>
        current.filter(
          (item) =>
            item.key !== book.key &&
            bookIdentity(item.title, item.author) !== identity,
        ),
      );
      setMoonReaderBooks((current) =>
        current.filter(
          (item) => bookIdentity(item.title, item.author) !== identity,
        ),
      );
      await commit((current) => ({
        downloaded: current.downloaded.filter(
          (item) =>
            item.key !== book.key &&
            (!uri || (item.local?.uri ?? item.fileUri) !== uri) &&
            bookIdentity(item.title, item.author) !== identity,
        ),
        readingList: current.readingList.filter(
          (item) =>
            item.key !== book.key &&
            (!uri || (item.local?.uri ?? item.fileUri) !== uri) &&
            bookIdentity(item.title, item.author) !== identity,
        ),
      }));
      schedulePendingChanges();
    },
    [commit, schedulePendingChanges],
  );

  const refreshBookMetadata = useCallback(
    async (book: LibraryBook) => {
      if (pendingScan.current) await pendingScan.current.promise;
      await invalidateCatalogMetadata(book.key);
      const invalidRemoteCover =
        !book.local || book.cover?.includes("covers.openlibrary.org/b/isbn/");
      const invalidated: LibraryBook = {
        ...book,
        cover: invalidRemoteCover ? "" : book.cover,
        discovery: undefined,
        rating: undefined,
        ratingsCount: undefined,
        metadataPending: true,
        metadataUpdatedAt: undefined,
        metadataVersion: undefined,
      };
      setWarning(null);

      if (invalidated.local) {
        const directoryKey =
          settings.localLibraryLocation ?? "__app_downloads__";
        const result = await enrichIndexedLocalLibrary({
          directoryKey,
          books: [invalidated],
        });
        const refreshed = result.books[0];
        setLocalBooks((current) =>
          current.map((item) =>
            item.key === refreshed.key ? refreshed : item,
          ),
        );
        setWarning(result.warnings.length ? result.warnings.join(" ") : null);
        return;
      }

      const result = await enrichIndexedReaderCatalog(
        [invalidated],
        undefined,
        {
          coverLookup: extensionCoverLookup,
          coverLookupKey: coverProviderKey,
        },
      );
      const refreshed = result.books[0];
      setMoonReaderBooks((current) =>
        current.map((item) => (item.key === refreshed.key ? refreshed : item)),
      );
      setProgressSyncBooks((current) =>
        current.map((item) => (item.key === refreshed.key ? refreshed : item)),
      );
      const refreshedState = await loadLibrary();
      stateRef.current = refreshedState;
      setState(refreshedState);
      setWarning(result.warnings.length ? result.warnings.join(" ") : null);
    },
    [coverProviderKey, extensionCoverLookup, settings.localLibraryLocation],
  );

  const refreshBookCoverSources = useCallback(
    async (book: LibraryBook, force = false) => {
      const providers = extensions.coverProviders();
      const fresh =
        book.coverSourcesLookupKey === coverProviderKey &&
        ((!!book.coverSourcesUpdatedAt &&
          book.coverSourcesUpdatedAt >
            Date.now() - 7 * 24 * 60 * 60 * 1000) ||
          (!!book.coverSourcesRetryAt &&
            book.coverSourcesRetryAt > Date.now()));
      if (!force && fresh) return [];

      const results = await Promise.all(
        providers.map(async (provider) => {
          try {
            return {
              provider,
              uri: await extensions.cover(
                provider.id,
                toExtensionLibraryBook(book),
              ),
              error: null,
            };
          } catch (cause) {
            return {
              provider,
              uri: null,
              error: cause instanceof Error ? cause.message : String(cause),
            };
          }
        }),
      );
      let catalog: string | undefined;
      const providerSources: Record<string, string> = {};
      const unavailableProviders: string[] = [];
      for (const result of results) {
        if (result.error) {
          unavailableProviders.push(result.provider.name);
          console.info(
            `Cover provider ${result.provider.name} failed:`,
            result.error,
          );
          continue;
        }
        const { provider, uri } = result;
        if (!uri || !(await hasUsableRemoteCover(uri))) continue;
        if (provider.id === "org.tomeio.open-library") catalog = uri;
        else providerSources[provider.id] = uri;
      }

      const persisted = await setCatalogBookCoverSources(book.key, {
        catalog,
        providers: providerSources,
        lookupKey: coverProviderKey,
        complete: unavailableProviders.length === 0,
      });
      const applyCover = (item: LibraryBook): LibraryBook =>
        item.key === book.key ? { ...item, ...persisted } : item;
      setLocalBooks((current) => current.map(applyCover));
      setMoonReaderBooks((current) => current.map(applyCover));
      setProgressSyncBooks((current) => current.map(applyCover));
      await commit((current) => ({
        downloaded: current.downloaded.map(applyCover),
        readingList: current.readingList.map(applyCover),
      }));
      return unavailableProviders;
    },
    [commit, coverProviderKey, extensions.cover, extensions.coverProviders],
  );

  const cacheBookCoverSource = useCallback(
    async (book: LibraryBook, providerId: string, uri: string) => {
      if (book.coverSources?.providers?.[providerId] === uri) return;
      if (!(await hasUsableRemoteCover(uri))) return;
      const persisted = await setCatalogBookCoverProviderSource(
        book.key,
        providerId,
        uri,
      );
      const applyCover = (item: LibraryBook): LibraryBook =>
        item.key === book.key ? { ...item, ...persisted } : item;
      setLocalBooks((current) => current.map(applyCover));
      setMoonReaderBooks((current) => current.map(applyCover));
      setProgressSyncBooks((current) => current.map(applyCover));
      await commit((current) => ({
        downloaded: current.downloaded.map(applyCover),
        readingList: current.readingList.map(applyCover),
      }));
    },
    [commit],
  );

  const setBookCoverPreference = useCallback(
    async (book: LibraryBook, preference: BookCoverPreference) => {
      if (preference === "catalog" && !book.coverSources?.catalog) {
        const uri = await extensions.cover(
          "org.tomeio.open-library",
          toExtensionLibraryBook(book),
        );
        if (!uri || !(await hasUsableRemoteCover(uri)))
          throw new Error("Open Library did not find a cover for this book.");
        await setCatalogBookCoverCatalogSource(book.key, uri);
      }
      if (preference.startsWith("provider:")) {
        const providerId = preference.slice("provider:".length);
        if (!book.coverSources?.providers?.[providerId]) {
          const uri = await extensions.cover(
            providerId,
            toExtensionLibraryBook(book),
          );
          if (!uri || !(await hasUsableRemoteCover(uri))) {
            const provider = extensions
              .coverProviders()
              .find((candidate) => candidate.id === providerId);
            throw new Error(
              `${provider?.name ?? "The selected provider"} did not find a cover for this book.`,
            );
          }
          await setCatalogBookCoverProviderSource(book.key, providerId, uri);
        }
      }
      const persisted = await setCatalogBookCoverPreference(
        book.key,
        preference,
      );
      const applyCover = (item: LibraryBook): LibraryBook =>
        item.key === book.key
          ? {
              ...item,
              cover: persisted.cover,
              fallbackCover: persisted.fallbackCover,
              coverSources: persisted.coverSources,
              coverPreference: persisted.coverPreference,
            }
          : item;
      setLocalBooks((current) => current.map(applyCover));
      setMoonReaderBooks((current) => current.map(applyCover));
      setProgressSyncBooks((current) => current.map(applyCover));
      await commit((current) => ({
        downloaded: current.downloaded.map(applyCover),
        readingList: current.readingList.map(applyCover),
      }));
    },
    [commit, extensions.cover, extensions.coverProviders],
  );

  const downloaded = useMemo(() => {
    const catalog = new Map<string, LibraryBook>();
    const localByIdentity = new Map<string, LibraryBook>();
    for (const book of localBooks) {
      catalog.set(book.key, book);
      localByIdentity.set(
        bookIdentity(
          book.title,
          book.author,
          book.format || book.local?.format || "",
        ),
        book,
      );
    }
    for (const moonBook of moonReaderBooks) {
      const localBook =
        catalog.get(moonBook.key) ??
        localByIdentity.get(
          bookIdentity(
            moonBook.title,
            moonBook.author,
            moonBook.format || moonBook.local?.format || "",
          ),
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
              ...(moonBook.moonReader
                ? {
                    moonReader: {
                      ...localBook.moonReader,
                      ...moonBook.moonReader,
                    },
                  }
                : localBook.moonReader
                  ? { moonReader: localBook.moonReader }
                  : {}),
            }
          : moonBook,
      );
      if (catalogKey !== moonBook.key) catalog.delete(moonBook.key);
    }

    const catalogByIdentity = new Map(
      [...catalog.values()].map(
        (book) => [bookIdentity(book.title, book.author), book] as const,
      ),
    );
    for (const syncedBook of progressSyncBooks) {
      const catalogBook =
        catalog.get(syncedBook.key) ??
        catalogByIdentity.get(
          bookIdentity(syncedBook.title, syncedBook.author),
        );
      if (!catalogBook) {
        catalog.set(syncedBook.key, syncedBook);
        catalogByIdentity.set(
          bookIdentity(syncedBook.title, syncedBook.author),
          syncedBook,
        );
        continue;
      }

      const localProgress = catalogBook.isRead
        ? 100
        : (catalogBook.progress ?? 0);
      const syncedProgress = syncedBook.isRead
        ? 100
        : (syncedBook.progress ?? 0);
      const mergedProgress = Math.max(localProgress, syncedProgress);
      const readerData = catalogBook.moonReader ?? syncedBook.moonReader;
      const mergedBook: LibraryBook = {
        ...syncedBook,
        ...catalogBook,
        availableLocally: catalogBook.availableLocally ?? !!catalogBook.local,
        progress: mergedProgress,
        isRead:
          catalogBook.isRead || syncedBook.isRead || mergedProgress >= 100,
        readingTimeMs:
          Math.max(
            catalogBook.readingTimeMs ?? 0,
            syncedBook.readingTimeMs ?? 0,
          ) || undefined,
        wordsRead:
          Math.max(catalogBook.wordsRead ?? 0, syncedBook.wordsRead ?? 0) ||
          undefined,
        lastReadAt:
          Math.max(catalogBook.lastReadAt ?? 0, syncedBook.lastReadAt ?? 0) ||
          undefined,
        ...(readerData
          ? {
              moonReader: {
                ...syncedBook.moonReader,
                ...catalogBook.moonReader,
                syncedAt: readerData.syncedAt,
                availableLocally:
                  !!catalogBook.local || catalogBook.moonReader?.availableLocally,
              },
            }
          : {}),
      };
      catalog.set(catalogBook.key, mergedBook);
      catalogByIdentity.set(
        bookIdentity(mergedBook.title, mergedBook.author),
        mergedBook,
      );
      if (catalogBook.key !== syncedBook.key) catalog.delete(syncedBook.key);
    }
    const seen = new Set<string>();
    const seenIdentities = new Set(
      [...catalog.values()].map((book) =>
        bookIdentity(
          book.title,
          book.author,
          book.format || book.local?.format || "",
        ),
      ),
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
          book.format || book.local?.format || "",
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
    [downloaded, ready],
  );
  const readingListValue = useMemo<LibraryReadingListValue>(
    () => ({ readingList, ready }),
    [readingList, ready],
  );
  const uiStatusValue = useMemo<LibraryUiStatusValue>(
    () => ({
      scanning,
      error: error || syncError,
      warning,
      activity,
      lastSyncedAt,
      dismissError,
      dismissWarning,
      dismissActivity,
      showWarning,
    }),
    [
      dismissError,
      dismissActivity,
      dismissWarning,
      error,
      activity,
      lastSyncedAt,
      scanning,
      showWarning,
      syncError,
      warning,
    ],
  );
  const actionsValue = useMemo<LibraryActionsValue>(
    () => ({
      refreshLocalBooks,
      synchronizeLibrary: synchronizePendingChanges,
      refreshProgressSyncBooks,
      refreshBookMetadata,
      refreshBookCoverSources,
      cacheBookCoverSource,
      setBookCoverPreference,
      markAsRead,
      removeLocalFile,
      removeLibraryBook,
      isOnReadingList,
      toggleReadingList,
      recordDownload,
    }),
    [
      cacheBookCoverSource,
      removeLocalFile,
      isOnReadingList,
      markAsRead,
      recordDownload,
      refreshBookMetadata,
      refreshBookCoverSources,
      setBookCoverPreference,
      refreshLocalBooks,
      synchronizePendingChanges,
      refreshProgressSyncBooks,
      removeLibraryBook,
      toggleReadingList,
    ],
  );

  return (
    <LibraryCatalogContext.Provider value={catalogValue}>
      <LibraryReadingListContext.Provider value={readingListValue}>
        <LibraryUiStatusContext.Provider value={uiStatusValue}>
          <LibraryActionsContext.Provider value={actionsValue}>
            {children}
          </LibraryActionsContext.Provider>
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

export function useLibraryActions(): LibraryActionsValue {
  return useContext(LibraryActionsContext);
}

export function useLibrary(): LibraryContextValue {
  return {
    ...useLibraryCatalog(),
    ...useLibraryReadingList(),
    ...useLibraryUiStatus(),
    ...useLibraryActions(),
  };
}
