import { Image } from 'expo-image';
import { Pressable, Text, View } from 'react-native';

export interface CardBook {
  id: string;
  title: string;
  author: string;
  cover: string;
  format?: string;
  year?: string | number;
}



interface Props {
  book: CardBook;
  onPress: (book: CardBook) => void;
  width: number;
}

export function BookCard({ book, onPress, width }: Props) {
  const height = Math.round(width * 1.5); // fixed 2:3 cover ratio

  return (
    <Pressable onPress={() => onPress(book)} style={{ width }} className="active:opacity-70">
      <View
        style={{ width, height, backgroundColor: '#e5e5e5' }}
        className="rounded-xl overflow-hidden dark:bg-neutral-800 mb-2"
      >
        {book.cover ? (
          <Image
            source={{ uri: book.cover }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            recyclingKey={book.cover}
            onError={(e) => {
              if (__DEV__) console.log('[image] failed:', book.cover, e.error ?? '');
            }}
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 28 }}>📚</Text>
          </View>
        )}
      </View>
      <Text numberOfLines={2} className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        {book.title || 'Untitled'}
      </Text>
      <Text numberOfLines={1} className="text-xs text-neutral-500 mt-0.5">
        {book.author}
      </Text>
      {(book.format || book.year) && (
        <Text className="text-[10px] uppercase tracking-wide text-neutral-400 mt-1">
          {[book.format, book.year].filter(Boolean).join(' · ')}
        </Text>
      )}
    </Pressable>
  );
}
