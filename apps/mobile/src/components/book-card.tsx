import { Image } from 'expo-image';
import { memo, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/components/app-ui';
import { CoverProgress } from './cover-progress';
import { RatingChip } from './rating-chip';
import { SeriesPositionChip } from './series-position-chip';

export interface CardBook {
  id: string;
  title: string;
  author: string;
  cover: string;
  fallbackCover?: string;
  format?: string;
  year?: string | number;
  rating?: number;
  seriesPosition?: number;
  priceLabel?: string;
  sourceUrl?: string;
  metadataPending?: boolean;
  metadataUpdatedAt?: number;
  progress?: number;
  isRead?: boolean;
  availableLocally?: boolean;
  fileUri?: string;
  local?: { uri: string };
  moonReader?: { availableLocally?: boolean };
}

interface Props {
  book: CardBook;
  onPress: (book: CardBook) => void;
  onLongPress?: (book: CardBook) => void;
  width: number;
}

export const BookCard = memo(function BookCard({ book, onPress, onLongPress, width }: Props) {
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
  const localReference = book.local?.uri ?? book.fileUri;
  const isNotLocal =
    book.availableLocally === false ||
    book.moonReader?.availableLocally === false ||
    (!localReference && book.moonReader?.availableLocally !== true);

  useEffect(() => {
    setFailedCovers([]);
  }, [book.cover, book.fallbackCover, book.metadataUpdatedAt]);

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
      style={({ pressed }) => ({
        width,
        opacity: pressed ? 0.7 : book.isRead ? 0.68 : 1,
      })}
    >
      <View style={[styles.cover, { width, height, backgroundColor: colors.surfaceRaised }]}>
        <View style={styles.fallbackCover}>
          <Text style={styles.fallbackIcon}>📚</Text>
        </View>
        {activeCover ? (
          <Image
            source={{ uri: activeCover }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={activeCover}
            onError={() =>
              setFailedCovers((current) =>
                current.includes(activeCover) ? current : [...current, activeCover]
              )
            }
          />
        ) : null}
        {isNotLocal && (
          <View style={styles.notLocalBadge}>
            <Text style={styles.notLocalText}>Not local</Text>
          </View>
        )}
        <RatingChip rating={book.rating} />
        <SeriesPositionChip position={book.seriesPosition} />
        {book.sourceUrl && book.priceLabel ? (
          <Pressable
            accessibilityLabel={`${book.priceLabel}; open source`}
            accessibilityRole="link"
            onPress={(event) => {
              event.stopPropagation();
              void Linking.openURL(book.sourceUrl!);
            }}
            style={styles.priceBadge}
          >
            <Text numberOfLines={1} style={styles.priceText}>
              {book.priceLabel}
            </Text>
          </Pressable>
        ) : null}
        <CoverProgress progress={progress} isRead={book.isRead} />
      </View>
      <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.title, { width }]}>
        {book.title || 'Untitled'}
      </Text>
      <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.author, { width }]}>
        {book.author}
      </Text>
      {(book.format || book.year) && (
        <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.metadata, { width }]}>
          {[book.format, book.year].filter(Boolean).join(' · ')}
        </Text>
      )}
    </Pressable>
  );
});

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
  },
  fallbackIcon: {
    fontSize: 28,
  },
  notLocalBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  notLocalText: {
    color: colors.text,
    fontSize: 9,
    fontWeight: '600',
  },
  priceBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    maxWidth: '82%',
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.84)',
  },
  priceText: {
    color: colors.text,
    fontSize: 10,
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
  metadata: {
    flexShrink: 1,
    overflow: 'hidden',
    marginTop: 4,
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.25,
    textTransform: 'uppercase',
  },
});
