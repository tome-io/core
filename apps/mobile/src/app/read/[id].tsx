import { Feather } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Platform,
  Pressable,
  Text,
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
import { SafeAreaView } from 'react-native-safe-area-context';

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
  canReadInTomeio,
  prepareReadiumFile,
  readiumDecorations,
  readiumPreferences,
  readerThemeColors,
  toReadiumLocator,
} from '@/lib/readium-engine';
import {
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
const PROGRESS_FLUSH_INTERVAL_MS = 10_000;

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
  const params = useLocalSearchParams<{ id: string; book?: string }>();
  const routeBook = useMemo(() => parseBook(params.book), [params.book]);
  const { downloaded } = useLibraryCatalog();
  const { readingList } = useLibraryReadingList();
  const { recordReadingProgress } = useLibraryActions();
  const book = useMemo(
    () => {
      const candidates = [...downloaded, ...readingList];
      return (
        candidates.find((candidate) => sameRouteValue(candidate.key, params.id)) ??
        candidates.find((candidate) => sameRouteValue(candidate.key, routeBook?.key)) ??
        candidates.find((candidate) =>
          sameRouteValue(bookSource(candidate), bookSource(routeBook)),
        ) ??
        routeBook
      );
    },
    [downloaded, params.id, readingList, routeBook],
  );
  const readerSourceKey = book
    ? `${book.key}:${book.local?.uri ?? book.fileUri ?? ''}`
    : null;

  const readerRef = useRef<ReadiumViewRef>(null);
  const bookRef = useRef(book);
  const locatorRef = useRef<ReaderLocator | undefined>(undefined);
  const highlightsRef = useRef<ReaderHighlight[]>([]);
  const initialReadingTimeRef = useRef(0);
  const sessionStartedAtRef = useRef(Date.now());
  const lastProgressFlushAtRef = useRef(0);
  const stateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(true);

  const [file, setFile] = useState<ReadiumFile | null>(null);
  const [preferences, setPreferences] = useState<ReaderPreferences>(
    DEFAULT_READER_PREFERENCES,
  );
  const [highlights, setHighlights] = useState<ReaderHighlight[]>([]);
  const [toc, setToc] = useState<ReaderTocItem[]>([]);
  const [progress, setProgress] = useState(book?.progress ?? 0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [tocVisible, setTocVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bookRef.current = book;
  }, [book]);

  useEffect(() => {
    const currentBook = bookRef.current;
    if (!currentBook) {
      setError('This book is no longer available in the Tomeio library.');
      return;
    }
    if (!canReadInTomeio(currentBook)) {
      setError('The Tomeio reader currently supports downloaded EPUB books only.');
      return;
    }
    let active = true;
    setError(null);
    setFile(null);
    void (async () => {
      const stored = await loadReaderState(currentBook.key);
      if (!active) return;
      locatorRef.current = stored.book.locator;
      highlightsRef.current = stored.book.highlights;
      initialReadingTimeRef.current = Math.max(
        stored.book.readingTimeMs,
        currentBook.readingTimeMs ?? 0,
      );
      sessionStartedAtRef.current = Date.now();
      setPreferences(stored.preferences);
      setHighlights(stored.book.highlights);
      setProgress(
        readerProgress(stored.book.locator) ?? currentBook.progress ?? 0,
      );
      const prepared = await prepareReadiumFile(currentBook, stored.book.locator);
      if (active) setFile(prepared);
    })().catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      active = false;
    };
  }, [readerSourceKey]);

  const currentReadingTime = useCallback(
    () =>
      initialReadingTimeRef.current +
      Math.max(0, Date.now() - sessionStartedAtRef.current),
    [],
  );

  const flushState = useCallback(
    async (includeLibraryProgress: boolean) => {
      const currentBook = bookRef.current;
      if (!currentBook) return;
      const readingTimeMs = currentReadingTime();
      await saveBookReaderState(currentBook.key, {
        ...(locatorRef.current ? { locator: locatorRef.current } : {}),
        highlights: highlightsRef.current,
        readingTimeMs,
        lastOpenedAt: Date.now(),
      });
      const nextProgress = readerProgress(locatorRef.current);
      if (includeLibraryProgress && nextProgress != null) {
        await recordReadingProgress(currentBook, nextProgress, readingTimeMs);
        lastProgressFlushAtRef.current = Date.now();
      }
    },
    [currentReadingTime, recordReadingProgress],
  );

  const reportSaveError = useCallback((cause: unknown) => {
    if (activeRef.current) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    activeRef.current = true;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void flushState(true).catch(reportSaveError);
    });
    return () => {
      activeRef.current = false;
      subscription.remove();
      if (stateTimerRef.current) clearTimeout(stateTimerRef.current);
      void flushState(true).catch((cause) => {
        console.error('Reader state flush failed:', cause);
      });
    };
  }, [flushState, reportSaveError]);

  const handleLocationChange = useCallback(
    (locator: Locator) => {
      locatorRef.current = asReaderLocator(locator);
      const nextProgress = readerProgress(locatorRef.current);
      if (nextProgress != null) setProgress(nextProgress);
      if (stateTimerRef.current) clearTimeout(stateTimerRef.current);
      stateTimerRef.current = setTimeout(() => {
        const includeLibrary =
          Date.now() - lastProgressFlushAtRef.current >= PROGRESS_FLUSH_INTERVAL_MS;
        void flushState(includeLibrary).catch(reportSaveError);
      }, 700);
    },
    [flushState, reportSaveError],
  );

  const handlePublicationReady = useCallback((publication: PublicationReadyEvent) => {
    setToc(flattenToc(publication.tableOfContents));
  }, []);

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
    void flushState(true).catch(reportSaveError).finally(() => {
      if (router.canGoBack()) router.back();
      else router.replace('/library');
    });
  }, [flushState, reportSaveError, router]);

  const themeColors = readerThemeColors(preferences.theme);
  const progressLabel = `${Math.max(0, Math.min(100, progress)).toFixed(
    progress < 10 && progress % 1 !== 0 ? 1 : 0,
  )}%`;

  return (
    <View className="flex-1" style={{ backgroundColor: themeColors.backgroundColor }}>
      <StatusBar
        hidden={!controlsVisible}
        style={preferences.theme === 'dark' ? 'light' : 'dark'}
      />
      <Stack.Screen
        options={
          Platform.OS === 'ios'
            ? {
                headerShown: controlsVisible,
                headerTransparent: true,
                headerTitle: progressLabel,
                headerBackVisible: false,
                headerShadowVisible: false,
                scrollEdgeEffects: { top: 'hidden', bottom: 'hidden' },
              }
            : { headerShown: false }
        }
      />
      {Platform.OS === 'ios' && controlsVisible ? (
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

      {file && !error ? (
        <ReadiumView
          ref={readerRef}
          file={file}
          preferences={readiumPreferences(preferences)}
          decorations={readiumDecorations(highlights)}
          selectionActions={[{ id: 'highlight', label: 'Highlight' }]}
          style={{ flex: 1 }}
          onLocationChange={handleLocationChange}
          onPublicationReady={handlePublicationReady}
          onSelectionAction={handleSelectionAction}
          onDecorationActivated={handleDecorationActivated}
        />
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
        <>
          {/* KOReader reserves the top center for chrome and the bottom center for typography. */}
          <Pressable
            onPress={() => setControlsVisible((visible) => !visible)}
            accessibilityLabel={controlsVisible ? 'Hide reader controls' : 'Show reader controls'}
            style={{
              position: 'absolute',
              top: 0,
              left: '25%',
              width: '50%',
              height: '18%',
            }}
          />
          <Pressable
            onPress={() => setSettingsVisible(true)}
            accessibilityLabel="Reading settings"
            style={{
              position: 'absolute',
              bottom: 0,
              left: '25%',
              width: '50%',
              height: '16%',
            }}
          />
        </>
      ) : null}

      {Platform.OS === 'android' && controlsVisible && file && !error ? (
        <SafeAreaView
          pointerEvents="box-none"
          edges={['top', 'left', 'right', 'bottom']}
          style={{ position: 'absolute', inset: 0 }}
        >
          <View
            className="mx-3 mt-2 flex-row items-center rounded-2xl px-2 py-2"
            style={{ backgroundColor: 'rgba(16,11,8,0.92)' }}
          >
            <ReaderButton icon="arrow-left" label="Close reader" onPress={goBack} />
            <Text
              numberOfLines={1}
              className="mx-2 flex-1 text-sm font-semibold"
              style={{ color: '#F4EDE7' }}
            >
              {book?.title}
            </Text>
            <ReaderButton
              icon="list"
              label="Table of contents"
              onPress={() => setTocVisible(true)}
            />
            <ReaderButton
              icon="type"
              label="Reading settings"
              onPress={() => setSettingsVisible(true)}
            />
          </View>
        </SafeAreaView>
      ) : null}

      {file && !error ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', right: 16, bottom: 8, left: 16 }}
        >
          <View
            className="mb-1 h-0.5 overflow-hidden rounded-full"
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
          <Text
            className="text-right text-[10px] font-medium"
            style={{ color: `${themeColors.textColor}AA` }}
          >
            {progressLabel}
          </Text>
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

function ReaderButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
    >
      <Feather name={icon} size={20} color="#F4EDE7" />
    </Pressable>
  );
}
