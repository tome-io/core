import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BookGrid, GridLoadingMore } from '@/components/book-grid';
import { fetchEbooks, type ExternalBook } from '@/lib/books-api';

interface Category {
  label: string;
  query: string;
}

const CATEGORIES: Category[] = [
  { label: 'Popular now', query: 'bestseller' },
  { label: 'Fiction', query: 'fiction' },
  { label: 'Sci-Fi & Fantasy', query: 'science fiction fantasy' },
  { label: 'Mystery & Thriller', query: 'mystery thriller' },
  { label: 'Romance', query: 'romance' },
  { label: 'Self-improvement', query: 'self help' },
  { label: 'Business', query: 'business' },
  { label: 'Science', query: 'science' },
  { label: 'History', query: 'history' },
  { label: 'Philosophy', query: 'philosophy' },
  { label: 'Psychology', query: 'psychology' },
  { label: 'Programming', query: 'programming' },
];

const PAGE_SIZE = 20;

export default function DiscoverScreen() {
  const router = useRouter();
  const [category, setCategory] = useState<Category>(CATEGORIES[0]);
  const [books, setBooks] = useState<ExternalBook[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cat: Category) => {
    setLoading(true);
    setError(null);
    try {
      // Apple's API has no pagination — one generous fetch, revealed in pages
      const results = await fetchEbooks(cat.query, 60);
      setBooks(results);
      setVisibleCount(Math.min(PAGE_SIZE, results.length));
      setHasMore(results.length > PAGE_SIZE);
    } catch (err: any) {
      setError(err.message || String(err));
      setBooks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(CATEGORIES[0]);
  }, [load]);

  const selectCategory = useCallback(
    (cat: Category) => {
      if (cat.label === category.label && books.length > 0) return;
      setCategory(cat);
      load(cat);
    },
    [books.length, category.label, load]
  );

  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;
    const next = Math.min(visibleCount + PAGE_SIZE, books.length);
    setVisibleCount(next);
    if (next >= books.length) setHasMore(false);
  }, [books.length, hasMore, loading, visibleCount]);

  const visibleBooks = useMemo(() => books.slice(0, visibleCount), [books, visibleCount]);

  const openBook = useCallback(
    (book: ExternalBook) => {
      router.push({
        pathname: '/book/[id]',
        params: { id: book.id, ext: JSON.stringify(book) },
      });
    },
    [router]
  );

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-neutral-950" edges={['top']}>
      <View className="px-4 pt-2">
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={CATEGORIES}
          keyExtractor={(c) => c.label}
          ItemSeparatorComponent={() => <View className="w-2" />}
          renderItem={({ item }) => {
            const active = item.label === category.label;
            return (
              <Text
                onPress={() => selectCategory(item)}
                className={
                  active
                    ? 'px-3 py-1.5 rounded-full text-xs font-semibold bg-rose-600 text-white'
                    : 'px-3 py-1.5 rounded-full text-xs font-medium bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
                }
              >
                {item.label}
              </Text>
            );
          }}
        />
      </View>

      <View className="flex-row items-center justify-between px-4 mt-4 mb-3">
        <Text className="text-lg font-bold text-neutral-900 dark:text-neutral-50">{category.label}</Text>
        <Text className="text-xs text-neutral-400">Apple Books</Text>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center gap-3">
          <ActivityIndicator color="#e11d48" />
          <Text className="text-sm text-neutral-400">Loading recommendations…</Text>
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-8 gap-2">
          <Text className="text-sm text-red-500 text-center">{error}</Text>
          <Text onPress={() => load(category)} className="text-sm font-semibold text-rose-600 mt-2">
            Tap to retry
          </Text>
        </View>
      ) : (
        <BookGrid
          books={visibleBooks as any}
          onPressBook={openBook}
          onEndReached={loadMore}
          onRefresh={() => load(category)}
          refreshing={loading}
          ListFooterComponent={hasMore ? <GridLoadingMore /> : null}
          ListEmptyComponent={
            <Text className="text-sm text-neutral-400 text-center mt-12">Nothing here yet.</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}
