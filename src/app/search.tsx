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
    <View className="flex-1" style={{ backgroundColor: '#0b0b0f' }}>
      <View className="px-4 pt-2 gap-3">
        <View className="flex-row items-center gap-2">
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => runSearch(query, format)}
            returnKeyType="search"
            placeholder="Search Z-Library…"
            placeholderTextColor="#6b6b76"
            className="flex-1 h-11 px-4 rounded-xl text-white" style={{ backgroundColor: '#17171c' }}
          />
          <Pressable
            onPress={() => runSearch(query, format)}
            className="h-11 px-4 rounded-xl items-center justify-center active:opacity-80" style={{ backgroundColor: '#8b7cf6' }}
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
                className="px-3 py-1.5 rounded-full"
                style={active ? { backgroundColor: '#8b7cf6' } : { backgroundColor: '#17171c' }}
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
    </View>
  );
}
