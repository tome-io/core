import { Feather } from '@expo/vector-icons';
import type { BookMetadata } from '@readoi/domain';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { BookGrid, BookGridSkeleton, GridLoadingMore } from '@/components/book-grid';
import type { CardBook } from '@/components/book-card';
import { useExtensions } from '@/context/extensions-context';

const SEARCH_DELAY_MS = 500;

const FORMATS = [
  { label: 'Any', value: '' },
  { label: 'EPUB', value: 'epub' },
  { label: 'PDF', value: 'pdf' },
  { label: 'MOBI', value: 'mobi' },
  { label: 'AZW3', value: 'azw3' },
];

const SEARCH_HINTS = [
  { icon: 'book-open' as const, label: 'Titles' },
  { icon: 'user' as const, label: 'Authors' },
  { icon: 'hash' as const, label: 'ISBNs' },
];

interface SearchBook extends CardBook {
  extensionId: string;
  metadata: BookMetadata;
}

function searchBook(book: BookMetadata, extensionId: string): SearchBook {
  return {
    id: `${extensionId}:${book.id}`,
    title: book.title,
    author: book.authors[0] || 'Unknown',
    cover: book.coverUrl || '',
    year: book.publishedYear,
    rating: book.rating,
    extensionId,
    metadata: book,
  };
}

export default function SearchScreen() {
  const router = useRouter();
  const extensions = useExtensions();
  const { width } = useWindowDimensions();
  const wideHeader = width >= 900;
  const searchGeneration = useRef(0);
  const [query, setQuery] = useState('');
  const [format, setFormat] = useState('');
  const [books, setBooks] = useState<SearchBook[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchedFor, setSearchedFor] = useState('');
  const [searchedFormat, setSearchedFormat] = useState('');

  const runSearch = useCallback(async (q: string, fmt: string, generation: number) => {
    const cleanQuery = q.trim();
    if (cleanQuery.length < 2) return;
    setLoading(true);
    setError(null);
    setSearchedFor(cleanQuery);
    setSearchedFormat(fmt);
    try {
      if (!extensions.searchExtensionId) {
        throw new Error('Choose an enabled search provider in Extensions first.');
      }
      const result = await extensions.search(extensions.searchExtensionId, {
        query: cleanQuery,
        page: 1,
        limit: 25,
        format: fmt || undefined,
      });
      if (searchGeneration.current !== generation) return;
      setBooks(result.items.map((book) => searchBook(book, extensions.searchExtensionId!)));
      setPage(1);
      setHasMore(result.nextPage != null || result.items.length === 25);
    } catch (err: any) {
      if (searchGeneration.current !== generation) return;
      setError(err.message || String(err));
      setBooks([]);
    } finally {
      if (searchGeneration.current === generation) setLoading(false);
    }
  }, [extensions]);

  useEffect(() => {
    const cleanQuery = query.trim();
    const generation = ++searchGeneration.current;
    setLoadingMore(false);

    if (cleanQuery.length < 2) {
      setLoading(false);
      setError(null);
      setBooks([]);
      setSearchedFor('');
      setHasMore(true);
      return;
    }

    setLoading(true);
    setError(null);

    const timer = setTimeout(() => {
      runSearch(cleanQuery, format, generation);
    }, SEARCH_DELAY_MS);

    return () => clearTimeout(timer);
  }, [format, query, runSearch]);

  const submitSearch = useCallback(() => {
    if (query.trim().length < 2) return;
    Keyboard.dismiss();
    const generation = ++searchGeneration.current;
    runSearch(query, format, generation);
  }, [format, query, runSearch]);

  const clearSearch = useCallback(() => {
    searchGeneration.current += 1;
    setQuery('');
    setBooks([]);
    setError(null);
    setSearchedFor('');
    setHasMore(true);
    setLoading(false);
    setLoadingMore(false);
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || !searchedFor || !hasMore) return;
    const generation = searchGeneration.current;
    setLoadingMore(true);
    setError(null);
    try {
      const nextPage = page + 1;
      if (!extensions.searchExtensionId) {
        throw new Error('Choose an enabled search provider in Extensions first.');
      }
      const result = await extensions.search(extensions.searchExtensionId, {
        query: searchedFor,
        page: nextPage,
        limit: 25,
        format: searchedFormat || undefined,
      });
      if (searchGeneration.current !== generation) return;
      setPage(nextPage);
      setHasMore(result.nextPage != null || result.items.length === 25);
      setBooks((current) => [
        ...current,
        ...result.items.map((book) => searchBook(book, extensions.searchExtensionId!)),
      ]);
    } catch (err: any) {
      if (searchGeneration.current === generation) setError(err.message || String(err));
    } finally {
      if (searchGeneration.current === generation) setLoadingMore(false);
    }
  }, [extensions, hasMore, loadingMore, page, searchedFor, searchedFormat]);

  const openBook = useCallback(
    (book: SearchBook) => {
      router.push({
        pathname: '/book/[id]',
        params: {
          id: book.metadata.id,
          extensionId: book.extensionId,
          extensionBook: JSON.stringify(book.metadata),
        },
      });
    },
    [router]
  );

  const footer = loadingMore ? (
    <GridLoadingMore />
  ) : error && books.length ? (
    <View className="items-center gap-2 py-5">
      <Text className="text-xs text-red-400">{error}</Text>
      <Pressable onPress={loadMore}>
        <Text className="text-xs font-semibold text-[#8b7cf6]">Retry</Text>
      </Pressable>
    </View>
  ) : null;

  return (
    <View className="flex-1" style={{ backgroundColor: '#0b0b0f' }}>
      <View
        className={wideHeader ? 'px-6 pt-4 pb-1 flex-row items-center gap-3' : 'px-6 pt-4 pb-1 gap-3'}
      >
        <View
          className="h-12 rounded-full flex-row items-center flex-1"
          style={{ backgroundColor: '#17171c' }}
        >
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={submitSearch}
            returnKeyType="search"
            autoFocus
            placeholder="Search books, authors or ISBNs"
            placeholderTextColor="#777783"
            className="flex-1 h-12 pl-5 pr-2 text-[15px] font-medium text-white"
          />
          <Pressable
            onPress={query.length ? clearSearch : submitSearch}
            accessibilityLabel={query.length ? 'Clear search' : 'Search'}
            accessibilityRole="button"
            className="h-12 w-14 items-center justify-center"
          >
            <Feather name={query.length ? 'x' : 'search'} size={20} color="#a7a7b3" />
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
          style={wideHeader ? { flexGrow: 0, maxWidth: Math.min(470, width * 0.42) } : undefined}
        >
          {FORMATS.map((item) => {
            const active = item.value === format;
            return (
              <Pressable
                key={item.label}
                onPress={() => setFormat(item.value)}
                className="h-8 px-4 rounded-full items-center justify-center"
                style={{ backgroundColor: active ? '#8b7cf6' : '#17171c' }}
              >
                <Text
                  className={
                    active
                      ? 'text-xs font-semibold text-white'
                      : 'text-xs font-medium text-neutral-400'
                  }
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <BookGridSkeleton />
      ) : error && books.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-sm text-red-400 text-center">{error}</Text>
        </View>
      ) : books.length ? (
        <BookGrid
          books={books}
          onPressBook={openBook}
          onEndReached={loadMore}
          ListFooterComponent={footer}
        />
      ) : searchedFor ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-sm text-neutral-500">No results for “{searchedFor}”.</Text>
        </View>
      ) : (
        <View className="flex-1 items-center justify-center pb-16">
          <Text className="text-xl font-medium text-neutral-500 mb-10">Search anything</Text>
          <View className="flex-row gap-12">
            {SEARCH_HINTS.map((hint) => (
              <View key={hint.label} className="items-center gap-3 w-20">
                <Feather name={hint.icon} size={38} color="#555560" />
                <Text className="text-sm text-neutral-500 text-center">{hint.label}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}
