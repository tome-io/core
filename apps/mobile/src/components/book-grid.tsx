import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  type LayoutChangeEvent,
  RefreshControl,
  useWindowDimensions,
  View,
} from 'react-native';

import { colors } from '@/components/app-ui';
import { BookCard, type CardBook } from './book-card';

const SIDEBAR_WIDTH = 76;
const IDEAL_CARD_WIDTH = 124;
const HORIZONTAL_PADDING = 24;
const COLUMN_GAP = 16;
const ROW_GAP = 24;
const MIN_COLUMNS = 2;

function getGridMetrics(width: number) {
  const innerWidth = Math.max(0, width - HORIZONTAL_PADDING * 2);
  const columns = Math.max(
    MIN_COLUMNS,
    Math.floor((innerWidth + COLUMN_GAP) / (IDEAL_CARD_WIDTH + COLUMN_GAP))
  );
  const cardWidth = (innerWidth - COLUMN_GAP * (columns - 1)) / columns;
  return { columns, cardWidth };
}

function useGridMetrics() {
  const { width: windowWidth } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const width = measuredWidth || Math.max(0, windowWidth - SIDEBAR_WIDTH);
  const metrics = useMemo(() => getGridMetrics(width), [width]);
  const onLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    if (nextWidth > 0 && nextWidth !== measuredWidth) setMeasuredWidth(nextWidth);
  };
  return { ...metrics, onLayout };
}

interface BookGridProps<T extends CardBook> {
  books: T[];
  onPressBook: (book: T) => void;
  onLongPressBook?: (book: T) => void;
  onEndReached?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  ListFooterComponent?: ReactElement | null;
  ListEmptyComponent?: ReactElement;
}

export function BookGrid<T extends CardBook>({
  books,
  onPressBook,
  onLongPressBook,
  onEndReached,
  onRefresh,
  refreshing = false,
  ListFooterComponent,
  ListEmptyComponent,
}: BookGridProps<T>) {
  const { columns, cardWidth, onLayout } = useGridMetrics();

  return (
    <FlatList<T>
      key={`book-grid-${columns}`}
      data={books}
      onLayout={onLayout}
      keyExtractor={(book, index) => `${book.id}-${(book as any).hash ?? ''}-${index}`}
      numColumns={columns}
      columnWrapperStyle={{ gap: COLUMN_GAP }}
      contentContainerStyle={{
        gap: ROW_GAP,
        paddingHorizontal: HORIZONTAL_PADDING,
        paddingTop: 20,
        paddingBottom: 40,
      }}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.7}
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        ) : undefined
      }
      renderItem={({ item }) => (
        <BookCard
          book={item}
          width={cardWidth}
          onPress={() => onPressBook(item)}
          onLongPress={onLongPressBook ? () => onLongPressBook(item) : undefined}
        />
      )}
      ListEmptyComponent={ListEmptyComponent}
      ListFooterComponent={ListFooterComponent ?? null}
    />
  );
}

export function BookGridSkeleton({ count = 18 }: { count?: number }) {
  const { columns, cardWidth, onLayout } = useGridMetrics();
  const rows = Math.ceil(count / columns);

  return (
    <View
      className="flex-1"
      onLayout={onLayout}
      style={{ paddingHorizontal: HORIZONTAL_PADDING, paddingTop: 20, gap: ROW_GAP }}
    >
      {Array.from({ length: rows }, (_, row) => (
        <View key={row} className="flex-row" style={{ gap: COLUMN_GAP }}>
          {Array.from({ length: columns }, (_, column) => (
            <View key={column} style={{ width: cardWidth }}>
              <View
                className="rounded-lg mb-2"
                style={{
                  width: cardWidth,
                  height: Math.round(cardWidth * 1.5),
                  backgroundColor: colors.surfaceRaised,
                }}
              />
              <View
                className="h-2.5 rounded-full mb-2"
                style={{ width: '72%', backgroundColor: colors.surfaceRaised }}
              />
              <View
                className="h-2 rounded-full"
                style={{ width: '48%', backgroundColor: colors.surfaceRaised }}
              />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

export function GridLoadingMore() {
  return (
    <View style={{ paddingVertical: 20, alignItems: 'center' }}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}
