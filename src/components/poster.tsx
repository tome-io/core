import { Image } from 'expo-image';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';

import type { DiscoveryBook, FeedBook } from '@/lib/openlibrary';
import { RatingChip } from './rating-chip';

const PANEL = '#17171c';
const ACCENT = '#8b7cf6';
const PLACEHOLDER = '#1b1b22';

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
  return (
    <Pressable
      onPress={() => onPress(book)}
      style={{ width }}
      className="active:opacity-80"
    >
      <View
        style={{ width, height: Math.round(width * 1.5), backgroundColor: PANEL }}
        className="rounded-lg overflow-hidden mb-2"
      >
        {book.cover ? (
          <Image
            source={{ uri: book.cover }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
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
      </View>
      <Text numberOfLines={1} className="text-[11px] font-medium text-neutral-200">
        {book.title}
      </Text>
      <Text numberOfLines={1} className="text-[10px] text-neutral-500 mt-0.5">
        {book.author}
      </Text>
    </Pressable>
  );
}

export function PosterSkeleton({ width = 124 }: { width?: number }) {
  return (
    <View style={{ width }}>
      <View
        style={{ width, height: Math.round(width * 1.5), backgroundColor: PLACEHOLDER }}
        className="rounded-lg mb-2"
      />
      <View
        className="h-2.5 rounded-full mb-2"
        style={{ width: '72%', backgroundColor: PLACEHOLDER }}
      />
      <View
        className="h-2 rounded-full"
        style={{ width: '48%', backgroundColor: PLACEHOLDER }}
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
      <View className="flex-row items-center justify-between px-6 mb-3">
        <Text className="text-sm font-bold uppercase tracking-widest text-neutral-400">
          {title}
        </Text>
        {onSeeAll && (
          <Pressable
            onPress={onSeeAll}
            accessibilityRole="button"
            className="h-8 px-2 flex-row items-center justify-center rounded-full active:bg-[#17171c]"
          >
            <Text style={{ color: ACCENT }} className="text-xs font-medium">
              See all ›
            </Text>
          </Pressable>
        )}
      </View>
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
              <Text className="text-xs font-semibold" style={{ color: ACCENT }}>
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
