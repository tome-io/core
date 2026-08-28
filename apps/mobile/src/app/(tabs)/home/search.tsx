import { Feather } from '@expo/vector-icons';
import type { BookMetadata } from '@tomeio/domain';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Linking,
  Pressable,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { BookGrid, BookGridSkeleton, GridLoadingMore } from '@/components/book-grid';
import type { CardBook } from '@/components/book-card';
import { colors, usePageGutter } from '@/components/app-ui';
import {
  CatalogOptionsDialog,
  CatalogSelect,
} from '@/components/catalog-toolbar';
import { useExtensions } from '@/context/extensions-context';
import { bookPriceLabel, bookSourceUrl } from '@/lib/book-offers';
import { useHomeNavigation } from '@/context/home-navigation-context';

const FORMATS = [
  { label: 'All', value: '' },
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
    priceLabel: bookPriceLabel(book),
    sourceUrl: bookSourceUrl(book),
    extensionId,
    metadata: book,
  };
}

export default function SearchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string }>();
  const extensions = useExtensions();
  const { setSearchActive } = useHomeNavigation();
  const gutter = usePageGutter();
  const { width } = useWindowDimensions();
  const searchGeneration = useRef(0);
  const [query, setQuery] = useState(params.q ?? '');
  const [format, setFormat] = useState('');
  const [formatPickerOpen, setFormatPickerOpen] = useState(false);
  const [books, setBooks] = useState<SearchBook[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchedFor, setSearchedFor] = useState('');
  const [searchedFormat, setSearchedFormat] = useState('');
  const selectedFormat = FORMATS.find((option) => option.value === format) ?? FORMATS[0];
  const searchManifest = useMemo(() => {
    const manifests = [
      ...extensions.thirdParty
        .filter((extension) => extension.enabled)
        .map((extension) => extension.manifest),
      ...extensions.bundled,
    ];
    return manifests.find((manifest) => manifest.id === extensions.searchExtensionId) ?? null;
  }, [extensions.bundled, extensions.searchExtensionId, extensions.thirdParty]);

  useEffect(() => {
    setSearchActive(true);
    return () => setSearchActive(false);
  }, [setSearchActive]);

  const runSearch = useCallback(async (q: string, fmt: string, generation: number) => {
    const cleanQuery = q.trim();
    if (cleanQuery.length < 2) return;
    setLoading(true);
    setError(null);
    setSearchedFor(cleanQuery);
    setSearchedFormat(fmt);
    try {
      if (!extensions.searchExtensionId) {
        throw new Error('Choose an enabled search provider in Add-ons first.');
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
    const routeQuery = typeof params.q === 'string' ? params.q : '';
    setQuery((current) => (current === routeQuery ? current : routeQuery));
    const cleanQuery = routeQuery.trim();
    if (cleanQuery.length < 2) return;
    const generation = ++searchGeneration.current;
    setLoadingMore(false);
    void runSearch(cleanQuery, '', generation);
  }, [params.q, runSearch]);

  const submitSearch = useCallback(() => {
    if (query.trim().length < 2) return;
    Keyboard.dismiss();
    const generation = ++searchGeneration.current;
    runSearch(query, format, generation);
  }, [format, query, runSearch]);

  const selectFormat = useCallback(
    (nextFormat: string) => {
      setFormat(nextFormat);
      if (query.trim().length < 2) return;
      Keyboard.dismiss();
      const generation = ++searchGeneration.current;
      setLoadingMore(false);
      void runSearch(query, nextFormat, generation);
    },
    [query, runSearch]
  );

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
        throw new Error('Choose an enabled search provider in Add-ons first.');
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
        <Text className="text-xs font-semibold" style={{ color: colors.accent }}>
          Retry
        </Text>
      </Pressable>
    </View>
  ) : null;

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <View
        style={{
          flexGrow: 0,
          flexShrink: 0,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingTop: 12,
          paddingBottom: 8,
          paddingHorizontal: gutter,
        }}
      >
        <Pressable
          onPress={() => router.dismissTo('/home')}
          accessibilityLabel="Back to home"
          className="h-12 w-12 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: colors.surfaceRaised }}
        >
          <Feather name="chevron-left" size={22} color={colors.textMuted} />
        </Pressable>
        <View
          className="h-12 min-w-0 flex-1 flex-row items-center rounded-full"
          style={{ backgroundColor: colors.surfaceRaised }}
        >
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={submitSearch}
            returnKeyType="search"
            autoFocus={!params.q}
            placeholder="Search books, authors or ISBNs"
            placeholderTextColor={colors.textMuted}
            className="h-12 min-w-0 flex-1 pl-5 pr-2 text-[15px] font-medium text-white"
          />
          {query.length ? (
            <Pressable
              onPress={clearSearch}
              accessibilityLabel="Clear search"
              accessibilityRole="button"
              className="h-12 w-10 items-center justify-center"
            >
              <Feather name="x" size={19} color={colors.textMuted} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={submitSearch}
            disabled={query.trim().length < 2 || loading}
            accessibilityLabel="Search"
            accessibilityRole="button"
            accessibilityState={{ disabled: query.trim().length < 2 || loading }}
            className="h-12 w-12 items-center justify-center disabled:opacity-40"
          >
            <Feather name="search" size={20} color={colors.textMuted} />
          </Pressable>
        </View>
        <CatalogSelect
          label="Format"
          value={selectedFormat.label}
          onPress={() => setFormatPickerOpen(true)}
          style={{ width: width >= 700 ? 148 : 112, flexShrink: 0 }}
        />
      </View>
      <CatalogOptionsDialog
        visible={formatPickerOpen}
        title="Format"
        options={FORMATS}
        selectedValue={format}
        onSelect={selectFormat}
        onClose={() => setFormatPickerOpen(false)}
      />
      {searchManifest?.attribution && books.length ? (
        <Pressable
          onPress={() => void Linking.openURL(searchManifest.attribution!.url)}
          accessibilityRole="link"
          style={{ paddingHorizontal: gutter, paddingBottom: 8 }}
        >
          {searchManifest.attribution.imageUrl ? (
            <Image
              source={{ uri: searchManifest.attribution.imageUrl }}
              accessibilityLabel={searchManifest.attribution.label}
              contentFit="contain"
              style={{ width: 62, height: 30 }}
            />
          ) : (
            <Text className="text-[11px] font-medium" style={{ color: colors.textMuted }}>
              {searchManifest.attribution.label}
            </Text>
          )}
        </Pressable>
      ) : null}

      {loading && books.length === 0 ? (
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
                <Feather name={hint.icon} size={38} color={colors.textMuted} />
                <Text className="text-sm text-neutral-500 text-center">{hint.label}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}
