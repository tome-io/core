import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { BookGrid, BookGridSkeleton, GridLoadingMore } from '@/components/book-grid';
import { toDiscoveryBook } from '@/components/poster';
import {
  getSubjectPage,
  getTrendingPage,
  type FeedBook,
} from '@/lib/openlibrary';

const PAGE_SIZE = 48;
const BG = '#0b0b0f';

export default function CategoryScreen() {
  const router = useRouter();
  const { subject, title } = useLocalSearchParams<{ subject: string; title?: string }>();
  const requestGeneration = useRef(0);
  const [books, setBooks] = useState<FeedBook[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestPage = useCallback(
    (nextPage: number) =>
      subject === 'trending'
        ? getTrendingPage(nextPage, PAGE_SIZE)
        : getSubjectPage(subject, nextPage, PAGE_SIZE),
    [subject]
  );

  const loadFirstPage = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setBooks([]);
    setPage(0);
    setHasMore(true);
    try {
      const results = await requestPage(1);
      if (requestGeneration.current !== generation) return;
      setBooks(results);
      setPage(1);
      setHasMore(results.length === PAGE_SIZE);
    } catch (err: any) {
      if (requestGeneration.current === generation) {
        setError(err.message || String(err));
      }
    } finally {
      if (requestGeneration.current === generation) setLoading(false);
    }
  }, [requestPage]);

  useEffect(() => {
    loadFirstPage();
    return () => {
      requestGeneration.current += 1;
    };
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore || page < 1) return;
    const generation = requestGeneration.current;
    setLoadingMore(true);
    setError(null);
    try {
      const nextPage = page + 1;
      const results = await requestPage(nextPage);
      if (requestGeneration.current !== generation) return;
      setBooks((current) => {
        const seen = new Set(current.map((book) => book.id));
        return [...current, ...results.filter((book) => !seen.has(book.id))];
      });
      setPage(nextPage);
      setHasMore(results.length === PAGE_SIZE);
    } catch (err: any) {
      if (requestGeneration.current === generation) setError(err.message || String(err));
    } finally {
      if (requestGeneration.current === generation) setLoadingMore(false);
    }
  }, [hasMore, loading, loadingMore, page, requestPage]);

  const openBook = useCallback(
    (book: FeedBook) => {
      router.push({
        pathname: '/book/[id]',
        params: {
          id: book.id,
          ext: JSON.stringify(toDiscoveryBook(book, title || subject)),
        },
      });
    },
    [router, subject, title]
  );

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }, [router]);

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
    <View className="flex-1" style={{ backgroundColor: BG }}>
      <View className="h-16 px-4 flex-row items-center gap-3">
        <Pressable
          onPress={goBack}
          accessibilityLabel="Go back"
          accessibilityRole="button"
          className="h-10 w-10 rounded-full items-center justify-center bg-[#17171c]"
        >
          <Feather name="chevron-left" color="#d4d4d8" size={21} />
        </Pressable>
        <Text className="text-lg font-semibold text-neutral-100">{title || subject}</Text>
      </View>

      {loading ? (
        <BookGridSkeleton />
      ) : error && books.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-2 px-8">
          <Text className="text-sm text-red-400 text-center">{error}</Text>
          <Pressable onPress={loadFirstPage}>
            <Text className="text-sm font-semibold text-[#8b7cf6]">Retry</Text>
          </Pressable>
        </View>
      ) : (
        <BookGrid
          books={books}
          onPressBook={openBook}
          onEndReached={loadMore}
          ListFooterComponent={footer}
          ListEmptyComponent={
            <Text className="text-sm text-neutral-500 text-center mt-12">
              No books available.
            </Text>
          }
        />
      )}
    </View>
  );
}
