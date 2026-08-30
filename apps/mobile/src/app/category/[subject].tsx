import { Feather } from '@expo/vector-icons';
import type { BookMetadata } from '@tomeio/domain';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';

import { BookGrid, BookGridSkeleton, GridLoadingMore } from '@/components/book-grid';
import type { CardBook } from '@/components/book-card';
import { colors } from '@/components/app-ui';
import { IosNativeBackButton } from '@/components/ios-native-controls';
import { useExtensions } from '@/context/extensions-context';
import { bookPriceLabel, bookSourceUrl } from '@/lib/book-offers';

const PAGE_SIZE = 40;
const BG = colors.background;

interface CatalogBook extends CardBook {
  extensionId: string;
  metadata: BookMetadata;
}

function catalogBook(book: BookMetadata, extensionId: string): CatalogBook {
  return {
    id: `${extensionId}:${book.id}`,
    title: book.title,
    author: book.authors[0] || 'Unknown',
    cover: book.coverUrl || '',
    year: book.publishedYear,
    rating: book.rating,
    seriesPosition: book.seriesPosition,
    priceLabel: bookPriceLabel(book),
    sourceUrl: bookSourceUrl(book),
    extensionId,
    metadata: book,
  };
}

export default function CategoryScreen() {
  const router = useRouter();
  const extensions = useExtensions();
  const { subject, title, extensionId } = useLocalSearchParams<{
    subject: string;
    title?: string;
    extensionId?: string;
  }>();
  const requestGeneration = useRef(0);
  const [books, setBooks] = useState<CatalogBook[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestPage = useCallback(
    (nextPage: number) => {
      if (!extensionId) throw new Error('The discovery provider is unavailable.');
      return extensions.catalog(extensionId, {
        catalogId: subject,
        page: nextPage,
        limit: PAGE_SIZE,
        language: 'en',
      });
    },
    [extensionId, extensions, subject]
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
      const result = await requestPage(1);
      if (requestGeneration.current !== generation) return;
      setBooks(result.items.map((book) => catalogBook(book, extensionId!)));
      setPage(1);
      setHasMore(result.nextPage != null);
    } catch (err: any) {
      if (requestGeneration.current === generation) {
        setError(err.message || String(err));
      }
    } finally {
      if (requestGeneration.current === generation) setLoading(false);
    }
  }, [extensionId, requestPage]);

  useEffect(() => {
    const initialLoad = setTimeout(loadFirstPage, 0);
    return () => {
      clearTimeout(initialLoad);
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
      const result = await requestPage(nextPage);
      if (requestGeneration.current !== generation) return;
      setBooks((current) => {
        const seen = new Set(current.map((book) => book.id));
        const nextBooks = result.items.map((book) => catalogBook(book, extensionId!));
        return [...current, ...nextBooks.filter((book) => !seen.has(book.id))];
      });
      setPage(nextPage);
      setHasMore(result.nextPage != null);
    } catch (err: any) {
      if (requestGeneration.current === generation) setError(err.message || String(err));
    } finally {
      if (requestGeneration.current === generation) setLoadingMore(false);
    }
  }, [extensionId, hasMore, loading, loadingMore, page, requestPage]);

  const openBook = useCallback(
    (book: CatalogBook) => {
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

  const manifest = [
    ...extensions.thirdParty
      .filter((extension) => extension.enabled)
      .map((extension) => extension.manifest),
    ...extensions.bundled,
  ].find((candidate) => candidate.id === extensionId);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }, [router]);

  const footer = loadingMore ? (
    <GridLoadingMore />
  ) : error && books.length ? (
    <View className="items-center gap-2 py-5">
      <Text className="text-xs" style={{ color: colors.danger }}>{error}</Text>
      <Pressable onPress={loadMore}>
        <Text className="text-xs font-semibold" style={{ color: colors.accent }}>Retry</Text>
      </Pressable>
    </View>
  ) : null;

  return (
    <View className="flex-1" style={{ backgroundColor: BG }}>
      <View className="h-16 px-4 flex-row items-center gap-3">
        {Platform.OS === 'ios' ? (
          <IosNativeBackButton onPress={goBack} />
        ) : (
          <Pressable
            onPress={goBack}
            accessibilityLabel="Go back"
            accessibilityRole="button"
            className="h-10 w-10 shrink-0 rounded-full items-center justify-center"
            style={{ backgroundColor: colors.surface }}
          >
            <Feather name="chevron-left" color={colors.text} size={21} />
          </Pressable>
        )}
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          className="min-w-0 flex-1 text-lg font-semibold"
          style={{ color: colors.text }}
        >
          {title || subject}
        </Text>
      </View>
      {manifest?.attribution ? (
        <Pressable
          onPress={() => void Linking.openURL(manifest.attribution!.url)}
          accessibilityRole="link"
          className="px-5 pb-3"
        >
          {manifest.attribution.imageUrl ? (
            <Image
              source={{ uri: manifest.attribution.imageUrl }}
              accessibilityLabel={manifest.attribution.label}
              contentFit="contain"
              style={{ width: 62, height: 30 }}
            />
          ) : (
            <Text className="text-[11px] font-medium" style={{ color: colors.textMuted }}>
              {manifest.attribution.label}
            </Text>
          )}
        </Pressable>
      ) : null}

      {loading ? (
        <BookGridSkeleton />
      ) : error && books.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-2 px-8">
          <Text className="text-sm text-center" style={{ color: colors.danger }}>{error}</Text>
          <Pressable onPress={loadFirstPage}>
            <Text className="text-sm font-semibold" style={{ color: colors.accent }}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <BookGrid
          books={books}
          onPressBook={openBook}
          onEndReached={loadMore}
          ListFooterComponent={footer}
          ListEmptyComponent={
            <Text
              className="text-sm text-center mt-12"
              style={{ color: colors.textMuted }}
            >
              No books available.
            </Text>
          }
        />
      )}
    </View>
  );
}
