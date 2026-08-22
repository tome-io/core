import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { BookGrid, BookGridSkeleton } from '@/components/book-grid';
import { CatalogToolbar, type CatalogOption } from '@/components/catalog-toolbar';
import { useLibrary } from '@/context/library-context';
import { detailParams, type LibraryBook } from '@/lib/library';

const BG = '#0b0b0f';
type FormatFilter = 'all' | 'read' | 'epub' | 'pdf' | 'mobi' | 'azw3' | 'other';
type LibrarySort = 'recent' | 'title' | 'author' | 'rating' | 'progress';

const FILTERS: CatalogOption<FormatFilter>[] = [
  { label: 'All', value: 'all' },
  { label: 'Read', value: 'read' },
  { label: 'EPUB', value: 'epub' },
  { label: 'PDF', value: 'pdf' },
  { label: 'MOBI', value: 'mobi' },
  { label: 'AZW3', value: 'azw3' },
  { label: 'Other', value: 'other' },
];

const SORTS: CatalogOption<LibrarySort>[] = [
  { label: 'Recent', value: 'recent' },
  { label: 'A–Z', value: 'title' },
  { label: 'Author', value: 'author' },
  { label: 'Rating', value: 'rating' },
  { label: 'Progress', value: 'progress' },
];

const MAIN_FORMATS = new Set(['epub', 'pdf', 'mobi', 'azw3']);

export default function LibraryScreen() {
  const router = useRouter();
  const { downloaded, ready, scanning, error, refreshLocalBooks } = useLibrary();
  const [format, setFormat] = useState<FormatFilter>('all');
  const [sort, setSort] = useState<LibrarySort>('recent');

  const books = useMemo(() => {
    const filtered = downloaded.filter((book) => {
      const bookFormat = book.format?.toLowerCase() || book.zlib?.format?.toLowerCase() || '';
      if (format === 'all') return true;
      if (format === 'read') return book.isRead === true;
      if (format === 'other') return !MAIN_FORMATS.has(bookFormat);
      return bookFormat === format;
    });
    return filtered.sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title);
      if (sort === 'author') return a.author.localeCompare(b.author);
      if (sort === 'rating') return (b.rating ?? -1) - (a.rating ?? -1);
      if (sort === 'progress') return (b.progress ?? -1) - (a.progress ?? -1);
      return (b.downloadedAt ?? b.addedAt) - (a.downloadedAt ?? a.addedAt);
    });
  }, [downloaded, format, sort]);

  const openBook = useCallback(
    (book: LibraryBook) => router.push(detailParams(book) as any),
    [router]
  );

  const loading = !ready || (scanning && downloaded.length === 0);

  return (
    <View className="flex-1" style={{ backgroundColor: BG }}>
      <CatalogToolbar
        filters={FILTERS}
        selectedFilter={format}
        onFilter={setFormat}
        sorts={SORTS}
        selectedSort={sort}
        onSort={setSort}
      />
      {!!error && <Text className="px-6 py-2 text-xs leading-4 text-red-400">{error}</Text>}
      {loading ? (
        <BookGridSkeleton />
      ) : (
        <BookGrid
          books={books}
          onPressBook={openBook}
          onRefresh={() => void refreshLocalBooks()}
          refreshing={scanning}
          ListEmptyComponent={
            <Text className="mt-20 px-8 text-center text-sm text-neutral-500">
              {downloaded.length
                ? 'No books match this format.'
                : 'Books in your selected folder will appear here.'}
            </Text>
          }
        />
      )}
    </View>
  );
}
