import { Image } from 'expo-image';
import { Pressable, Text, View } from 'react-native';

import { RatingChip } from './rating-chip';

export interface CardBook {
  id: string;
  title: string;
  author: string;
  cover: string;
  format?: string;
  year?: string | number;
  rating?: number;
  metadataPending?: boolean;
  progress?: number;
  isRead?: boolean;
}

interface Props {
  book: CardBook;
  onPress: (book: CardBook) => void;
  width: number;
}

export function BookCard({ book, onPress, width }: Props) {
  const height = Math.round(width * 1.5); // fixed 2:3 cover ratio
  const progress = book.isRead ? 100 : book.progress;

  return (
    <Pressable
      onPress={() => onPress(book)}
      style={{ width, opacity: book.isRead ? 0.68 : 1 }}
      className="active:opacity-70"
    >
      <View
        style={{ width, height, backgroundColor: '#17171c' }}
        className="rounded-lg overflow-hidden mb-2"
      >
        {book.cover ? (
          <Image
            source={{ uri: book.cover }}
            style={{ width: '100%', height: '100%' }}
            contentFit="contain"
            cachePolicy="memory-disk"
            recyclingKey={book.cover}
            onError={(e) => {
              if (__DEV__) console.log('[image] failed:', book.cover, e.error ?? '');
            }}
          />
        ) : book.metadataPending ? (
          <View className="flex-1 bg-[#1b1b22]" />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 28 }}>📚</Text>
          </View>
        )}
        <RatingChip rating={book.rating} />
        {book.isRead && (
          <View className="absolute left-1.5 top-1.5 rounded-md px-1.5 py-1 bg-emerald-600/95">
            <Text className="text-[9px] font-bold uppercase text-white">✓ Read</Text>
          </View>
        )}
        {typeof progress === 'number' && progress > 0 && (
          <View className="absolute left-1.5 right-1.5 bottom-1.5 h-1.5 overflow-hidden rounded-full bg-black/70">
            <View
              className="h-full rounded-full bg-[#8b7cf6]"
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </View>
        )}
      </View>
      <Text numberOfLines={1} className="text-[11px] font-medium text-neutral-200">
        {book.title || 'Untitled'}
      </Text>
      <Text numberOfLines={1} className="text-[10px] text-neutral-500 mt-0.5">
        {book.author}
      </Text>
      {(book.format || book.year) && (
        <Text numberOfLines={1} className="text-[9px] uppercase tracking-wide text-neutral-500 mt-1">
          {[book.format, book.year].filter(Boolean).join(' · ')}
        </Text>
      )}
    </Pressable>
  );
}
