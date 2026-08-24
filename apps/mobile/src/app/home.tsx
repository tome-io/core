import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, type ViewToken, View } from 'react-native';

import { Rail, toDiscoveryBook } from '@/components/poster';
import { getSubject, getTrending, type FeedBook } from '@/lib/openlibrary';

const BG = '#0b0b0f';

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
  const generation = useRef(0);
  const requestedFeeds = useRef(new Set<string>());
  const [feeds, setFeeds] = useState<Record<string, FeedState>>(initialFeeds);

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
    <View className="flex-1" style={{ backgroundColor: BG }}>
      <FlatList
        data={FEEDS}
        keyExtractor={(feed) => feed.key}
        initialNumToRender={4}
        windowSize={5}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
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
