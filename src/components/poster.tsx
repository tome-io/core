import { Image } from 'expo-image';
import { FlatList, Pressable, Text, View } from 'react-native';

import type { FeedBook } from '@/lib/openlibrary';
import type { ExternalBook } from '@/lib/books-api';

const PANEL = '#17171c';
const ACCENT = '#8b7cf6';

export function toExternalBook(b: FeedBook): ExternalBook {
  return {
    id: b.id,
    title: b.title,
    author: b.author,
    cover: b.cover,
    description: '',
    year: String(b.year ?? ''),
    genre: 'Open Library',
  };
}

export function PosterCard({
  book,
  onPress,
  width = 124,
}: {
  book: FeedBook;
  onPress: (book: FeedBook) => void;
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
      </View>
      <Text numberOfLines={1} className="text-[11px] font-medium text-neutral-200">
        {book.title}
      </Text>
      <Text numberOfLines={1} className="text-[10px] text-neutral-500">
        {book.author}
      </Text>
    </Pressable>
  );
}

/** Stremio-style horizontal rail with a section title. */
export function Rail({
  title,
  books,
  onPressBook,
  onSeeAll,
}: {
  title: string;
  books: FeedBook[];
  onPressBook: (book: FeedBook) => void;
  onSeeAll?: () => void;
}) {
  if (books.length === 0) return null;
  return (
    <View className="mb-8">
      <View className="flex-row items-center justify-between px-6 mb-3">
        <Text className="text-sm font-bold uppercase tracking-widest text-neutral-400">
          {title}
        </Text>
        {onSeeAll && (
          <Text onPress={onSeeAll} style={{ color: ACCENT }} className="text-xs">
            See all ›
          </Text>
        )}
      </View>
      <FlatList
        data={books}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 24, gap: 16 }}
        keyExtractor={(b) => b.id}
        renderItem={({ item }) => <PosterCard book={item} onPress={onPressBook} />}
      />
    </View>
  );
}
