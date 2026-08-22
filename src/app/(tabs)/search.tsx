import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BookGrid, GridLoadingMore } from '@/components/book-grid';
import { useSettings } from '@/context/settings-context';
import { searchBooks, type Book } from '@/lib/zlib';

const FORMATS = [
  { label: 'Any', value: '' },
  { label: 'EPUB', value: 'epub' },
  { label: 'PDF', value: 'pdf' },
  { label: 'MOBI', value: 'mobi' },
  { label: 'AZW3', value: 'azw3' },
];

export default function SearchScreen() {
  const router = useRouter();
  const { settings } = useSettings();
  const [query, setQuery] = useState('');
  const [format, setFormat] = useState(settings.preferredFormat);
  const [books, setBooks] = useState<Book[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchedFor, setSearchedFor] = useState('');

  const runSearch = useCallback(
    async (q: string, fmt: string) => {
      if (!q.trim()) return;
      Keyboard.dismiss();
      setLoading(true);
      setError(null);
      setSearchedFor(q.trim());
      try {
        const results = await searchBooks(q.trim(), 1, fmt);
        setBooks(results);
        setPage(1);
      } catch (err: any) {
        setError(err.message || String(err));
        setBooks([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const loadMore = useCallback(async () => {
    if (loadingMore || !searchedFor) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const results = await searchBooks(searchedFor, next, format);
      setPage(next);
      setBooks((prev) => [...prev, ...results]);
    } catch {
      /* silently stop paging */
    } finally {
      setLoadingMore(false);
    }
  }, [format, loadingMore, page, searchedFor]);

  const openBook = useCallback(
    (book: Book) => {
      router.push({ pathname: '/book/[id]', params: { id: book.id, item: JSON.stringify(book) } });
    },
    [router]
  );

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-neutral-950" edges={['top']}>
      <View className="px-4 pt-2 gap-3">
        <View className="flex-row items-center gap-2">
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => runSearch(query, format)}
            returnKeyType="search"
            placeholder="Search Z-Library…"
            placeholderTextColor="#a3a3a3"
            className="flex-1 h-11 px-4 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
          />
          <Pressable
            onPress={() => runSearch(query, format)}
            className="h-11 px-4 rounded-xl bg-rose-600 items-center justify-center active:bg-rose-700"
          >
            <Text className="text-white font-semibold">Search</Text>
          </Pressable>
        </View>

        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={FORMATS}
          keyExtractor={(f) => f.label}
          ItemSeparatorComponent={() => <View className="w-2" />}
          renderItem={({ item }) => {
            const active = item.value === format;
            return (
              <Pressable
                onPress={() => setFormat(item.value)}
                className={
                  active
                    ? 'px-3 py-1.5 rounded-full bg-neutral-900 dark:bg-white'
                    : 'px-3 py-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800'
                }
              >
                <Text
                  className={
                    active
                      ? 'text-xs font-semibold text-white dark:text-neutral-900'
                      : 'text-xs font-medium text-neutral-600 dark:text-neutral-300'
                  }
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          }}
        />
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center gap-3">
          <ActivityIndicator color="#e11d48" />
          <Text className="text-sm text-neutral-400">Searching…</Text>
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-sm text-red-500 text-center">{error}</Text>
        </View>
      ) : books.length === 0 && searchedFor ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-sm text-neutral-400">No results for “{searchedFor}”.</Text>
        </View>
      ) : (
        <BookGrid
          books={books}
          onPressBook={openBook}
          onEndReached={loadMore}
          ListFooterComponent={loadingMore ? <GridLoadingMore /> : null}
          ListEmptyComponent={
            <Text className="text-sm text-neutral-400 text-center mt-12">
              No results for “{searchedFor}”.
            </Text>
          }
        />
      )}
    </SafeAreaView>
  );
}
