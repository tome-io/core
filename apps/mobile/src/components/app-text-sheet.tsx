import {
  BottomSheet as SwiftUIBottomSheet,
  Button as SwiftUIButton,
  Divider as SwiftUIDivider,
  Group as SwiftUIGroup,
  Host as SwiftUIHost,
  HStack as SwiftUIHStack,
  Image as SwiftUIImage,
  RNHostView as SwiftUIRNHostView,
  ScrollView as SwiftUIScrollView,
  Text as SwiftUIText,
  VStack as SwiftUIVStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel as swiftUIAccessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  font as swiftUIFont,
  frame as swiftUIFrame,
  foregroundStyle as swiftUIForegroundStyle,
  labelStyle,
  lineSpacing as swiftUILineSpacing,
  padding as swiftUIPadding,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
} from '@expo/ui/swift-ui/modifiers';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/components/app-ui';

export function AppTextSheet({
  visible,
  title,
  text,
  avatarUrl,
  rating,
  onClose,
  muted = false,
}: {
  visible: boolean;
  title: string;
  text: string;
  avatarUrl?: string;
  rating?: number;
  onClose: () => void;
  muted?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const bodyColor = muted ? colors.textMuted : colors.text;

  if (Platform.OS === 'ios') {
    return (
      <SwiftUIHost
        colorScheme="dark"
        pointerEvents="none"
        style={{ position: 'absolute' }}
      >
        <SwiftUIBottomSheet
          isPresented={visible}
          onIsPresentedChange={(isPresented) => {
            if (!isPresented) onClose();
          }}
        >
          <SwiftUIGroup
            modifiers={[
              swiftUIFrame({
                maxWidth: Infinity,
                maxHeight: Infinity,
                alignment: 'topLeading',
              }),
              presentationBackground(colors.surface),
              presentationDetents(['medium', 'large']),
              presentationDragIndicator('visible'),
            ]}
          >
            <SwiftUIVStack
              spacing={0}
              modifiers={[
                swiftUIFrame({
                  maxWidth: Infinity,
                  maxHeight: Infinity,
                  alignment: 'topLeading',
                }),
              ]}
            >
              <SwiftUIHStack
                spacing={12}
                modifiers={[
                  swiftUIPadding({ top: 12, bottom: 12, leading: 20, trailing: 12 }),
                  swiftUIFrame({ maxWidth: Infinity, alignment: 'leading' }),
                ]}
              >
                {avatarUrl ? (
                  <SwiftUIRNHostView matchContents>
                    <Image
                      source={{ uri: avatarUrl }}
                      cachePolicy="memory-disk"
                      contentFit="cover"
                      accessibilityLabel={`${title} profile photo`}
                      style={{ width: 42, height: 42, borderRadius: 21 }}
                    />
                  </SwiftUIRNHostView>
                ) : null}
                <SwiftUIVStack
                  spacing={3}
                  modifiers={[
                    swiftUIFrame({ maxWidth: Infinity, alignment: 'leading' }),
                  ]}
                >
                  <SwiftUIText
                    modifiers={[
                      swiftUIFont({ textStyle: 'headline', weight: 'semibold' }),
                      swiftUIForegroundStyle(colors.text),
                      swiftUIFrame({ maxWidth: Infinity, alignment: 'leading' }),
                    ]}
                  >
                    {title}
                  </SwiftUIText>
                  {rating != null ? (
                    <SwiftUIHStack
                      spacing={3}
                      modifiers={[swiftUIFrame({ maxWidth: Infinity, alignment: 'leading' })]}
                    >
                      {Array.from({ length: 5 }, (_, index) => (
                        <SwiftUIImage
                          key={index}
                          systemName={rating - index >= 0.5 ? 'star.fill' : 'star'}
                          size={13}
                          color={colors.rating}
                        />
                      ))}
                    </SwiftUIHStack>
                  ) : null}
                </SwiftUIVStack>
                <SwiftUIButton
                  label="Close"
                  systemImage="xmark"
                  onPress={onClose}
                  modifiers={[
                    buttonStyle('glass'),
                    buttonBorderShape('circle'),
                    controlSize('large'),
                    labelStyle('iconOnly'),
                    swiftUIAccessibilityLabel(`Close ${title}`),
                  ]}
                />
              </SwiftUIHStack>
              <SwiftUIDivider />
              <SwiftUIScrollView
                axes="vertical"
                showsIndicators={false}
                modifiers={[
                  swiftUIFrame({
                    maxWidth: Infinity,
                    maxHeight: Infinity,
                    alignment: 'topLeading',
                  }),
                ]}
              >
                <SwiftUIText
                  modifiers={[
                    swiftUIFont({ size: 18 }),
                    swiftUIForegroundStyle(bodyColor),
                    swiftUILineSpacing(5),
                    swiftUIPadding({ top: 20, bottom: 28, leading: 20, trailing: 20 }),
                    swiftUIFrame({ maxWidth: Infinity, alignment: 'topLeading' }),
                  ]}
                >
                  {text}
                </SwiftUIText>
              </SwiftUIScrollView>
            </SwiftUIVStack>
          </SwiftUIGroup>
        </SwiftUIBottomSheet>
      </SwiftUIHost>
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.64)' }}>
        <Pressable
          className="absolute inset-0"
          onPress={onClose}
          accessibilityLabel={`Close ${title}`}
        />
        <View
          className="h-[72%] overflow-hidden rounded-t-3xl border-t"
          style={{ borderTopColor: colors.border, backgroundColor: colors.surface }}
        >
          <View
            className="min-h-16 flex-row items-center gap-3 border-b px-5 py-3"
            style={{ borderBottomColor: colors.border }}
          >
            {avatarUrl ? (
              <Image
                source={{ uri: avatarUrl }}
                cachePolicy="memory-disk"
                contentFit="cover"
                accessibilityLabel={`${title} profile photo`}
                style={{ width: 42, height: 42, borderRadius: 21 }}
              />
            ) : null}
            <View className="min-w-0 flex-1">
              <Text
                numberOfLines={2}
                className="text-base font-semibold"
                style={{ color: colors.text }}
              >
                {title}
              </Text>
              {rating != null ? (
                <Text className="mt-1 text-sm" style={{ color: colors.rating }}>
                  {Array.from(
                    { length: 5 },
                    (_, index) => (rating - index >= 0.5 ? '★' : '☆')
                  ).join('')}
                </Text>
              ) : null}
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={`Close ${title}`}
              className="h-10 w-10 items-center justify-center rounded-full"
              style={{ backgroundColor: colors.surfaceRaised }}
            >
              <Feather name="x" size={20} color={colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView
            className="flex-1"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingHorizontal: 20,
              paddingTop: 20,
              paddingBottom: Math.max(24, insets.bottom),
            }}
          >
            <Text className="text-[17px] leading-7" style={{ color: bodyColor }}>
              {text}
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
