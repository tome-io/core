import { Feather } from '@expo/vector-icons';
import { ReaderSession } from '@/components/reader-session';
import { useKeepAwake } from 'expo-keep-awake';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Platform,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  ReadiumView,
  type DecorationActivatedEvent,
  type Link,
  type Locator,
  type PublicationReadyEvent,
  type ReadiumFile,
  type ReadiumViewRef,
  type SelectionActionEvent,
} from 'react-native-readium';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ReaderSettingsSheet,
  ReaderTocSheet,
  type ReaderTocItem,
} from '@/components/reader-sheets';
import {
  useLibraryActions,
  useLibraryCatalog,
  useLibraryReadingList,
} from '@/context/library-context';
import type { LibraryBook } from '@/lib/library';
import {
  locatorAtProgress,
  restoredReaderLocator,
  sampleReadingSpeed,
  type ReadingSpeedSample,
  shouldApplyRemoteProgress,
  shouldUploadReaderProgress,
  timeLeftLabel,
} from '@/lib/reader-metrics';
import {
  canReadInTomeio,
  prepareReadiumFile,
  readiumDecorations,
  readiumPreferences,
  readerThemeColors,
  toReadiumLocator,
} from '@/lib/readium-engine';
import {
  canonicalReaderBookKey,
  DEFAULT_READER_PREFERENCES,
  loadReaderState,
  readerProgress,
  saveBookReaderState,
  saveReaderPreferences,
  type ReaderHighlight,
  type ReaderLocator,
  type ReaderPreferences,
} from '@/lib/reader-state';

const HIGHLIGHT_COLOR = '#F0C94B';
const READER_FOOTER_HEIGHT = 28;
let readerInstanceSequence = 0;

function locatorLogValue(locator?: ReaderLocator | Locator | null) {
  const locations = locator?.locations as Locator['locations'] | undefined;
  return locator
    ? {
        href: locator.href,
        position: locations?.position,
        progression: locations?.progression,
        totalProgression: locations?.totalProgression,
        viewportPosition: locations?.viewportPosition,
        viewportPositionCount: locations?.viewportPositionCount,
      }
    : null;
}

function parseBook(value?: string): LibraryBook | null {
  if (!value) return null;
  try {
    const book = JSON.parse(value) as LibraryBook;
    return typeof book?.key === 'string' ? book : null;
  } catch {
    return null;
  }
}

function sameRouteValue(left?: string | null, right?: string | null): boolean {
  if (!left || !right) return false;
  const comparable = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  return comparable(left) === comparable(right);
}

function bookSource(book: LibraryBook | null): string | null {
  return book?.local?.uri ?? book?.fileUri ?? null;
}

function flattenToc(items: Link[], depth = 0): ReaderTocItem[] {
  return items.flatMap((item) => [
    ...(item.title ? [{ href: item.href, title: item.title, depth }] : []),
    ...flattenToc(item.children ?? [], depth + 1),
  ]);
}

function asReaderLocator(locator: Locator): ReaderLocator {
  return {
    ...locator,
    locations: locator.locations ? { ...locator.locations } : undefined,
  };
}

export default function ReadScreen() {
  const router = useRouter();
  const safeAreaInsets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const params = useLocalSearchParams<{ id: string; book?: string }>();
  const routeBook = useMemo(() => parseBook(params.book), [params.book]);
  const { downloaded } = useLibraryCatalog();
  const { readingList } = useLibraryReadingList();
  const { recordReadingProgress, refreshBookProgress } = useLibraryActions();
  const book = useMemo(
    () => {
      const candidates = [...downloaded, ...readingList];
      const catalogBook =
        candidates.find((candidate) => sameRouteValue(candidate.key, params.id)) ??
        candidates.find((candidate) => sameRouteValue(candidate.key, routeBook?.key)) ??
        candidates.find((candidate) =>
          sameRouteValue(bookSource(candidate), bookSource(routeBook)),
        );
      if (!catalogBook) return routeBook;
      if (!routeBook) return catalogBook;

      const syncedProgress = routeBook.isRead ? 100 : (routeBook.progress ?? 0);
      const catalogProgress = catalogBook.isRead
        ? 100
        : (catalogBook.progress ?? 0);
      const progress = Math.max(syncedProgress, catalogProgress);
      return {
        ...routeBook,
        ...catalogBook,
        local: catalogBook.local ?? routeBook.local,
        fileUri: catalogBook.fileUri ?? routeBook.fileUri,
        availableLocally:
          catalogBook.availableLocally ?? routeBook.availableLocally,
        progress,
        isRead: routeBook.isRead || catalogBook.isRead || progress >= 100,
        readingTimeMs: Math.max(
          routeBook.readingTimeMs ?? 0,
          catalogBook.readingTimeMs ?? 0,
        ),
        lastReadAt: Math.max(
          routeBook.lastReadAt ?? 0,
          catalogBook.lastReadAt ?? 0,
        ),
      };
    },
    [downloaded, params.id, readingList, routeBook],
  );
  const readerSourceKey = book
    ? canonicalReaderBookKey(bookSource(book) ?? book.key)
    : null;
  const [readerInstanceId] = useState(() => ++readerInstanceSequence);

  const readerRef = useRef<ReadiumViewRef>(null);
  const bookRef = useRef(book);
  const locatorRef = useRef<ReaderLocator | undefined>(undefined);
  const pendingSyncedProgressRef = useRef<number | null>(null);
  const pendingSyncedLocatorRef = useRef<ReaderLocator | null>(null);
  const restoringLocatorRef = useRef<ReaderLocator | null>(null);
  const restoreTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteProgressKnownRef = useRef(false);
  const remoteProgressRef = useRef<number | null>(null);
  const remoteLocatorRef = useRef<ReaderLocator | null>(null);
  const publicationPositionsRef = useRef<Locator[]>([]);
  const highlightsRef = useRef<ReaderHighlight[]>([]);
  const initialReadingTimeRef = useRef(0);
  const sessionStartedAtRef = useRef<number | null>(null);
  const speedSampleRef = useRef<ReadingSpeedSample>({ readingTimeMs: 0, positions: 0 });
  const stateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitFlushStartedRef = useRef(false);
  const activeRef = useRef(true);
  const initializationSequenceRef = useRef(0);
  const locationEventSequenceRef = useRef(0);
  const stateFlushSequenceRef = useRef(0);
  const targetedSyncSequenceRef = useRef(0);

  const [file, setFile] = useState<ReadiumFile | null>(null);
  const [preferences, setPreferences] = useState<ReaderPreferences>(
    DEFAULT_READER_PREFERENCES,
  );
  const [highlights, setHighlights] = useState<ReaderHighlight[]>([]);
  const [toc, setToc] = useState<ReaderTocItem[]>([]);
  const [progress, setProgress] = useState(book?.progress ?? 0);
  const [position, setPosition] = useState<number | null>(null);
  const [positionCount, setPositionCount] = useState(0);
  const [viewportPosition, setViewportPosition] = useState<number | null>(null);
  const [viewportPositionCount, setViewportPositionCount] = useState(0);
  const [speedSample, setSpeedSample] = useState<ReadingSpeedSample>({ readingTimeMs: 0, positions: 0 });
  const [publicationReady, setPublicationReady] = useState(false);
  const [readerPositionReady, setReaderPositionReady] = useState(true);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [tocVisible, setTocVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active');

  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );

  useEffect(() => {
    bookRef.current = book;
  }, [book]);

  const observedLocatorRef = useRef<Locator | null>(null);
  const locationHandlerRef = useRef<((locator: Locator) => void) | null>(null);
  const expectLocatorRestore = useCallback(
    (locator: ReaderLocator, source: string) => {
      if (restoreTimeoutRef.current) clearTimeout(restoreTimeoutRef.current);
      speedSampleRef.current = { ...speedSampleRef.current, anchor: undefined };
      const observed = observedLocatorRef.current;
      if (observed && restoredReaderLocator(locator, observed)) {
        restoringLocatorRef.current = null;
        setReaderPositionReady(true);
        locationHandlerRef.current?.(observed);
        return;
      }
      restoringLocatorRef.current = locator;
      setReaderPositionReady(false);
      if (__DEV__) {
        console.info('[reader-locator] waiting for restored locator', {
          readerInstanceId,
          source,
          target: locatorLogValue(locator),
        });
      }
      restoreTimeoutRef.current = setTimeout(() => {
        if (restoringLocatorRef.current !== locator) return;
        restoringLocatorRef.current = null;
        restoreTimeoutRef.current = null;
        setReaderPositionReady(true);
        // A failed navigation must not discard the navigator's actual location.
        if (observedLocatorRef.current) locationHandlerRef.current?.(observedLocatorRef.current);
        console.warn('[reader-locator] locator restore timed out', {
          readerInstanceId,
          source,
          target: locatorLogValue(locator),
        });
      }, 2_000);
    },
    [readerInstanceId],
  );

  useEffect(() => {
    const currentBook = bookRef.current;
    if (!currentBook) {
      setError('This book is no longer available in the Tomeio library.');
      return;
    }
    if (!canReadInTomeio(currentBook)) {
      setError('The Tomeio reader currently supports downloaded EPUB and PDF books only.');
      return;
    }
    let active = true;
    const initializationId = ++initializationSequenceRef.current;
    if (__DEV__) {
      console.info('[reader-locator] initialization started', {
        readerInstanceId,
        initializationId,
        title: currentBook.title,
        rawBookKey: currentBook.key,
        canonicalBookKey: canonicalReaderBookKey(currentBook.key),
        readerSourceKey,
      });
    }
    setError(null);
    setFile(null);
    observedLocatorRef.current = null;
    void (async () => {
      const stored = await loadReaderState(currentBook.key);
      if (!active) return;
      const storedProgress = readerProgress(stored.book.locator) ?? 0;
      const syncedProgress = currentBook.isRead ? 100 : (currentBook.progress ?? 0);
      const useSyncedProgress = syncedProgress > storedProgress + 0.01;
      if (__DEV__) {
        console.info('[reader-locator] initialization resolved', {
          readerInstanceId,
          initializationId,
          stored: locatorLogValue(stored.book.locator),
          storedProgress,
          catalogProgress: syncedProgress,
          initialSource: useSyncedProgress
            ? 'catalog-progress'
            : 'stored-locator',
        });
      }
      locatorRef.current = useSyncedProgress ? undefined : stored.book.locator;
      pendingSyncedProgressRef.current = useSyncedProgress ? syncedProgress : null;
      pendingSyncedLocatorRef.current = null;
      if (stored.book.locator && !useSyncedProgress) {
        expectLocatorRestore(stored.book.locator, 'stored-locator');
      } else {
        if (restoreTimeoutRef.current) clearTimeout(restoreTimeoutRef.current);
        restoreTimeoutRef.current = null;
        restoringLocatorRef.current = null;
        setReaderPositionReady(!useSyncedProgress);
      }
      remoteProgressKnownRef.current = false;
      remoteProgressRef.current = null;
      remoteLocatorRef.current = null;
      publicationPositionsRef.current = [];
      highlightsRef.current = stored.book.highlights;
      initialReadingTimeRef.current = Math.max(
        stored.book.readingTimeMs,
        currentBook.readingTimeMs ?? 0,
      );
      sessionStartedAtRef.current =
        AppState.currentState === 'active' ? Date.now() : null;
      setPreferences(stored.preferences);
      setHighlights(stored.book.highlights);
      const initialProgress = useSyncedProgress ? syncedProgress : storedProgress;
      speedSampleRef.current = { readingTimeMs: 0, positions: 0 };
      setSpeedSample(speedSampleRef.current);
      setPublicationReady(false);
      const initialPosition = useSyncedProgress
        ? null
        : (stored.book.locator?.locations?.position ?? null);
      setProgress(initialProgress);
      setPosition(initialPosition);
      setPositionCount(0);
      setViewportPosition(null);
      setViewportPositionCount(0);
      const prepared = await prepareReadiumFile(
        currentBook,
        useSyncedProgress ? undefined : stored.book.locator,
      );
      if (active) {
        if (__DEV__) {
          console.info('[reader-locator] Readium file prepared', {
            readerInstanceId,
            initializationId,
            initialLocator: locatorLogValue(stored.book.locator),
            passesInitialLocator: !useSyncedProgress && !!stored.book.locator,
          });
        }
        setFile(prepared);
      }
    })().catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      active = false;
      if (__DEV__) {
        console.info('[reader-locator] initialization disposed', {
          readerInstanceId,
          initializationId,
        });
      }
    };
  }, [expectLocatorRestore, readerInstanceId, readerSourceKey]);

  const currentReadingTime = useCallback(
    () => {
      const sessionStartedAt = sessionStartedAtRef.current;
      return (
        initialReadingTimeRef.current +
        (sessionStartedAt == null ? 0 : Math.max(0, Date.now() - sessionStartedAt))
      );
    },
    [],
  );

  const pauseReadingSession = useCallback(() => {
    const now = Date.now();
    const sessionStartedAt = sessionStartedAtRef.current;
    if (sessionStartedAt != null) {
      initialReadingTimeRef.current += Math.max(0, now - sessionStartedAt);
      sessionStartedAtRef.current = null;
    }
    speedSampleRef.current = { ...speedSampleRef.current, anchor: undefined };
  }, []);

  const flushState = useCallback(
    async (includeLibraryProgress: boolean) => {
      const currentBook = bookRef.current;
      if (!currentBook) return;
      const readingTimeMs = currentReadingTime();
      const flushId = ++stateFlushSequenceRef.current;
      if (__DEV__) {
        console.info('[reader-locator] state flush started', {
          readerInstanceId,
          flushId,
          bookKey: currentBook.key,
          includeLibraryProgress,
          locator: locatorLogValue(locatorRef.current),
        });
      }
      await saveBookReaderState(currentBook.key, {
        ...(locatorRef.current ? { locator: locatorRef.current } : {}),
        highlights: highlightsRef.current,
        readingTimeMs,
        lastOpenedAt: Date.now(),
      });
      const nextProgress = readerProgress(locatorRef.current);
      const shouldUpload =
        nextProgress != null &&
        shouldUploadReaderProgress({
          remoteKnown: remoteProgressKnownRef.current,
          remoteProgress: remoteProgressRef.current,
          remoteLocator: remoteLocatorRef.current,
          currentProgress: nextProgress,
          currentLocator: locatorRef.current,
        });
      if (includeLibraryProgress && nextProgress != null && shouldUpload) {
        await recordReadingProgress(
          currentBook,
          nextProgress,
          readingTimeMs,
          locatorRef.current,
        );
        remoteProgressKnownRef.current = true;
        remoteProgressRef.current = nextProgress;
        remoteLocatorRef.current = locatorRef.current ?? null;
      } else if (__DEV__ && includeLibraryProgress && nextProgress != null) {
        console.info('[reader-locator] remote progress write skipped', {
          readerInstanceId,
          flushId,
          reason: 'locator-and-progress-unchanged',
          locator: locatorLogValue(locatorRef.current),
          progress: nextProgress,
        });
      }
      if (__DEV__) {
        console.info('[reader-locator] state flush complete', {
          readerInstanceId,
          flushId,
          progress: nextProgress,
        });
      }
    },
    [currentReadingTime, readerInstanceId, recordReadingProgress],
  );

  const reportSaveError = useCallback((cause: unknown) => {
    if (activeRef.current) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    activeRef.current = true;
    const subscription = AppState.addEventListener('change', (state) => {
      setIsAppActive(state === 'active');
      if (state === 'active') {
        const now = Date.now();
        sessionStartedAtRef.current ??= now;
        return;
      }
      pauseReadingSession();
      void flushState(true).catch(reportSaveError);
    });
    return () => {
      activeRef.current = false;
      subscription.remove();
      if (stateTimerRef.current) clearTimeout(stateTimerRef.current);
      if (restoreTimeoutRef.current) clearTimeout(restoreTimeoutRef.current);
      pauseReadingSession();
      if (!exitFlushStartedRef.current) {
        void flushState(true).catch((cause) => {
          console.error('Reader state flush failed:', cause);
        });
      }
    };
  }, [flushState, pauseReadingSession, reportSaveError]);

  const handleLocationChange = useCallback(
    (locator: Locator) => {
      observedLocatorRef.current = locator;
      const previousLocator = locatorRef.current;
      const expectedLocator = restoringLocatorRef.current;
      if (__DEV__) {
        console.info('[reader-locator] Readium location event', {
          readerInstanceId,
          eventId: ++locationEventSequenceRef.current,
          previous: locatorLogValue(previousLocator),
          next: locatorLogValue(locator),
          expected: locatorLogValue(expectedLocator),
        });
      }
      if (expectedLocator && !restoredReaderLocator(expectedLocator, locator)) {
        if (__DEV__) {
          console.info('[reader-locator] transient restore event ignored', {
            readerInstanceId,
            expected: locatorLogValue(expectedLocator),
            received: locatorLogValue(locator),
          });
        }
        return;
      }
      if (expectedLocator) {
        restoringLocatorRef.current = null;
        if (restoreTimeoutRef.current) clearTimeout(restoreTimeoutRef.current);
        restoreTimeoutRef.current = null;
        if (__DEV__) {
          console.info('[reader-locator] locator restore complete', {
            readerInstanceId,
            locator: locatorLogValue(locator),
          });
        }
      }
      setReaderPositionReady(true);
      locatorRef.current = asReaderLocator(locator);
      const nextPosition = locator.locations?.position ?? null;
      speedSampleRef.current = sampleReadingSpeed(
        speedSampleRef.current,
        AppState.currentState === 'active' ? nextPosition : null,
        Date.now(),
      );
      setSpeedSample(speedSampleRef.current);
      setPosition(nextPosition);
      setViewportPosition(locator.locations?.viewportPosition ?? null);
      setViewportPositionCount(
        locator.locations?.viewportPositionCount ?? 0,
      );
      const nextProgress = readerProgress(locatorRef.current);
      if (nextProgress != null) {
        setProgress(nextProgress);
      }
      if (stateTimerRef.current) clearTimeout(stateTimerRef.current);
      stateTimerRef.current = setTimeout(() => {
        void flushState(false).catch(reportSaveError);
      }, 700);
    },
    [flushState, readerInstanceId, reportSaveError],
  );

  useEffect(() => {
    locationHandlerRef.current = handleLocationChange;
  }, [handleLocationChange]);

  const handlePublicationReady = useCallback(
    (publication: PublicationReadyEvent) => {
      if (__DEV__) {
        console.info('[reader-locator] publication ready', {
          readerInstanceId,
          positions: publication.positions.length,
          tableOfContents: publication.tableOfContents.length,
          pendingLocator: locatorLogValue(pendingSyncedLocatorRef.current),
          pendingProgress: pendingSyncedProgressRef.current,
        });
      }
      setPublicationReady(true);
      setToc(flattenToc(publication.tableOfContents));
      publicationPositionsRef.current = publication.positions;
      setPositionCount(publication.positions.length);
      const syncedLocator = pendingSyncedLocatorRef.current;
      if (syncedLocator != null) {
        pendingSyncedLocatorRef.current = null;
        pendingSyncedProgressRef.current = null;
        expectLocatorRestore(syncedLocator, 'pending-remote-locator');
        if (__DEV__) {
          console.info('[reader-locator] navigating', {
            readerInstanceId,
            source: 'pending-remote-locator',
            target: locatorLogValue(syncedLocator),
          });
        }
        readerRef.current?.goTo(toReadiumLocator(syncedLocator));
        return;
      }
      const syncedProgress = pendingSyncedProgressRef.current;
      if (syncedProgress == null || publication.positions.length === 0) return;
      pendingSyncedProgressRef.current = null;
      const targetLocator = locatorAtProgress(
        publication.positions,
        syncedProgress,
      );
      if (targetLocator) {
        expectLocatorRestore(
          asReaderLocator(targetLocator),
          'pending-catalog-progress',
        );
        if (__DEV__) {
          console.info('[reader-locator] navigating', {
            readerInstanceId,
            source: 'pending-catalog-progress',
            target: locatorLogValue(targetLocator),
          });
        }
        readerRef.current?.goTo(targetLocator);
      }
    },
    [expectLocatorRestore, readerInstanceId],
  );

  useEffect(() => {
    const currentBook = bookRef.current;
    if (!file || !currentBook) return;
    let active = true;
    const syncId = ++targetedSyncSequenceRef.current;
    if (__DEV__) {
      console.info('[reader-locator] targeted sync started', {
        readerInstanceId,
        syncId,
        current: locatorLogValue(locatorRef.current),
      });
    }
    void refreshBookProgress(currentBook)
      .then((result) => {
        const {
          book: refreshedBook,
          progress: remoteProgress,
          locator: syncedLocator,
        } = result;
        if (!active) {
          if (__DEV__) {
            console.info('[reader-locator] targeted sync discarded', {
              readerInstanceId,
              syncId,
            });
          }
          return;
        }
        bookRef.current = refreshedBook;
        remoteProgressKnownRef.current = true;
        remoteProgressRef.current = remoteProgress ?? null;
        remoteLocatorRef.current = syncedLocator ?? null;
        if (remoteProgress == null) {
          if (__DEV__) {
            console.info('[reader-locator] targeted sync resolved', {
              readerInstanceId,
              syncId,
              remoteProgress: null,
              remoteLocator: locatorLogValue(syncedLocator),
              action: 'keep-local-no-remote-progress',
            });
          }
          return;
        }
        const syncedProgress = remoteProgress;
        const currentReaderProgress = readerProgress(locatorRef.current);
        const shouldApply = shouldApplyRemoteProgress(
          syncedProgress,
          currentReaderProgress,
        );
        if (__DEV__) {
          console.info('[reader-locator] targeted sync resolved', {
            readerInstanceId,
            syncId,
            current: locatorLogValue(locatorRef.current),
            currentProgress: currentReaderProgress,
            remoteProgress: syncedProgress,
            remoteLocator: locatorLogValue(syncedLocator),
            action: shouldApply ? 'apply-remote' : 'keep-local',
          });
        }
        if (!shouldApply) return;

        setProgress(syncedProgress);
        if (syncedLocator) {
          locatorRef.current = syncedLocator;
          void saveBookReaderState(currentBook.key, {
            locator: syncedLocator,
          }).catch(reportSaveError);
          if (publicationPositionsRef.current.length > 0) {
            expectLocatorRestore(syncedLocator, 'targeted-remote-locator');
            if (__DEV__) {
              console.info('[reader-locator] navigating', {
                readerInstanceId,
                syncId,
                source: 'targeted-remote-locator',
                target: locatorLogValue(syncedLocator),
              });
            }
            readerRef.current?.goTo(toReadiumLocator(syncedLocator));
          } else {
            pendingSyncedLocatorRef.current = syncedLocator;
          }
          return;
        }

        const targetLocator = locatorAtProgress(
          publicationPositionsRef.current,
          syncedProgress,
        );
        if (targetLocator) {
          expectLocatorRestore(
            asReaderLocator(targetLocator),
            'targeted-remote-progress',
          );
          if (__DEV__) {
            console.info('[reader-locator] navigating', {
              readerInstanceId,
              syncId,
              source: 'targeted-remote-progress',
              target: locatorLogValue(targetLocator),
            });
          }
          readerRef.current?.goTo(targetLocator);
        } else {
          pendingSyncedProgressRef.current = syncedProgress;
        }
      })
      .catch((cause) => {
        console.info('[reader-sync] Continuing with local progress', {
          reason: cause instanceof Error ? cause.message : String(cause),
        });
      });
    return () => {
      active = false;
    };
  }, [
    file,
    expectLocatorRestore,
    readerInstanceId,
    readerSourceKey,
    refreshBookProgress,
    reportSaveError,
  ]);

  const updatePreferences = useCallback((next: ReaderPreferences) => {
    setPreferences(next);
    void saveReaderPreferences(next).catch(reportSaveError);
  }, [reportSaveError]);

  const handleSelectionAction = useCallback(
    (event: SelectionActionEvent) => {
      if (event.actionId !== 'highlight') return;
      const highlight: ReaderHighlight = {
        id: `highlight-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        locator: asReaderLocator(event.locator),
        color: HIGHLIGHT_COLOR,
        selectedText: event.selectedText,
        createdAt: Date.now(),
      };
      const next = [...highlightsRef.current, highlight];
      highlightsRef.current = next;
      setHighlights(next);
      const currentBook = bookRef.current;
      if (currentBook) {
        void saveBookReaderState(currentBook.key, { highlights: next }).catch(reportSaveError);
      }
    },
    [reportSaveError],
  );

  const handleDecorationActivated = useCallback(
    (event: DecorationActivatedEvent) => {
      const highlight = highlightsRef.current.find(
        (candidate) => candidate.id === event.decoration.id,
      );
      const currentBook = bookRef.current;
      if (!highlight || !currentBook) return;
      Alert.alert('Highlight', highlight.selectedText || 'Highlighted passage', [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            const next = highlightsRef.current.filter(
              (candidate) => candidate.id !== highlight.id,
            );
            highlightsRef.current = next;
            setHighlights(next);
            void saveBookReaderState(currentBook.key, { highlights: next }).catch(
              reportSaveError,
            );
          },
        },
      ]);
    },
    [reportSaveError],
  );

  const navigateToTocItem = useCallback((item: ReaderTocItem) => {
    speedSampleRef.current = { ...speedSampleRef.current, anchor: undefined };
    readerRef.current?.goTo(
      toReadiumLocator({
        href: item.href,
        type: 'application/xhtml+xml',
        title: item.title,
        locations: { progression: 0 },
      }),
    );
    setTocVisible(false);
  }, []);

  const goBack = useCallback(() => {
    exitFlushStartedRef.current = true;
    void flushState(true).catch(reportSaveError).finally(() => {
      if (router.canGoBack()) router.back();
      else router.replace('/library');
    });
  }, [flushState, reportSaveError, router]);

  const themeColors = readerThemeColors(preferences.theme);
  const remainingLabel = !publicationReady ? 'Loading…' : timeLeftLabel(
    speedSample.readingTimeMs,
    speedSample.positions,
    positionCount * Math.max(0, 1 - progress / 100),
    progress,
  );
  const bookPositionLabel = positionCount && position != null
    ? `${Math.max(1, Math.min(positionCount, position))} / ${positionCount}`
    : 'Unavailable';
  const positionLabel = viewportPosition
    ? viewportPositionCount
      ? `${viewportPosition} / ${viewportPositionCount}`
      : String(viewportPosition)
    : 'Unavailable';
  const footerBottom = safeAreaInsets.bottom + 4;
  const readerBottomInset = footerBottom + READER_FOOTER_HEIGHT;

  return (
    <View className="flex-1" style={{ backgroundColor: themeColors.backgroundColor }}>
      {file && !error && readerPositionReady && isFocused && isAppActive ? (
        <>
          <ReaderKeepAwake />
          {book ? <ReaderSession key={readerSourceKey} book={book} onError={reportSaveError} /> : null}
        </>
      ) : null}
      <StatusBar style={preferences.theme === 'dark' ? 'light' : 'dark'} />
      <Stack.Screen
        options={
          Platform.OS === 'ios'
            ? {
                headerShown: true,
                headerTransparent: false,
                headerTitle: '',
                headerBackVisible: false,
                headerShadowVisible: false,
                headerStyle: { backgroundColor: themeColors.backgroundColor },
                headerTintColor: themeColors.textColor,
                scrollEdgeEffects: { top: 'hidden', bottom: 'hidden' },
              }
            : { headerShown: false }
        }
      />
      {Platform.OS === 'ios' ? (
        <>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button
              icon="chevron.left"
              accessibilityLabel="Close reader"
              separateBackground
              onPress={goBack}
            />
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button
              icon="list.bullet"
              accessibilityLabel="Table of contents"
              onPress={() => setTocVisible(true)}
            />
            <Stack.Toolbar.Button
              icon="textformat.size"
              accessibilityLabel="Reading settings"
              separateBackground
              onPress={() => setSettingsVisible(true)}
            />
          </Stack.Toolbar>
        </>
      ) : null}

      {Platform.OS === 'android' && file && !error ? (
        <SafeAreaView
          edges={['top', 'left', 'right']}
          style={{ backgroundColor: themeColors.backgroundColor }}
        >
          <View className="flex-row items-center justify-between px-3 py-2">
            <ReaderButton
              icon="arrow-left"
              label="Close reader"
              foregroundColor={themeColors.textColor}
              theme={preferences.theme}
              onPress={goBack}
            />
            <View className="flex-row gap-2">
              <ReaderButton
                icon="list"
                label="Table of contents"
                foregroundColor={themeColors.textColor}
                theme={preferences.theme}
                onPress={() => setTocVisible(true)}
              />
              <ReaderButton
                icon="type"
                label="Reading settings"
                foregroundColor={themeColors.textColor}
                theme={preferences.theme}
                onPress={() => setSettingsVisible(true)}
              />
            </View>
          </View>
        </SafeAreaView>
      ) : null}

      {file && !error ? (
        <View
          style={{
            flex: 1,
            paddingBottom: readerBottomInset,
            backgroundColor: themeColors.backgroundColor,
          }}
        >
          <ReadiumView
            ref={readerRef}
            file={file}
            preferences={readiumPreferences(preferences, isLandscape)}
            decorations={readiumDecorations(highlights)}
            selectionActions={[{ id: 'highlight', label: 'Highlight' }]}
            style={{ flex: 1, opacity: readerPositionReady ? 1 : 0 }}
            onLocationChange={handleLocationChange}
            onPublicationReady={handlePublicationReady}
            onSelectionAction={handleSelectionAction}
            onDecorationActivated={handleDecorationActivated}
          />
        </View>
      ) : (
        <View className="flex-1 items-center justify-center gap-4 px-8">
          {error ? (
            <>
              <Feather name="alert-circle" size={28} color={themeColors.textColor} />
              <Text className="text-center text-sm" style={{ color: themeColors.textColor }}>
                {error}
              </Text>
              <Pressable
                onPress={goBack}
                className="rounded-full px-5 py-3"
                style={{ backgroundColor: '#FF6A00' }}
              >
                <Text className="text-sm font-semibold text-white">Back to book</Text>
              </Pressable>
            </>
          ) : (
            <>
              <ActivityIndicator color={themeColors.textColor} />
              <Text className="text-sm" style={{ color: themeColors.textColor }}>
                Opening {book?.title ?? 'book'}…
              </Text>
            </>
          )}
        </View>
      )}

      {file && !error ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            right: 16,
            bottom: footerBottom,
            left: 16,
          }}
        >
          <View
            className="h-0.5 overflow-hidden rounded-full"
            style={{ backgroundColor: `${themeColors.textColor}22` }}
          >
            <View
              style={{
                width: `${Math.max(0, Math.min(100, progress))}%`,
                height: '100%',
                backgroundColor: themeColors.textColor,
              }}
            />
          </View>
          <View className="mt-1 flex-row items-center">
            <Text
              numberOfLines={1}
              className="flex-1 text-[10px] font-medium"
              style={{ color: `${themeColors.textColor}AA` }}
            >
              {remainingLabel}
            </Text>
            <Text
              className="flex-1 text-center text-[10px] font-medium"
              style={{ color: `${themeColors.textColor}AA` }}
            >
              {positionLabel}
            </Text>
            <Text
              className="flex-1 text-right text-[10px] font-medium"
              style={{ color: `${themeColors.textColor}AA` }}
            >
              {bookPositionLabel}
            </Text>
          </View>
        </View>
      ) : null}

      <ReaderSettingsSheet
        visible={settingsVisible}
        preferences={preferences}
        onChange={updatePreferences}
        onClose={() => setSettingsVisible(false)}
      />
      <ReaderTocSheet
        visible={tocVisible}
        items={toc}
        onSelect={navigateToTocItem}
        onClose={() => setTocVisible(false)}
      />
    </View>
  );
}

function ReaderKeepAwake() {
  useKeepAwake(undefined, { suppressDeactivateWarnings: true });
  return null;
}

function ReaderButton({
  icon,
  label,
  foregroundColor,
  theme,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  foregroundColor: string;
  theme: ReaderPreferences['theme'];
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
      style={{
        backgroundColor:
          theme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.68)',
      }}
    >
      <Feather name={icon} size={20} color={foregroundColor} />
    </Pressable>
  );
}
