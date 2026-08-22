import { ActivityIndicator, FlatList, RefreshControl, useWindowDimensions, View } from 'react-native';
import type { ReactElement } from 'react';

import { BookCard } from './book-card';
import type { Book } from '@/lib/zlib';

const COLUMNS = 4;
const COLUMN_GAP = 12;
const ROW_GAP = 16;

interface BookGridProps {
  books: Book[];
  onPressBook: (book: Book) => void;
  onEndReached?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  ListFooterComponent?: ReactElement | null;
  ListEmptyComponent?: ReactElement;
}

/**
 * Edge-to-edge 4-column cover grid. Cards touch both screen edges; spacing
 * only exists *between* cards.
 */
export function BookGrid({
  books,
  onPressBook,
  onEndReached,
  onRefresh,
  refreshing = false,
  ListFooterComponent,
  ListEmptyComponent,
}: BookGridProps) {
  const { width } = useWindowDimensions();
  const cardWidth = (width - COLUMN_GAP * (COLUMNS - 1)) / COLUMNS;

  return (
    <FlatList
      data={books}
      keyExtractor={(b, i) => `${b.id}-${b.hash}-${i}`}
      numColumns={COLUMNS}
      columnWrapperStyle={{ gap: COLUMN_GAP }}
      contentContainerStyle={{ gap: ROW_GAP, paddingBottom: 32 }}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e11d48" colors={['#e11d48']} />
        ) : undefined
      }
      renderItem={({ item }) => <BookCard book={item} width={cardWidth} onPress={onPressBook} />}
      ListEmptyComponent={ListEmptyComponent}
      ListFooterComponent={ListFooterComponent ?? null}
    />
  );
}

export function GridLoadingMore() {
  return (
    <View style={{ paddingVertical: 16, alignItems: 'center' }}>
      <ActivityIndicator color="#e11d48" />
    </View>
  );
}
