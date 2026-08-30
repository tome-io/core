import CommunityBottomSheet, { BottomSheetView } from '@expo/ui/community/bottom-sheet';
import { Feather } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { colors, radii } from '@/components/app-ui';

export function AppBottomSheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <CommunityBottomSheet
      index={visible ? 0 : -1}
      snapPoints={['90%']}
      onClose={onClose}
      enablePanDownToClose
      backgroundStyle={{ backgroundColor: colors.surface }}
    >
      <BottomSheetView style={{ flex: 1, backgroundColor: colors.surface }}>
        <View className="flex-row items-center gap-3 px-5 pb-4">
          <Text
            numberOfLines={2}
            className="min-w-0 flex-1 text-xl font-semibold"
            style={{ color: colors.text }}
          >
            {title}
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            className="h-11 w-11 items-center justify-center"
            style={{ backgroundColor: colors.surfaceRaised, borderRadius: radii.pill }}
          >
            <Feather name="x" size={22} color={colors.textMuted} />
          </Pressable>
        </View>
        <View className="min-h-0 flex-1">{children}</View>
      </BottomSheetView>
    </CommunityBottomSheet>
  );
}
