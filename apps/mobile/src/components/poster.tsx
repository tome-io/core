import { Image } from 'expo-image';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';

import { colors, SectionHeader } from '@/components/app-ui';
import type { DiscoveryBook, FeedBook } from '@/lib/openlibrary';
import { RatingChip } from './rating-chip';

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
      style={{ width }}
      className="active:opacity-80"
    >
      <View
        style={{ width, height: Math.round(width * 1.5), backgroundColor: colors.surfaceRaised }}
        className="rounded-lg overflow-hidden mb-2"
      >
        {book.cover ? (
          <Image
            source={{ uri: book.cover }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={200}
          />
        ) : (
          <View className="flex-1 items-center justify-center px-2">
            <Text numberOfLines={3} className="text-[11px] font-semibold text-neutral-500 text-center">
              {book.title}
            </Text>
          </View>
        )}
        <RatingChip rating={book.rating} />
        {progress > 0 ? (
          <>
            <View className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/70">
              <View
                className="h-full"
                style={{ width: `${progress}%`, backgroundColor: colors.accent }}
              />
            </View>
            <View
              className="absolute bottom-2 left-1.5 rounded-md px-1.5 py-1"
              style={{
                backgroundColor: progressBook.isRead
                  ? colors.success
                  : 'rgba(73, 63, 145, 0.95)',
              }}
            >
              <Text className="text-[9px] font-bold text-white">
                {progressBook.isRead ? 'Read' : `${Math.max(1, Math.round(progress))}%`}
              </Text>
            </View>
          </>
        ) : null}
      </View>
      <Text numberOfLines={1} className="text-[13px] font-medium" style={{ color: colors.text }}>
        {book.title}
      </Text>
      <Text numberOfLines={1} className="mt-0.5 text-[11px]" style={{ color: colors.textMuted }}>
        {book.author}
      </Text>
    </Pressable>
  );
}

export function PosterSkeleton({ width = 124 }: { width?: number }) {
  return (
    <View style={{ width }}>
      <View
        style={{ width, height: Math.round(width * 1.5), backgroundColor: colors.surfaceRaised }}
        className="rounded-lg mb-2"
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
  );
}

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
  return (
    <View className="mb-8">
      <SectionHeader title={title} actionLabel={onSeeAll ? 'See all' : undefined} onAction={onSeeAll} />
      {loading ? (
        <ScrollView
          horizontal
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 24, gap: 16 }}
        >
          {Array.from({ length: 8 }, (_, index) => (
            <PosterSkeleton key={index} />
          ))}
        </ScrollView>
      ) : error ? (
        <View className="px-6 h-20 justify-center items-start gap-1">
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
          contentContainerStyle={{ paddingHorizontal: 24, gap: 16 }}
          keyExtractor={(b) => b.id}
          renderItem={({ item }) => <PosterCard book={item} onPress={onPressBook} />}
        />
      ) : (
        <View className="px-6 h-20 justify-center">
          <Text className="text-xs text-neutral-500">{emptyLabel}</Text>
        </View>
      )}
    </View>
  );
}
