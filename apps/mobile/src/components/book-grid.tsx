import type { ReactElement } from 'react';
import { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, MOBILE_NAV_HEIGHT, usePageGutter } from '@/components/app-ui';
import { BookCard, type CardBook } from './book-card';
import { SkeletonPulse } from './skeleton-pulse';

const SIDEBAR_WIDTH = 76;
const IDEAL_CARD_WIDTH = 108;
const COLUMN_GAP = 12;
const ROW_GAP = 20;
const MIN_COLUMNS = 3;

function getGridMetrics(width: number, horizontalPadding: number) {
  const innerWidth = Math.max(0, width - horizontalPadding * 2);
  const columns = Math.max(
    MIN_COLUMNS,
    Math.floor((innerWidth + COLUMN_GAP) / (IDEAL_CARD_WIDTH + COLUMN_GAP))
  );
  const cardWidth = Math.max(0, (innerWidth - COLUMN_GAP * (columns - 1)) / columns);
  return { columns, cardWidth };
}

function useGridMetrics() {
  const { width: windowWidth } = useWindowDimensions();
  const { width: safeAreaWidth } = useSafeAreaFrame();
  const insets = useSafeAreaInsets();
  const horizontalPadding = usePageGutter();
  const compactNav = windowWidth < 700;
  const availableWidth = Math.max(0, safeAreaWidth - insets.left - insets.right);
  const width = compactNav ? availableWidth : Math.max(0, availableWidth - SIDEBAR_WIDTH);
  const metrics = useMemo(
    () => getGridMetrics(width, horizontalPadding),
    [horizontalPadding, width]
  );
  return {
    ...metrics,
    horizontalPadding,
    bottomPadding: compactNav ? MOBILE_NAV_HEIGHT + 24 : 40,
  };
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
  const { columns, cardWidth, horizontalPadding, bottomPadding } = useGridMetrics();
  const contentContainerStyle = useMemo(
    () => ({
      gap: ROW_GAP,
      paddingHorizontal: horizontalPadding,
      paddingTop: 8,
      paddingBottom: bottomPadding,
    }),
    [bottomPadding, horizontalPadding]
  );
  const renderItem = useCallback(
    ({ item }: { item: T }) => (
      <BookCard
        book={item}
        width={cardWidth}
        onPress={() => onPressBook(item)}
        onLongPress={onLongPressBook ? () => onLongPressBook(item) : undefined}
      />
    ),
    [cardWidth, onLongPressBook, onPressBook]
  );

  return (
    <FlatList<T>
      key={`book-grid-${columns}`}
      data={books}
      style={{ flex: 1 }}
      keyExtractor={(book) => book.id}
      numColumns={columns}
      columnWrapperStyle={{ gap: COLUMN_GAP }}
      contentContainerStyle={contentContainerStyle}
      initialNumToRender={9}
      maxToRenderPerBatch={9}
      windowSize={7}
      updateCellsBatchingPeriod={50}
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
      renderItem={renderItem}
      ListEmptyComponent={ListEmptyComponent}
      ListFooterComponent={ListFooterComponent ?? null}
    />
  );
}

export function BookGridSkeleton({ count }: { count?: number }) {
  const { columns, cardWidth, horizontalPadding } = useGridMetrics();
  const itemCount = count ?? Math.min(18, columns * 3);
  const rows = Math.ceil(itemCount / columns);

  return (
    <SkeletonPulse style={[styles.skeletonContainer, { paddingHorizontal: horizontalPadding }]}>
      {Array.from({ length: rows }, (_, row) => (
        <View key={row} style={styles.skeletonRow}>
          {Array.from(
            { length: Math.min(columns, itemCount - row * columns) },
            (_, column) => (
              <View key={column} style={{ width: cardWidth }}>
                <View
                  style={[
                    styles.skeletonCover,
                    {
                      width: cardWidth,
                      height: Math.round(cardWidth * 1.5),
                      backgroundColor: colors.surfaceRaised,
                    },
                  ]}
                />
                <View
                  style={[styles.skeletonTitle, { backgroundColor: colors.surfaceRaised }]}
                />
                <View
                  style={[styles.skeletonAuthor, { backgroundColor: colors.surfaceRaised }]}
                />
              </View>
            )
          )}
        </View>
      ))}
    </SkeletonPulse>
  );
}

export function GridLoadingMore() {
  return (
    <View style={{ paddingVertical: 20, alignItems: 'center' }}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonContainer: {
    flex: 1,
    gap: ROW_GAP,
    paddingTop: 8,
  },
  skeletonRow: {
    flexDirection: 'row',
    gap: COLUMN_GAP,
  },
  skeletonCover: {
    marginBottom: 8,
    borderRadius: 8,
  },
  skeletonTitle: {
    width: '72%',
    height: 10,
    marginBottom: 8,
    borderRadius: 999,
  },
  skeletonAuthor: {
    width: '48%',
    height: 8,
    borderRadius: 999,
  },
});
