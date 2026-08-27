import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { colors, usePageGutter } from '@/components/app-ui';
import { BookGrid, BookGridSkeleton } from '@/components/book-grid';
import { CatalogToolbar, type CatalogOption } from '@/components/catalog-toolbar';
import {
  useLibraryReadingList,
  useLibraryUiStatus,
} from '@/context/library-context';
import { detailParams, type LibraryBook } from '@/lib/library';

type ReadingSort = 'recent' | 'title' | 'author' | 'rating';

const SORTS: CatalogOption<ReadingSort>[] = [
  { label: 'Recently added', value: 'recent' },
  { label: 'A–Z', value: 'title' },
  { label: 'Author', value: 'author' },
  { label: 'Rating', value: 'rating' },
];

export default function ReadingListScreen() {
  const gutter = usePageGutter();
  const router = useRouter();
  const { readingList, ready } = useLibraryReadingList();
  const { error } = useLibraryUiStatus();
  const [genre, setGenre] = useState('all');
  const [sort, setSort] = useState<ReadingSort>('recent');

  const filters = useMemo<CatalogOption<string>[]>(() => {
    const genres = [...new Set(readingList.map((book) => book.genre).filter(Boolean))].sort();
    return [{ label: 'All', value: 'all' }, ...genres.map((value) => ({ label: value, value }))];
  }, [readingList]);

  const books = useMemo(() => {
    const filtered = readingList.filter((book) => genre === 'all' || book.genre === genre);
    return filtered.sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title);
      if (sort === 'author') return a.author.localeCompare(b.author);
      if (sort === 'rating') return (b.rating ?? -1) - (a.rating ?? -1);
      return b.addedAt - a.addedAt;
    });
  }, [genre, readingList, sort]);

  const openBook = useCallback(
    (book: LibraryBook) => router.push(detailParams(book) as any),
    [router]
  );

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <CatalogToolbar
        filterLabel="Category"
        filters={filters}
        selectedFilter={genre}
        onFilter={setGenre}
        sorts={SORTS}
        selectedSort={sort}
        onSort={setSort}
        sortLabel="Sort by"
      />
      {!!error && (
        <Text className="py-2 text-xs leading-4 text-red-400" style={{ paddingHorizontal: gutter }}>
          {error}
        </Text>
      )}
      {!ready ? (
        <BookGridSkeleton />
      ) : (
        <BookGrid
          books={books}
          onPressBook={openBook}
          ListEmptyComponent={
            <Text className="mt-20 px-8 text-center text-sm text-neutral-500">
              {readingList.length ? 'No books match this category.' : 'Books you save for later will appear here.'}
            </Text>
          }
        />
      )}
    </View>
  );
}
