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

import { colors } from '@/components/app-ui';
import { Rail, toDiscoveryBook } from '@/components/poster';
import { useLibrary } from '@/context/library-context';
import { detailParams, type LibraryBook } from '@/lib/library';
import { getSubject, getTrending, type FeedBook } from '@/lib/openlibrary';

const SEARCH_DELAY_MS = 650;
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

function initialFeeds(): Record<string, FeedState> {
  return Object.fromEntries(
    FEEDS.map(({ key }) => [key, { books: [], status: 'loading', error: null }])
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { downloaded } = useLibrary();
  const generation = useRef(0);
  const requestedFeeds = useRef(new Set<string>());
  const [feeds, setFeeds] = useState<Record<string, FeedState>>(initialFeeds);
  const [query, setQuery] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const openSearch = useCallback(
    (value: string) => {
      const cleanQuery = value.trim();
      if (cleanQuery.length < 2) return;
      Keyboard.dismiss();
      router.push({ pathname: '/search', params: { q: cleanQuery } });
    },
    [router]
  );

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (query.trim().length < 2) return;
    searchTimer.current = setTimeout(() => openSearch(query), SEARCH_DELAY_MS);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [openSearch, query]);

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
        windowSize={5}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            <View className="px-6 pb-7">
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
                    className="h-12 w-12 items-center justify-center"
                  >
                    <Feather name="x" size={19} color={colors.textMuted} />
                  </Pressable>
                ) : (
                  <View className="h-12 w-12 items-center justify-center">
                    <Feather name="search" size={20} color={colors.textMuted} />
                  </View>
                )}
              </View>
            </View>
            {continueReading.length ? (
              <Rail
                title="Continue Reading"
                books={continueReading}
                onPressBook={openLibraryBook}
                onSeeAll={() => router.push('/library')}
              />
            ) : null}
          </View>
        }
        renderItem={({ item: feed }) => {
          const state = feeds[feed.key] ?? { books: [], status: 'loading', error: null };
          return (
            <Rail
              key={feed.key}
              title={feed.title}
              books={state.books}
              loading={state.status === 'loading'}
              error={state.error}
              onPressBook={(book) => openBook(book, feed.title)}
              onSeeAll={() => openCategory(feed)}
              onRetry={() => requestFeed(feed, generation.current, true)}
            />
          );
        }}
      />
    </View>
  );
}
