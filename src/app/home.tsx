import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { PosterCard, Rail, toExternalBook } from '@/components/poster';
import { getSubject, getTrending, type FeedBook } from '@/lib/openlibrary';

const ACCENT = '#8b7cf6';
const BG = '#0b0b0f';

const RAILS: { title: string; subject: string }[] = [
  { title: 'Fantasy', subject: 'fantasy' },
  { title: 'Science Fiction', subject: 'science-fiction' },
  { title: 'Romance', subject: 'romance' },
  { title: 'Mystery & Crime', subject: 'mystery' },
  { title: 'Historical Fiction', subject: 'historical-fiction' },
  { title: 'Self-Help', subject: 'self-help' },
  { title: 'Business', subject: 'business' },
  { title: 'Science', subject: 'science' },
];

export default function HomeScreen() {
  const router = useRouter();
  const [trending, setTrending] = useState<FeedBook[]>([]);
  const [rails, setRails] = useState<Record<string, FeedBook[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const trend = await getTrending('daily', 40);
      setTrending(trend);
      // Rails load in parallel; each fails independently
      const results = await Promise.all(
        RAILS.map(async ({ subject }) => ({
          subject,
          books: await getSubject(subject, 24).catch(() => []),
        }))
      );
      setRails(Object.fromEntries(results.map((r) => [r.subject, r.books])));
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openBook = useCallback(
    (book: FeedBook) => {
      router.push({
        pathname: '/book/[id]',
        params: { id: book.id, ext: JSON.stringify(toExternalBook(book)) },
      });
    },
    [router]
  );

  return (
    <View className="flex-1" style={{ backgroundColor: BG }}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {loading && (
          <View className="items-center py-24">
            <Text className="text-sm text-neutral-500">Loading feeds…</Text>
          </View>
        )}

        {!!error && !loading && (
          <View className="items-center px-8 py-20 gap-2">
            <Text className="text-sm text-red-400 text-center">{error}</Text>
            <Pressable onPress={load}>
              <Text style={{ color: ACCENT }} className="text-sm font-semibold">
                Retry
              </Text>
            </Pressable>
          </View>
        )}

        {/* Trending rail */}
        {!loading && !error && (
          <Rail
            title="Trending this week"
            books={trending.slice(0, 24)}
            onPressBook={openBook}
          />
        )}

        {/* Category rails */}
        {!loading &&
          !error &&
          RAILS.map(({ title, subject }) => (
            <Rail
              key={subject}
              title={title}
              books={rails[subject] ?? []}
              onPressBook={openBook}
            />
          ))}
      </ScrollView>
    </View>
  );
}
