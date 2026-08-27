import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  Pressable,
  TextInput,
  type ViewToken,
  View,
} from 'react-native';

import { colors, usePageBottomPadding, usePageGutter } from '@/components/app-ui';
import { Rail, toDiscoveryBook } from '@/components/poster';
import { useLibraryCatalog } from '@/context/library-context';
import { detailParams, type LibraryBook } from '@/lib/library';
import { getSubject, getTrending, type FeedBook } from '@/lib/openlibrary';

const MIN_CONTINUE_READING_PROGRESS = 1;

interface FeedConfig {
  key: string;
  title: string;
  subject?: string;
}

const FEEDS: FeedConfig[] = [
  { key: 'trending', title: 'Trending this week' },
  { key: 'fantasy', title: 'Fantasy', subject: 'fantasy' },
  { key: 'science-fiction', title: 'Science Fiction', subject: 'science-fiction' },
  { key: 'romance', title: 'Romance', subject: 'romance' },
  { key: 'mystery', title: 'Mystery & Crime', subject: 'mystery' },
  { key: 'historical-fiction', title: 'Historical Fiction', subject: 'historical-fiction' },
  { key: 'self-help', title: 'Self-Help', subject: 'self-help' },
  { key: 'business', title: 'Business', subject: 'business' },
  { key: 'science', title: 'Science', subject: 'science' },
];

interface FeedState {
  books: FeedBook[];
  status: 'loading' | 'ready' | 'error';
  error: string | null;
}

const EMPTY_FEED: FeedState = { books: [], status: 'loading', error: null };
function initialFeeds(): Record<string, FeedState> {
  return Object.fromEntries(FEEDS.map(({ key }) => [key, { ...EMPTY_FEED }]));
}

function HomeSearchBar({ gutter }: { gutter: number }) {
  const router = useRouter();
  const [query, setQuery] = useState('');

  const openSearch = useCallback(
    (value: string) => {
      const cleanQuery = value.trim();
      if (cleanQuery.length < 2) return;
      setQuery('');
      Keyboard.dismiss();
      router.push({ pathname: '/home/search', params: { q: cleanQuery } });
    },
    [router]
  );

  return (
    <View className="pb-6" style={{ paddingHorizontal: gutter }}>
      <View
        className="h-12 max-w-[700px] self-center w-full rounded-full flex-row items-center"
        style={{ backgroundColor: colors.surfaceRaised }}
      >
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => openSearch(query)}
          returnKeyType="search"
          placeholder="Search books, authors or ISBNs"
          placeholderTextColor={colors.textMuted}
          className="flex-1 h-12 pl-5 pr-2 text-[15px] font-medium text-white"
        />
        {query ? (
          <Pressable
            onPress={() => setQuery('')}
            accessibilityLabel="Clear search"
            accessibilityRole="button"
            className="h-12 w-10 items-center justify-center"
          >
            <Feather name="x" size={19} color={colors.textMuted} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => openSearch(query)}
          disabled={query.trim().length < 2}
          accessibilityLabel="Search"
          accessibilityRole="button"
          accessibilityState={{ disabled: query.trim().length < 2 }}
          className="h-12 w-12 items-center justify-center disabled:opacity-40"
        >
          <Feather name="search" size={20} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

function HomeFeedRail({
  feed,
  state,
  onOpenBook,
  onOpenCategory,
  onRetry,
}: {
  feed: FeedConfig;
  state: FeedState;
  onOpenBook: (book: FeedBook, genre: string) => void;
  onOpenCategory: (feed: FeedConfig) => void;
  onRetry: (feed: FeedConfig) => void;
}) {
  const onPressBook = useCallback(
    (book: FeedBook) => onOpenBook(book, feed.title),
    [feed.title, onOpenBook]
  );
  const onSeeAll = useCallback(() => onOpenCategory(feed), [feed, onOpenCategory]);
  const handleRetry = useCallback(() => onRetry(feed), [feed, onRetry]);

  return (
    <Rail
      title={feed.title}
      books={state.books}
      loading={state.status === 'loading'}
      error={state.error}
      onPressBook={onPressBook}
      onSeeAll={onSeeAll}
      onRetry={handleRetry}
    />
  );
}

function HomeListHeader({
  gutter,
  continueReading,
  onOpenLibraryBook,
  onSeeAllContinue,
}: {
  gutter: number;
  continueReading: LibraryBook[];
  onOpenLibraryBook: (book: LibraryBook) => void;
  onSeeAllContinue: () => void;
}) {
  return (
    <View>
      <HomeSearchBar gutter={gutter} />
      {continueReading.length ? (
        <Rail
          title="Continue Reading"
          books={continueReading}
          onPressBook={onOpenLibraryBook}
          onSeeAll={onSeeAllContinue}
        />
      ) : null}
    </View>
  );
}

export default function HomeScreen() {
  const gutter = usePageGutter();
  const bottomPadding = usePageBottomPadding();
  const router = useRouter();
  const { downloaded } = useLibraryCatalog();
  const generation = useRef(0);
  const requestedFeeds = useRef(new Set<string>());
  const [feeds, setFeeds] = useState<Record<string, FeedState>>(initialFeeds);
  const continueReading = useMemo(
    () =>
      downloaded
        .filter(
          (book) =>
            typeof book.progress === 'number' &&
            book.progress >= MIN_CONTINUE_READING_PROGRESS &&
            book.progress < 100 &&
            !book.isRead &&
            typeof book.lastReadAt === 'number' &&
            book.lastReadAt > 0
        )
        .sort((left, right) => (right.lastReadAt ?? 0) - (left.lastReadAt ?? 0))
        .slice(0, 12),
    [downloaded]
  );

  const requestFeed = useCallback((feed: FeedConfig, requestGeneration: number, force = false) => {
    if (!force && requestedFeeds.current.has(feed.key)) return;
    requestedFeeds.current.add(feed.key);
    setFeeds((current) => ({
      ...current,
      [feed.key]: { books: current[feed.key]?.books ?? [], status: 'loading', error: null },
    }));

    const request = feed.subject
      ? getSubject(feed.subject, 24)
      : getTrending(24);

    request
      .then((books) => {
        if (generation.current !== requestGeneration) return;
        setFeeds((current) => ({
          ...current,
          [feed.key]: { books, status: 'ready', error: null },
        }));
      })
      .catch((err) => {
        if (generation.current !== requestGeneration) return;
        requestedFeeds.current.delete(feed.key);
        setFeeds((current) => ({
          ...current,
          [feed.key]: {
            books: [],
            status: 'error',
            error: err.message || String(err),
          },
        }));
      });
  }, []);

  const load = useCallback(() => {
    const requestGeneration = ++generation.current;
    requestedFeeds.current.clear();
    setFeeds(initialFeeds());
    FEEDS.slice(0, 4).forEach((feed) => requestFeed(feed, requestGeneration));
  }, [requestFeed]);

  useEffect(() => {
    load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  const openBook = useCallback(
    (book: FeedBook, genre: string) => {
      router.push({
        pathname: '/book/[id]',
        params: { id: book.id, ext: JSON.stringify(toDiscoveryBook(book, genre)) },
      });
    },
    [router]
  );

  const openLibraryBook = useCallback(
    (book: LibraryBook) => router.push(detailParams(book) as any),
    [router]
  );

  const openCategory = useCallback(
    (feed: FeedConfig) => {
      router.push({
        pathname: '/category/[subject]',
        params: { subject: feed.subject ?? 'trending', title: feed.title },
      });
    },
    [router]
  );

  const retryFeed = useCallback((feed: FeedConfig) => {
    requestFeed(feed, generation.current, true);
  }, [requestFeed]);

  const openContinueReading = useCallback(() => {
    router.push('/library');
  }, [router]);

  const listHeader = useMemo(
    () => (
      <HomeListHeader
        gutter={gutter}
        continueReading={continueReading}
        onOpenLibraryBook={openLibraryBook}
        onSeeAllContinue={openContinueReading}
      />
    ),
    [continueReading, gutter, openContinueReading, openLibraryBook]
  );
  const contentContainerStyle = useMemo(
    () => ({ paddingTop: 12, paddingBottom: bottomPadding }),
    [bottomPadding]
  );

  const renderFeed = useCallback(
    ({ item }: { item: FeedConfig }) => (
      <HomeFeedRail
        feed={item}
        state={feeds[item.key] ?? EMPTY_FEED}
        onOpenBook={openBook}
        onOpenCategory={openCategory}
        onRetry={retryFeed}
      />
    ),
    [feeds, openBook, openCategory, retryFeed]
  );

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<FeedConfig>[] }) => {
      viewableItems.forEach(({ item }) => requestFeed(item, generation.current));
    }
  ).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 5 }).current;

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <FlatList
        data={FEEDS}
        keyExtractor={(feed) => feed.key}
        initialNumToRender={4}
        maxToRenderPerBatch={3}
        windowSize={5}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        contentContainerStyle={contentContainerStyle}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={listHeader}
        renderItem={renderFeed}
        extraData={feeds}
      />
    </View>
  );
}
