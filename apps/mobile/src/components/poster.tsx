import { Image } from 'expo-image';
import { useCallback } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, SectionHeader, usePageGutter } from '@/components/app-ui';
import type { DiscoveryBook, FeedBook } from '@/lib/openlibrary';
import { RatingChip } from './rating-chip';
import { SkeletonPulse } from './skeleton-pulse';

export function toDiscoveryBook(b: FeedBook, genre = 'Open Library'): DiscoveryBook {
  return {
    id: b.id,
    title: b.title,
    author: b.author,
    cover: b.cover,
    description: b.description,
    year: String(b.year ?? ''),
    genre,
    rating: b.rating,
    ratingsCount: b.ratingsCount,
  };
}

export function PosterCard<T extends FeedBook>({
  book,
  onPress,
  width = 124,
}: {
  book: T;
  onPress: (book: T) => void;
  width?: number;
}) {
  const progressBook = book as T & { progress?: number; isRead?: boolean };
  const progress = progressBook.isRead
    ? 100
    : Math.max(0, Math.min(100, progressBook.progress ?? 0));

  return (
    <Pressable
      onPress={() => onPress(book)}
      style={({ pressed }) => ({ width, opacity: pressed ? 0.8 : 1 })}
    >
      <View
        style={[
          styles.cover,
          { width, height: Math.round(width * 1.5), backgroundColor: colors.surfaceRaised },
        ]}
      >
        {book.cover ? (
          <Image
            source={{ uri: book.cover }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={book.cover}
            transition={150}
          />
        ) : (
          <View style={styles.fallbackCover}>
            <Text numberOfLines={3} style={styles.fallbackTitle}>
              {book.title}
            </Text>
          </View>
        )}
        <RatingChip rating={book.rating} />
        {progress > 0 ? (
          <>
            <View style={styles.progressTrack}>
              <View
                style={{ height: '100%', width: `${progress}%`, backgroundColor: colors.accent }}
              />
            </View>
            <View
              style={[
                styles.progressBadge,
                {
                  backgroundColor: progressBook.isRead
                    ? colors.success
                    : colors.accentMuted,
                },
              ]}
            >
              <Text style={styles.progressText}>
                {progressBook.isRead ? 'Read' : `${Math.max(1, Math.round(progress))}%`}
              </Text>
            </View>
          </>
        ) : null}
      </View>
      <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.title, { width }]}>
        {book.title}
      </Text>
      <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.author, { width }]}>
        {book.author}
      </Text>
    </Pressable>
  );
}

export function PosterSkeleton({ width = 124 }: { width?: number }) {
  return (
    <View style={{ width }}>
      <View
        style={[
          styles.skeletonCover,
          { width, height: Math.round(width * 1.5), backgroundColor: colors.surfaceRaised },
        ]}
      />
      <View style={[styles.skeletonTitle, { backgroundColor: colors.surfaceRaised }]} />
      <View style={[styles.skeletonAuthor, { backgroundColor: colors.surfaceRaised }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    marginBottom: 8,
    overflow: 'hidden',
    borderRadius: 8,
  },
  fallbackCover: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  fallbackTitle: {
    color: '#737373',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  progressTrack: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    height: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  progressBadge: {
    position: 'absolute',
    bottom: 8,
    left: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
  },
  progressText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
  },
  title: {
    flexShrink: 1,
    overflow: 'hidden',
    color: colors.text,
    fontSize: 13,
    fontWeight: '500',
  },
  author: {
    flexShrink: 1,
    overflow: 'hidden',
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 11,
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

/** Stremio-style horizontal rail with a section title. */
export function Rail<T extends FeedBook>({
  title,
  books,
  loading = false,
  error,
  onPressBook,
  onSeeAll,
  onRetry,
  emptyLabel = 'No books available.',
}: {
  title: string;
  books: T[];
  loading?: boolean;
  error?: string | null;
  onPressBook: (book: T) => void;
  onSeeAll?: () => void;
  onRetry?: () => void;
  emptyLabel?: string;
}) {
  const gutter = usePageGutter();
  const renderPoster = useCallback(
    ({ item }: { item: T }) => <PosterCard book={item} onPress={onPressBook} />,
    [onPressBook]
  );
  return (
    <View className="mb-8">
      <SectionHeader title={title} actionLabel={onSeeAll ? 'See all' : undefined} onAction={onSeeAll} />
      {loading ? (
        <SkeletonPulse>
          <ScrollView
            horizontal
            scrollEnabled={false}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: gutter, gap: 16 }}
          >
            {Array.from({ length: 8 }, (_, index) => (
              <PosterSkeleton key={index} />
            ))}
          </ScrollView>
        </SkeletonPulse>
      ) : error ? (
        <View className="h-20 justify-center items-start gap-1" style={{ paddingHorizontal: gutter }}>
          <Text numberOfLines={2} className="text-xs text-red-400">
            {error}
          </Text>
          {onRetry && (
            <Pressable onPress={onRetry}>
              <Text className="text-xs font-semibold" style={{ color: colors.accent }}>
                Retry
              </Text>
            </Pressable>
          )}
        </View>
      ) : books.length ? (
        <FlatList
          data={books}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: gutter, gap: 16 }}
          keyExtractor={(book) => book.id}
          initialNumToRender={6}
          maxToRenderPerBatch={4}
          windowSize={3}
          renderItem={renderPoster}
        />
      ) : (
        <View className="h-20 justify-center" style={{ paddingHorizontal: gutter }}>
          <Text className="text-xs text-neutral-500">{emptyLabel}</Text>
        </View>
      )}
    </View>
  );
}
