import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { AppState } from 'react-native';

import { useSettings } from '@/context/settings-context';
import {
  EMPTY_LIBRARY,
  loadLibrary,
  saveLibrary,
  type LibraryBook,
  type LibraryState,
} from '@/lib/library';
import { scanLocalLibrary } from '@/lib/local-library';
import { enrichLocalLibrary } from '@/lib/local-metadata';
import { syncMoonReaderLibrary } from '@/lib/moon-reader';

interface LibraryContextValue extends LibraryState {
  ready: boolean;
  scanning: boolean;
  error: string | null;
  refreshLocalBooks: () => Promise<void>;
  deleteLocalBook: (book: LibraryBook) => Promise<void>;
  isOnReadingList: (key: string) => boolean;
  toggleReadingList: (book: LibraryBook) => Promise<boolean>;
  recordDownload: (book: LibraryBook, fileUri: string) => Promise<void>;
}

const LibraryContext = createContext<LibraryContextValue>({
  ...EMPTY_LIBRARY,
  ready: false,
  scanning: false,
  error: null,
  refreshLocalBooks: async () => {},
  deleteLocalBook: async () => {},
  isOnReadingList: () => false,
  toggleReadingList: async () => false,
  recordDownload: async () => {},
});

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const { settings, ready: settingsReady } = useSettings();
  const [state, setState] = useState<LibraryState>(EMPTY_LIBRARY);
  const [localBooks, setLocalBooks] = useState<LibraryBook[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const stateRef = useRef(state);
  const mutationQueue = useRef<Promise<void>>(Promise.resolve());
  const scanGeneration = useRef(0);
  const lastScanKey = useRef<string | null>(null);
  const pendingScan = useRef<{ key: string; promise: Promise<void> } | null>(null);

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

  const refreshLocalBooks = useCallback((): Promise<void> => {
    if (!settingsReady) return Promise.resolve();

    const key = settings.downloadLocation ?? '__app_downloads__';
    if (pendingScan.current?.key === key) return pendingScan.current.promise;

    const generation = ++scanGeneration.current;
    if (lastScanKey.current !== key) {
      lastScanKey.current = key;
      setLocalBooks([]);
    }
    setScanning(true);
    setScanError(null);

    let promise: Promise<void>;
    promise = scanLocalLibrary(settings.downloadLocation)
      .then(async (scan) => {
        if (scanGeneration.current !== generation) return;
        setLocalBooks((current) => {
          const existingByKey = new Map(current.map((book) => [book.key, book]));
          return scan.books.map((book) => {
            const existing = existingByKey.get(book.key);
            const unchanged =
              existing?.local?.size === book.local?.size &&
              existing?.local?.modificationTime === book.local?.modificationTime;
            return unchanged && existing
              ? {
                  ...existing,
                  cover: book.cover || existing.cover,
                  moonReader: book.moonReader || existing.moonReader,
                }
              : book;
          });
        });
        // Folder enumeration is complete. Metadata and cover enrichment continues
        // per-book without holding the native pull-to-refresh indicator open.
        setScanning(false);

        let books = scan.books;
        let moonReaderWarning = '';
        if (scan.moonReaderBackup) {
          try {
            const moonReader = await syncMoonReaderLibrary(books, scan.moonReaderBackup);
            books = moonReader.books;
            moonReaderWarning = moonReader.warning ?? '';
            if (scanGeneration.current === generation) setLocalBooks(books);
          } catch (err: any) {
            moonReaderWarning = `Moon+ Reader sync failed: ${err.message || String(err)}`;
          }
          if (scanGeneration.current === generation && moonReaderWarning) {
            setScanError(moonReaderWarning);
          }
        }

        const warnings = await enrichLocalLibrary(books, (enriched) => {
          if (scanGeneration.current !== generation) return;
          setLocalBooks((current) =>
            current.map((book) => (book.key === enriched.key ? enriched : book))
          );
        });
        if (scanGeneration.current === generation && (moonReaderWarning || warnings.length)) {
          const metadataWarning = warnings.length
            ? `Could not load complete metadata for ${warnings.length} local ${
                warnings.length === 1 ? 'book' : 'books'
              }. ${warnings[0].filename}: ${warnings[0].message}`
            : '';
          setScanError([moonReaderWarning, metadataWarning].filter(Boolean).join(' '));
        }
      })
      .catch((err) => {
        if (scanGeneration.current === generation) {
          setScanError(`Could not read the selected library folder: ${err.message || String(err)}`);
        }
      })
      .finally(() => {
        if (scanGeneration.current === generation) setScanning(false);
        if (pendingScan.current?.promise === promise) pendingScan.current = null;
      });

    pendingScan.current = { key, promise };
    return promise;
  }, [settings.downloadLocation, settingsReady]);

  useEffect(() => {
    void refreshLocalBooks();
  }, [refreshLocalBooks]);

  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const returningToApp = /inactive|background/.test(previousState) && nextState === 'active';
      previousState = nextState;
      if (returningToApp) void refreshLocalBooks();
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
    (book: LibraryBook, fileUri: string) =>
      commit((current) => {
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
      }),
    [commit]
  );

  const deleteLocalBook = useCallback(
    async (book: LibraryBook) => {
      if (!book.local?.uri) throw new Error('This library item has no local source file.');
      try {
        await FileSystem.deleteAsync(book.local.uri);
      } catch (err: any) {
        const message = `Could not delete ${book.local.filename}: ${err.message || String(err)}`;
        setError(message);
        throw new Error(message);
      }

      setLocalBooks((current) => current.filter((item) => item.key !== book.key));
      try {
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

  const downloaded = useMemo(() => {
    const seen = new Set<string>();
    // The scanner entry is live and gains embedded/MoonReader metadata as it is
    // enriched. Prefer it over the immutable download record for the same URI.
    return [...localBooks, ...state.downloaded].filter((book) => {
      const rawKey = book.fileUri || book.key;
      let key = rawKey;
      try {
        key = decodeURIComponent(rawKey);
      } catch {
        // Document providers are allowed to return opaque, non-decodable URIs.
      }
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [localBooks, state.downloaded]);

  const readingList = useMemo(() => {
    const localByKey = new Map(localBooks.map((book) => [book.key, book]));
    return state.readingList.map((book) => {
      const enriched = localByKey.get(book.key);
      return enriched ? { ...enriched, addedAt: book.addedAt } : book;
    });
  }, [localBooks, state.readingList]);

  return (
    <LibraryContext.Provider
      value={{
        ...state,
        downloaded,
        readingList,
        ready,
        scanning,
        error: error || scanError,
        refreshLocalBooks,
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
