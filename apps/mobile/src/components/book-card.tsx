import { Image } from 'expo-image';
import { memo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
  availableLocally?: boolean;
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
      style={({ pressed }) => ({
        width,
        opacity: pressed ? 0.7 : book.isRead ? 0.68 : 1,
      })}
    >
      <View style={[styles.cover, { width, height, backgroundColor: colors.surfaceRaised }]}>
        {activeCover ? (
          <Image
            source={{ uri: activeCover }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={activeCover}
            onError={() =>
              setFailedCovers((current) =>
                current.includes(activeCover) ? current : [...current, activeCover]
              )
            }
          />
        ) : allCoversFailed ? (
          <View style={styles.fallbackCover}>
            <Text style={styles.fallbackIcon}>📚</Text>
          </View>
        ) : book.metadataPending ? (
          <View style={[styles.fill, { backgroundColor: colors.surfaceRaised }]} />
        ) : (
          <View style={styles.fallbackCover}>
            <Text style={styles.fallbackIcon}>📚</Text>
          </View>
        )}
        {(book.availableLocally === false ||
          book.moonReader?.availableLocally === false) && (
          <View style={styles.notLocalBadge}>
            <Text style={styles.notLocalText}>Not local</Text>
          </View>
        )}
        <RatingChip rating={book.rating} />
        {typeof progress === 'number' && progress > 0 && (
          <>
            <View style={styles.progressTrack}>
              <View
                style={{
                  height: '100%',
                  width: `${Math.max(0, Math.min(100, progress))}%`,
                  backgroundColor: colors.accent,
                }}
              />
            </View>
            <View
              style={[
                styles.progressBadge,
                {
                  backgroundColor: book.isRead
                    ? colors.success
                    : colors.accentMuted,
                },
              ]}
            >
              <Text style={styles.progressText}>
                {book.isRead ? 'Read' : `${Math.max(1, Math.round(progress))}%`}
              </Text>
            </View>
          </>
        )}
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
  fill: {
    flex: 1,
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
    color: '#e5e5e5',
    fontSize: 9,
    fontWeight: '600',
  },
  progressTrack: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    height: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  progressBadge: {
    position: 'absolute',
    bottom: 12,
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
