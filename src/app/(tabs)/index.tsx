import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BookGrid, GridLoadingMore } from '@/components/book-grid';
import { searchBooks, type Book } from '@/lib/zlib';

interface Category {
  label: string;
  query: string;
}

const CATEGORIES: Category[] = [
  { label: 'Popular now', query: 'bestseller' },
  { label: 'Fiction', query: 'fiction novel' },
  { label: 'Sci-Fi & Fantasy', query: 'science fiction fantasy' },
  { label: 'Mystery & Thriller', query: 'mystery thriller' },
  { label: 'Self-improvement', query: 'self improvement habits' },
  { label: 'Business', query: 'business entrepreneurship' },
  { label: 'Science', query: 'science physics biology' },
  { label: 'History', query: 'history biography' },
  { label: 'Philosophy', query: 'philosophy' },
  { label: 'Psychology', query: 'psychology mind' },
  { label: 'Programming', query: 'programming computer science' },
  { label: 'Cooking', query: 'cookbook recipes' },
];

export default function DiscoverScreen() {
  const router = useRouter();
  const [category, setCategory] = useState<Category>(CATEGORIES[0]);
  const [books, setBooks] = useState<Book[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (cat: Category, pageNum: number): Promise<Book[]> =>
      searchBooks(cat.query, pageNum, '', 'popular'),
    []
  );

  const load = useCallback(
    async (cat: Category) => {
      setLoading(true);
      setError(null);
      setPage(1);
      setHasMore(true);
      try {
        const results = await fetchPage(cat, 1);
        setBooks(results);
        if (results.length === 0) setHasMore(false);
      } catch (err: any) {
        setError(err.message || String(err));
        setBooks([]);
      } finally {
        setLoading(false);
      }
    },
    [fetchPage]
  );

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

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore || error) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const results = await fetchPage(category, next);
      setPage(next);
      setBooks((prev) => [...prev, ...results]);
      if (results.length === 0) setHasMore(false);
    } catch {
      /* transient failure; user can keep scrolling to retry */
    } finally {
      setLoadingMore(false);
    }
  }, [category, error, fetchPage, hasMore, loading, loadingMore, page]);

  const openBook = useCallback(
    (book: Book) => {
      router.push({ pathname: '/book/[id]', params: { id: book.id, item: JSON.stringify(book) } });
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
        <Text className="text-xs text-neutral-400">from Z-Library</Text>
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
          books={books}
          onPressBook={openBook}
          onEndReached={loadMore}
          onRefresh={() => load(category)}
          refreshing={loading}
          ListFooterComponent={loadingMore ? <GridLoadingMore /> : null}
          ListEmptyComponent={
            <Text className="text-sm text-neutral-400 text-center mt-12">Nothing here yet.</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}
