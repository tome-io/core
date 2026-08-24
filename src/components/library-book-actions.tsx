import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { ActivityIndicator, Modal, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { LibraryBook } from '@/lib/library';

export type LibraryAction = 'open' | 'delete' | 'read' | 'metadata';

interface ActionsProps {
  book: LibraryBook;
  busyAction?: LibraryAction | null;
  compact?: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onMarkRead: () => void;
  onRefreshMetadata: () => void;
}

const ACTIONS: {
  key: LibraryAction;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  destructive?: boolean;
}[] = [
  { key: 'open', label: 'Open in Moon+ Reader', icon: 'book-open' },
  { key: 'delete', label: 'Delete local file', icon: 'trash-2', destructive: true },
  { key: 'read', label: 'Mark as read', icon: 'check-circle' },
  { key: 'metadata', label: 'Refresh metadata', icon: 'refresh-cw' },
];

export function LibraryBookActions({
  book,
  busyAction = null,
  compact = false,
  onOpen,
  onDelete,
  onMarkRead,
  onRefreshMetadata,
}: ActionsProps) {
  const hasLocalFile = !!book.local?.uri && book.moonReader?.availableLocally !== false;
  const safDeleteUnavailable = book.local?.uri.startsWith('content:') === true;
  const handlers: Record<LibraryAction, () => void> = {
    open: onOpen,
    delete: onDelete,
    read: onMarkRead,
    metadata: onRefreshMetadata,
  };

  return (
    <View className={compact ? 'flex-row flex-wrap gap-2' : 'gap-2'}>
      {ACTIONS.map((action) => {
        const disabled =
          !!busyAction ||
          (action.key === 'open' && !hasLocalFile) ||
          (action.key === 'delete' && (!hasLocalFile || safDeleteUnavailable)) ||
          (action.key === 'read' && book.isRead === true);
        const subtitle =
          action.key === 'delete' && safDeleteUnavailable
            ? 'Use the device file manager'
            : action.key === 'open' && !hasLocalFile
              ? 'Download required'
              : action.key === 'read' && book.isRead
                ? 'Already read'
                : '';
        const color = action.destructive ? '#f87171' : '#d4d4d8';

        return (
          <Pressable
            key={action.key}
            onPress={handlers[action.key]}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            className="min-h-12 flex-row items-center gap-3 rounded-xl border border-[#2a2a32] px-3 active:opacity-70 disabled:opacity-40"
            style={compact ? { minWidth: 164, flexGrow: 1 } : undefined}
          >
            {busyAction === action.key ? (
              <ActivityIndicator size="small" color="#8b7cf6" />
            ) : (
              <Feather name={action.icon} size={17} color={color} />
            )}
            <View className="flex-1 py-2.5">
              <Text className="text-xs font-semibold" style={{ color }}>
                {action.label}
              </Text>
              {!!subtitle && <Text className="mt-0.5 text-[10px] text-neutral-500">{subtitle}</Text>}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export function LibraryActionsSheet({
  book,
  visible,
  onClose,
  ...actions
}: ActionsProps & { visible: boolean; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const landscape = width > height;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View className="flex-1" style={{ backgroundColor: 'rgba(0,0,0,0.64)' }}>
        <Pressable className="absolute inset-0" onPress={onClose} accessibilityLabel="Close actions" />
        <View
          className={landscape ? 'absolute right-0 top-0 bottom-0 w-[360px]' : 'absolute left-0 right-0 bottom-0'}
          style={{ backgroundColor: '#141419' }}
        >
          <SafeAreaView
            edges={landscape ? ['top', 'right', 'bottom'] : ['left', 'right', 'bottom']}
            className={landscape ? 'flex-1' : ''}
          >
            <View className="px-5 pb-5 pt-4">
              <View className="mb-5 flex-row items-center gap-3">
                <View className="h-16 w-11 overflow-hidden rounded-md bg-[#232329]">
                  {!!book.cover && (
                    <Image source={{ uri: book.cover }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                  )}
                </View>
                <View className="flex-1">
                  <Text numberOfLines={2} className="text-base font-semibold text-neutral-100">
                    {book.title}
                  </Text>
                  <Text numberOfLines={1} className="mt-1 text-xs text-neutral-500">
                    {book.author}
                  </Text>
                </View>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close actions"
                  className="h-9 w-9 items-center justify-center rounded-full bg-[#202027]"
                >
                  <Feather name="x" size={18} color="#d4d4d8" />
                </Pressable>
              </View>
              <LibraryBookActions book={book} {...actions} />
            </View>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}
