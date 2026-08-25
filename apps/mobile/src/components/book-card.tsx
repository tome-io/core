import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { colors } from '@/components/app-ui';
import { RatingChip } from './rating-chip';

export interface CardBook {
  id: string;
  title: string;
  author: string;
  cover: string;
  fallbackCover?: string;
  format?: string;
  year?: string | number;
  rating?: number;
  metadataPending?: boolean;
  progress?: number;
  isRead?: boolean;
  moonReader?: { availableLocally?: boolean };
}

interface Props {
  book: CardBook;
  onPress: (book: CardBook) => void;
  onLongPress?: (book: CardBook) => void;
  width: number;
}

export function BookCard({ book, onPress, onLongPress, width }: Props) {
  const height = Math.round(width * 1.5); // fixed 2:3 cover ratio
  const progress = book.isRead ? 100 : book.progress;
  const longPressed = useRef(false);
  const [failedCovers, setFailedCovers] = useState<string[]>([]);
  const coverCandidates = [book.cover, book.fallbackCover].filter(
    (cover, index, covers): cover is string => !!cover && covers.indexOf(cover) === index
  );
  const activeCover = coverCandidates.find(
    (cover): cover is string => !!cover && !failedCovers.includes(cover)
  );
  const allCoversFailed =
    coverCandidates.length > 0 && coverCandidates.every((cover) => failedCovers.includes(cover));

  return (
    <Pressable
      onPressIn={() => {
        longPressed.current = false;
      }}
      onLongPress={() => {
        if (!onLongPress) return;
        longPressed.current = true;
        onLongPress(book);
      }}
      onPress={() => {
        if (!longPressed.current) onPress(book);
        longPressed.current = false;
      }}
      delayLongPress={350}
      style={{ width, opacity: book.isRead ? 0.68 : 1 }}
      className="active:opacity-70"
    >
      <View
        style={{ width, height, backgroundColor: colors.surfaceRaised }}
        className="rounded-lg overflow-hidden mb-2"
      >
        {activeCover ? (
          <Image
            source={{ uri: activeCover }}
            style={{ width: '100%', height: '100%' }}
            contentFit="contain"
            cachePolicy="memory-disk"
            recyclingKey={activeCover}
            onError={() =>
              setFailedCovers((current) =>
                current.includes(activeCover) ? current : [...current, activeCover]
              )
            }
          />
        ) : allCoversFailed ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 28 }}>📚</Text>
          </View>
        ) : book.metadataPending ? (
          <View className="flex-1" style={{ backgroundColor: colors.surfaceRaised }} />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 28 }}>📚</Text>
          </View>
        )}
        {book.moonReader?.availableLocally === false && (
          <View className="absolute left-1.5 top-1.5 rounded-md bg-black/80 px-1.5 py-1">
            <Text className="text-[9px] font-semibold text-neutral-200">Not local</Text>
          </View>
        )}
        <RatingChip rating={book.rating} />
        {typeof progress === 'number' && progress > 0 && (
          <>
            <View className="absolute left-0 right-0 bottom-0 h-1.5 bg-black/80">
              <View
                className="h-full"
                style={{
                  width: `${Math.max(0, Math.min(100, progress))}%`,
                  backgroundColor: colors.accent,
                }}
              />
            </View>
            <View
              className="absolute left-1.5 bottom-3 rounded-md px-1.5 py-1"
              style={{
                backgroundColor: book.isRead ? colors.success : 'rgba(73, 63, 145, 0.95)',
              }}
            >
              <Text className="text-[9px] font-bold text-white">
                {book.isRead ? 'Read' : `${Math.max(1, Math.round(progress))}%`}
              </Text>
            </View>
          </>
        )}
      </View>
      <Text numberOfLines={1} className="text-[13px] font-medium" style={{ color: colors.text }}>
        {book.title || 'Untitled'}
      </Text>
      <Text numberOfLines={1} className="mt-0.5 text-[11px]" style={{ color: colors.textMuted }}>
        {book.author}
      </Text>
      {(book.format || book.year) && (
        <Text
          numberOfLines={1}
          className="mt-1 text-[10px] uppercase tracking-wide"
          style={{ color: colors.textMuted }}
        >
          {[book.format, book.year].filter(Boolean).join(' · ')}
        </Text>
      )}
    </Pressable>
  );
}
