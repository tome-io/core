import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/components/app-ui';
import { canShowBookInFiles } from '@/lib/book-file-actions';
import type { LibraryBook } from '@/lib/library';

type BuiltInLibraryAction =
  | 'openWith'
  | 'files'
  | 'cover'
  | 'delete'
  | 'remove'
  | 'read'
  | 'metadata';
export type LibraryAction = BuiltInLibraryAction | `addon:${string}`;

export interface AddonLibraryAction {
  key: `addon:${string}`;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
}

interface ActionsProps {
  book: LibraryBook;
  busyAction?: LibraryAction | null;
  compact?: boolean;
  addonActions?: AddonLibraryAction[];
  onOpenWith: () => void;
  onShowInFiles: () => void;
  onCover?: () => void;
  onDelete: () => void;
  onRemove: () => void;
  onMarkRead?: () => void;
  onRefreshMetadata: () => void;
}

export function LibraryBookActions({
  book,
  busyAction = null,
  compact = false,
  addonActions = [],
  onOpenWith,
  onShowInFiles,
  onCover,
  onDelete,
  onRemove,
  onMarkRead,
  onRefreshMetadata,
}: ActionsProps) {
  const hasLocalFile =
    !!(book.local?.uri ?? book.fileUri) &&
    book.availableLocally !== false &&
    book.moonReader?.availableLocally !== false;
  const hasLocalRecord = !!(book.local?.uri ?? book.fileUri);
  const canRemoveLocalFile = hasLocalFile && !!book.local?.uri;
  const canRemoveSyncedItem =
    !hasLocalFile &&
    (book.key.startsWith('progress:') ||
      (!!book.moonReader && typeof book.progress === 'number'));
  const actions: {
    key: LibraryAction;
    label: string;
    icon: keyof typeof Feather.glyphMap;
    destructive?: boolean;
  }[] = [
    ...(onCover
      ? [{ key: 'cover' as const, label: 'Choose cover', icon: 'image' as const }]
      : []),
    ...addonActions,
    ...(hasLocalFile
      ? [
          ...(Platform.OS !== 'web'
            ? [
                {
                  key: 'openWith' as const,
                  label: 'Open with another app',
                  icon: 'share-2' as const,
                },
              ]
            : []),
          ...(canRemoveLocalFile
            ? [
                {
                  key: 'delete' as const,
                  label: 'Remove local file',
                  icon: 'trash-2' as const,
                  destructive: true,
                },
              ]
            : []),
        ]
      : []),
    ...(canShowBookInFiles(book)
      ? [{ key: 'files' as const, label: 'Show in Files', icon: 'folder' as const }]
      : []),
    ...(hasLocalRecord || canRemoveSyncedItem
      ? [
          {
            key: 'remove' as const,
            label: 'Remove from Tomeio',
            icon: 'trash-2' as const,
            destructive: true,
          },
        ]
      : []),
    ...(onMarkRead
      ? [{
          key: 'read' as const,
          label: book.isRead ? 'Finished' : 'Mark as finished',
          icon: 'check-circle' as const,
        }]
      : []),
    { key: 'metadata', label: 'Refresh metadata', icon: 'refresh-cw' },
  ];
  const handlers: Record<BuiltInLibraryAction, () => void> = {
    openWith: onOpenWith,
    files: onShowInFiles,
    cover: onCover ?? (() => {}),
    delete: onDelete,
    remove: onRemove,
    read: onMarkRead ?? (() => {}),
    metadata: onRefreshMetadata,
  };

  return (
    <View className={compact ? 'flex-row flex-wrap gap-2' : 'gap-2'}>
      {actions.map((action) => {
        const disabled = !!busyAction || (action.key === 'read' && book.isRead === true);
        const subtitle = action.key === 'read' && book.isRead ? 'Already finished' : '';
        const color = action.destructive ? colors.danger : colors.text;

        return (
          <Pressable
            key={action.key}
            onPress={
              action.key.startsWith('addon:')
                ? addonActions.find((candidate) => candidate.key === action.key)?.onPress
                : handlers[action.key as BuiltInLibraryAction]
            }
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            className="min-h-12 flex-row items-center gap-3 rounded-xl border px-3 active:opacity-70 disabled:opacity-40"
            style={[
              { borderColor: colors.border },
              compact ? { minWidth: 164, flexGrow: 1 } : undefined,
            ]}
          >
            {busyAction === action.key ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Feather name={action.icon} size={17} color={color} />
            )}
            <View className="flex-1 py-2.5">
              <Text className="text-xs font-semibold" style={{ color }}>
                {action.label}
              </Text>
              {!!subtitle && (
                <Text className="mt-0.5 text-[10px]" style={{ color: colors.textMuted }}>
                  {subtitle}
                </Text>
              )}
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
          style={{ backgroundColor: colors.surface }}
        >
          <SafeAreaView
            edges={landscape ? ['top', 'right', 'bottom'] : ['left', 'right', 'bottom']}
            className={landscape ? 'flex-1' : ''}
          >
            <View className="px-5 pb-5 pt-4">
              <View className="mb-5 flex-row items-center gap-3">
                <View
                  className="h-16 w-11 overflow-hidden rounded-md"
                  style={{ backgroundColor: colors.surfaceRaised }}
                >
                  {!!book.cover && (
                    <Image source={{ uri: book.cover }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                  )}
                </View>
                <View className="flex-1">
                  <Text
                    numberOfLines={2}
                    className="text-base font-semibold"
                    style={{ color: colors.text }}
                  >
                    {book.title}
                  </Text>
                  <Text
                    numberOfLines={1}
                    className="mt-1 text-xs"
                    style={{ color: colors.textMuted }}
                  >
                    {book.author}
                  </Text>
                </View>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close actions"
                  className="h-9 w-9 items-center justify-center rounded-full"
                  style={{ backgroundColor: colors.surfaceRaised }}
                >
                  <Feather name="x" size={18} color={colors.text} />
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

export function ReadBookSheet({
  book,
  visible,
  readerActions,
  onReadInTomeio,
  onOpenWith,
  onClose,
}: {
  book: LibraryBook;
  visible: boolean;
  readerActions: AddonLibraryAction[];
  onReadInTomeio?: () => void;
  onOpenWith: () => void;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const actions = [
    ...(onReadInTomeio
      ? [
          {
            key: 'tomeio-reader' as const,
            label: 'Read in Tomeio',
            icon: 'book-open' as const,
            onPress: onReadInTomeio,
          },
        ]
      : []),
    ...readerActions,
    {
      key: 'other-app' as const,
      label: 'Read in another app',
      icon: 'share-2' as const,
      onPress: onOpenWith,
    },
  ];

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
        <Pressable className="absolute inset-0" onPress={onClose} accessibilityLabel="Close reader options" />
        <View
          className={landscape ? 'absolute right-0 top-0 bottom-0 w-[360px]' : 'absolute left-0 right-0 bottom-0'}
          style={{ backgroundColor: colors.surface }}
        >
          <SafeAreaView
            edges={landscape ? ['top', 'right', 'bottom'] : ['left', 'right', 'bottom']}
            className={landscape ? 'flex-1' : ''}
          >
            <View className="px-5 pb-5 pt-4">
              <View className="mb-5 flex-row items-center gap-3">
                <View
                  className="h-16 w-11 overflow-hidden rounded-md"
                  style={{ backgroundColor: colors.surfaceRaised }}
                >
                  {!!book.cover && (
                    <Image source={{ uri: book.cover }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                  )}
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-lg font-semibold" style={{ color: colors.text }}>
                    Read with
                  </Text>
                  <Text
                    numberOfLines={1}
                    className="mt-1 text-xs"
                    style={{ color: colors.textMuted }}
                  >
                    {book.title}
                  </Text>
                </View>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close reader options"
                  className="h-9 w-9 items-center justify-center rounded-full"
                  style={{ backgroundColor: colors.surfaceRaised }}
                >
                  <Feather name="x" size={18} color={colors.text} />
                </Pressable>
              </View>

              <View className="gap-2">
                {actions.map((action) => (
                  <Pressable
                    key={action.key}
                    onPress={action.onPress}
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                    className="min-h-14 flex-row items-center gap-3 rounded-xl border px-4 active:opacity-70"
                    style={{ borderColor: colors.border, backgroundColor: colors.surfaceRaised }}
                  >
                    <Feather name={action.icon} size={19} color={colors.text} />
                    <Text className="flex-1 text-sm font-semibold" style={{ color: colors.text }}>
                      {action.label}
                    </Text>
                    <Feather name="chevron-right" size={18} color={colors.textMuted} />
                  </Pressable>
                ))}
              </View>
            </View>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}
