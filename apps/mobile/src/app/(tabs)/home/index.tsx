import type { BookMetadata } from '@tomeio/domain';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  type ViewToken,
  View,
} from 'react-native';

import { colors, SearchField, usePageBottomPadding, usePageGutter } from '@/components/app-ui';
import { ProviderAttribution, Rail } from '@/components/poster';
import { useExtensions } from '@/context/extensions-context';
import { useLibraryCatalog } from '@/context/library-context';
import { bookPriceLabel, bookSourceUrl } from '@/lib/book-offers';
import { detailParams, type LibraryBook } from '@/lib/library';
import type { FeedBook } from '@/lib/openlibrary';

const MIN_CONTINUE_READING_PROGRESS = 1;
const INITIAL_FEED_COUNT = 4;
const FEED_REQUEST_INTERVAL_MS = 2_000;

interface FeedConfig {
  key: string;
  title: string;
}

interface ProviderFeedBook extends FeedBook {
  extensionId: string;
  metadata: BookMetadata;
}

function providerFeedBook(book: BookMetadata, extensionId: string): ProviderFeedBook {
  return {
    id: `${extensionId}:${book.id}`,
    title: book.title,
    author: book.authors[0] || 'Unknown',
    cover: book.coverUrl || '',
    year: book.publishedYear ?? '',
    description: book.description || '',
    rating: book.rating,
    ratingsCount: book.ratingsCount,
    seriesPosition: book.seriesPosition,
    priceLabel: bookPriceLabel(book),
    sourceUrl: bookSourceUrl(book),
    extensionId,
    metadata: book,
  };
}

interface FeedState {
  books: ProviderFeedBook[];
  status: 'loading' | 'ready' | 'error';
  error: string | null;
}

const EMPTY_FEED: FeedState = { books: [], status: 'loading', error: null };
function initialFeeds(feeds: FeedConfig[]): Record<string, FeedState> {
  return Object.fromEntries(feeds.map(({ key }) => [key, { ...EMPTY_FEED }]));
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
      <View className="h-12 max-w-[700px] self-center w-full">
        <SearchField
          value={query}
          onChangeText={setQuery}
          onSearch={() => openSearch(query)}
          returnKeyType="search"
          placeholder="Search books, authors or ISBNs"
        />
      </View>
    </View>
  );
}

function HomeFeedRail({
  feed,
  state,
  attribution,
  onOpenBook,
  onOpenCategory,
  onRetry,
}: {
  feed: FeedConfig;
  state: FeedState;
  attribution?: { label: string; url: string; imageUrl?: string };
  onOpenBook: (book: ProviderFeedBook) => void;
  onOpenCategory: (feed: FeedConfig) => void;
  onRetry: (feed: FeedConfig) => void;
}) {
  const onPressBook = useCallback(
    (book: ProviderFeedBook) => onOpenBook(book),
    [onOpenBook]
  );
  const onSeeAll = useCallback(() => onOpenCategory(feed), [feed, onOpenCategory]);
  const handleRetry = useCallback(() => onRetry(feed), [feed, onRetry]);

  return (
    <Rail
      title={feed.title}
      subtitle={
        attribution ? <ProviderAttribution attribution={attribution} align="start" /> : undefined
      }
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
  const extensions = useExtensions();
  const { downloaded } = useLibraryCatalog();
  const generation = useRef(0);
  const requestedFeeds = useRef(new Set<string>());
  const scheduledFeedRequests = useRef<ReturnType<typeof setTimeout>[]>([]);
  const discoveryManifest = useMemo(() => {
    const manifests = [
      ...extensions.thirdParty
        .filter((extension) => extension.enabled)
        .map((extension) => extension.manifest),
      ...extensions.bundled,
    ];
    return manifests.find((manifest) => manifest.id === extensions.discoveryExtensionId) ?? null;
  }, [extensions.bundled, extensions.discoveryExtensionId, extensions.thirdParty]);
  const feedConfigs = useMemo(
    () =>
      (discoveryManifest?.catalogs ?? []).map((catalog) => ({
        key: catalog.id,
        title: catalog.name,
      })),
    [discoveryManifest]
  );
  const [feeds, setFeeds] = useState<Record<string, FeedState>>({});
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

    const extensionId = extensions.discoveryExtensionId;
    if (!extensionId) {
      setFeeds((current) => ({
        ...current,
        [feed.key]: { books: [], status: 'error', error: 'Choose a discovery provider in Settings.' },
      }));
      return;
    }
    const request = extensions.catalog(extensionId, {
      catalogId: feed.key,
      page: 1,
      limit: 10,
      language: 'en',
    });

    request
      .then((page) => {
        if (generation.current !== requestGeneration) return;
        setFeeds((current) => ({
          ...current,
          [feed.key]: {
            books: page.items.map((book) => providerFeedBook(book, extensionId)),
            status: 'ready',
            error: null,
          },
        }));
      })
      .catch((err) => {
        if (generation.current !== requestGeneration) return;
        setFeeds((current) => ({
          ...current,
          [feed.key]: {
            books: [],
            status: 'error',
            error: err.message || String(err),
          },
        }));
      });
  }, [extensions]);

  const load = useCallback(() => {
    const requestGeneration = ++generation.current;
    scheduledFeedRequests.current.forEach(clearTimeout);
    scheduledFeedRequests.current = [];
    requestedFeeds.current.clear();
    setFeeds(initialFeeds(feedConfigs));
    feedConfigs.slice(0, INITIAL_FEED_COUNT).forEach((feed, index) => {
      const timeout = setTimeout(
        () => requestFeed(feed, requestGeneration),
        index * FEED_REQUEST_INTERVAL_MS
      );
      scheduledFeedRequests.current.push(timeout);
    });
  }, [feedConfigs, requestFeed]);

  useEffect(() => {
    const initialLoad = setTimeout(load, 0);
    return () => {
      clearTimeout(initialLoad);
      scheduledFeedRequests.current.forEach(clearTimeout);
      scheduledFeedRequests.current = [];
      generation.current += 1;
    };
  }, [load]);

  const openBook = useCallback(
    (book: ProviderFeedBook) => {
      router.push({
        pathname: '/book/[id]',
        params: {
          id: book.metadata.id,
          extensionId: book.extensionId,
          extensionBook: JSON.stringify(book.metadata),
          sourceCover: book.cover,
        },
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
        params: {
          subject: feed.key,
          title: feed.title,
          extensionId: extensions.discoveryExtensionId ?? '',
        },
      });
    },
    [extensions.discoveryExtensionId, router]
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
    [
      continueReading,
      gutter,
      openContinueReading,
      openLibraryBook,
    ]
  );
  const contentContainerStyle = useMemo(
    () => ({ paddingTop: 12, paddingBottom: bottomPadding }),
    [bottomPadding]
  );

  const renderFeed = useCallback(
    ({ item, index }: { item: FeedConfig; index: number }) => (
      <HomeFeedRail
        feed={item}
        state={feeds[item.key] ?? EMPTY_FEED}
        attribution={index === 0 ? discoveryManifest?.attribution : undefined}
        onOpenBook={openBook}
        onOpenCategory={openCategory}
        onRetry={retryFeed}
      />
    ),
    [discoveryManifest?.attribution, feeds, openBook, openCategory, retryFeed]
  );

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<FeedConfig>[] }) => {
      viewableItems.forEach(({ item, index }) => {
        if (index != null && index >= INITIAL_FEED_COUNT) {
          requestFeed(item, generation.current);
        }
      });
    },
    [requestFeed]
  );
  const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 5 }), []);

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <FlatList
        data={feedConfigs}
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
