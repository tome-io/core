import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { BookGrid, BookGridSkeleton } from '@/components/book-grid';
import { CatalogToolbar, type CatalogOption } from '@/components/catalog-toolbar';
import { DismissibleToast } from '@/components/dismissible-toast';
import {
  LibraryActionsSheet,
  type LibraryAction,
} from '@/components/library-book-actions';
import { useLibrary } from '@/context/library-context';
import { detailParams, type LibraryBook } from '@/lib/library';
import { openInMoonReader } from '@/lib/moon-reader-launcher';

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
  const {
    downloaded,
    ready,
    scanning,
    error,
    warning,
    dismissWarning,
    showWarning,
    deleteLocalBook,
    markAsRead,
    refreshBookMetadata,
    refreshLocalBooks,
  } = useLibrary();
  const [format, setFormat] = useState<FormatFilter>('all');
  const [sort, setSort] = useState<LibrarySort>('recent');
  const [selectedBook, setSelectedBook] = useState<LibraryBook | null>(null);
  const [busyAction, setBusyAction] = useState<LibraryAction | null>(null);

  const books = useMemo(() => {
    const filtered = downloaded.filter((book) => {
      const bookFormat = book.format?.toLowerCase() || '';
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

  const runAction = useCallback(
    async (action: LibraryAction, operation: () => Promise<void>) => {
      setBusyAction(action);
      try {
        await operation();
        setSelectedBook(null);
      } catch (err: any) {
        showWarning(err.message || String(err));
      } finally {
        setBusyAction(null);
      }
    },
    [showWarning]
  );

  const confirmDelete = useCallback(() => {
    if (!selectedBook?.local) return;
    Alert.alert(
      'Delete local file?',
      `This permanently deletes “${selectedBook.title}” from the selected storage folder.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void runAction('delete', () => deleteLocalBook(selectedBook)),
        },
      ]
    );
  }, [deleteLocalBook, runAction, selectedBook]);

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
          onLongPressBook={setSelectedBook}
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
      {!!selectedBook && (
        <LibraryActionsSheet
          book={selectedBook}
          visible
          busyAction={busyAction}
          onClose={() => setSelectedBook(null)}
          onOpen={() => void runAction('open', () => openInMoonReader(selectedBook))}
          onDelete={confirmDelete}
          onMarkRead={() => void runAction('read', () => markAsRead(selectedBook))}
          onRefreshMetadata={() =>
            void runAction('metadata', () => refreshBookMetadata(selectedBook))
          }
        />
      )}
      {!!warning && <DismissibleToast message={warning} onDismiss={dismissWarning} />}
    </View>
  );
}
