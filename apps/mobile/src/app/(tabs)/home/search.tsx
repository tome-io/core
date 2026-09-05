import { Feather } from '@expo/vector-icons';
import type { BookMetadata } from '@tomeio/domain';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Linking,
  Platform,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { BookGrid, BookGridSkeleton, GridLoadingMore } from '@/components/book-grid';
import type { CardBook } from '@/components/book-card';
import { colors, SearchField, usePageGutter } from '@/components/app-ui';
import { IosNativeBackButton } from '@/components/ios-native-controls';
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
    seriesPosition: book.seriesPosition,
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
  const [subject, setSubject] = useState('');
  const [searchedSubject, setSearchedSubject] = useState('');
  const [subjectPickerOpen, setSubjectPickerOpen] = useState(false);
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
  const subjectOptions = [
    { label: 'All genres', value: '' },
    ...(searchManifest?.resources.find((resource) => resource.name === 'search')?.subjectFilters ?? [])
      .map((filter) => ({ label: filter.name, value: filter.id })),
  ];


  useEffect(() => {
    setSearchActive(true);
    return () => setSearchActive(false);
  }, [setSearchActive]);

  const runSearch = useCallback(async (q: string, fmt: string, generation: number, genre = '') => {
    const cleanQuery = q.trim();
    if (cleanQuery.length < 2 && !genre) return;
    setLoading(true);
    setLoadingMore(false);
    setBooks([]);
    setError(null);
    setSearchedFor(cleanQuery);
    setSearchedFormat(fmt);
    setSearchedSubject(genre);
    try {
      if (!extensions.searchExtensionId) {
        throw new Error('Choose an enabled search provider in Add-ons first.');
      }
      const result = await extensions.search(extensions.searchExtensionId, {
        query: cleanQuery,
        page: 1,
        limit: 25,
        format: fmt || undefined,
        subject: genre || undefined,
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
  }, [extensions.search, extensions.searchExtensionId]);

  useEffect(() => {
    const routeQuery = typeof params.q === 'string' ? params.q : '';
    const timeout = setTimeout(() => {
      setQuery((current) => (current === routeQuery ? current : routeQuery));
      const cleanQuery = routeQuery.trim();
      setSubject('');
      setSearchedSubject('');
      setBooks([]);
      setSearchedFor('');
      setLoading(false);
      searchGeneration.current += 1;
      if (cleanQuery.length < 2) return;
      const generation = ++searchGeneration.current;
      setLoadingMore(false);
      void runSearch(cleanQuery, '', generation);
    }, 0);
    return () => clearTimeout(timeout);
  }, [params.q, runSearch]);

  const submitSearch = useCallback(() => {
    if (query.trim().length < 2 && !subject) return;
    Keyboard.dismiss();
    const generation = ++searchGeneration.current;
    runSearch(query, format, generation, subject);
  }, [format, query, runSearch, subject]);

  const selectFormat = useCallback(
    (nextFormat: string) => {
      setFormat(nextFormat);
      if (query.trim().length < 2 && !subject) return;
      Keyboard.dismiss();
      const generation = ++searchGeneration.current;
      setLoadingMore(false);
      void runSearch(query, nextFormat, generation, subject);
    },
    [query, runSearch, subject]
  );

  const selectSubject = (nextSubject: string) => {
    setSubject(nextSubject);
    setSubjectPickerOpen(false);
    Keyboard.dismiss();
    const generation = ++searchGeneration.current;
    if (!nextSubject && query.trim().length < 2) {
      setBooks([]); setSearchedFor(''); setSearchedSubject('');
      setLoading(false); setLoadingMore(false); setError(null);
      return;
    }
    void runSearch(query, format, generation, nextSubject);
  };

  const clearSearch = useCallback(() => {
    searchGeneration.current += 1;
    setQuery('');
    setSubject('');
    setSearchedSubject('');
    setBooks([]);
    setError(null);
    setSearchedFor('');
    setHasMore(true);
    setLoading(false);
    setLoadingMore(false);
  }, []);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || (!searchedFor && !searchedSubject) || !hasMore) return;
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
        subject: searchedSubject || undefined,
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
  }, [extensions, hasMore, loading, loadingMore, page, searchedFor, searchedFormat, searchedSubject]);

  const openBook = useCallback(
    (book: SearchBook) => {
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

  const footer = loadingMore ? (
    <GridLoadingMore />
  ) : error && books.length ? (
    <View className="items-center gap-2 py-5">
      <Text className="text-xs" style={{ color: colors.danger }}>{error}</Text>
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
        {Platform.OS === 'ios' ? (
          <IosNativeBackButton onPress={() => router.dismissTo('/home')} />
        ) : (
          <Pressable
            onPress={() => router.dismissTo('/home')}
            accessibilityLabel="Back to home"
            className="h-12 w-12 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: colors.surfaceRaised }}
          >
            <Feather name="chevron-left" size={22} color={colors.textMuted} />
          </Pressable>
        )}
        <SearchField
          value={query}
          onChangeText={(value) => {
            if (value) setQuery(value);
            else if (subject) { setQuery(''); void runSearch('', format, ++searchGeneration.current, subject); }
            else clearSearch();
          }}
          onSearch={submitSearch}
          returnKeyType="search"
          autoFocus={!params.q}
          placeholder="Search books, authors or ISBNs"
        />
        <CatalogSelect
          label="Format"
          value={selectedFormat.label}
          onPress={() => setFormatPickerOpen(true)}
          options={FORMATS}
          selectedValue={format}
          onSelect={selectFormat}
          style={{ width: width >= 700 ? 148 : 112, flexShrink: 0 }}
        />
      </View>
      <View style={{ paddingHorizontal: gutter, paddingBottom: 12 }}>
        {subjectOptions.length > 1 ? <CatalogSelect label="Genre"
          value={subjectOptions.find((option) => option.value === subject)?.label ?? 'All genres'}
          options={subjectOptions} selectedValue={subject} onSelect={selectSubject}
          onPress={() => setSubjectPickerOpen(true)} style={{ width: '100%' }} />
          : searchManifest ? <Text className="text-xs" style={{ color: colors.textMuted }}>Genre filters are not available from {searchManifest.name}.</Text> : null}
      </View>
      <CatalogOptionsDialog visible={Platform.OS !== 'ios' && subjectPickerOpen}
        title="Genre" options={subjectOptions} selectedValue={subject} onSelect={selectSubject}
        onClose={() => setSubjectPickerOpen(false)} />
      <CatalogOptionsDialog
        visible={Platform.OS !== 'ios' && formatPickerOpen}
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
          <Text className="text-sm text-center" style={{ color: colors.danger }}>{error}</Text>
        </View>
      ) : books.length ? (
        <BookGrid
          books={books}
          onPressBook={openBook}
          onEndReached={loadMore}
          ListFooterComponent={footer}
        />
      ) : searchedFor || searchedSubject ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-sm" style={{ color: colors.textMuted }}>
            {searchedFor ? `No results for “${searchedFor}” with these filters.` : 'No books found in this genre.'}
          </Text>
        </View>
      ) : (
        <View className="flex-1 items-center justify-center pb-16">
          <Text className="text-xl font-medium mb-10" style={{ color: colors.textMuted }}>
            Search anything
          </Text>
          <View className="flex-row gap-12">
            {SEARCH_HINTS.map((hint) => (
              <View key={hint.label} className="items-center gap-3 w-20">
                <Feather name={hint.icon} size={38} color={colors.textMuted} />
                <Text className="text-sm text-center" style={{ color: colors.textMuted }}>
                  {hint.label}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}
