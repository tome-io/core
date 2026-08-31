import {
  BottomSheet as SwiftUIBottomSheet,
  Button as SwiftUIButton,
  Divider as SwiftUIDivider,
  Form as SwiftUIForm,
  Group as SwiftUIGroup,
  Host as SwiftUIHost,
  HStack as SwiftUIHStack,
  Image as SwiftUIImage,
  Picker as SwiftUIPicker,
  ScrollView as SwiftUIScrollView,
  Section as SwiftUISection,
  Slider as SwiftUISlider,
  Text as SwiftUIText,
  Toggle as SwiftUIToggle,
  VStack as SwiftUIVStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonStyle,
  font,
  frame,
  foregroundStyle,
  labelStyle,
  padding,
  pickerStyle,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
  tag,
} from '@expo/ui/swift-ui/modifiers';
import { Feather } from '@expo/vector-icons';
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { colors } from '@/components/app-ui';
import type {
  ReaderFontFamily,
  ReaderPreferences,
  ReaderTheme,
} from '@/lib/reader-state';

export interface ReaderTocItem {
  href: string;
  title: string;
  depth: number;
}

const THEMES: { label: string; value: ReaderTheme }[] = [
  { label: 'Light', value: 'light' },
  { label: 'Sepia', value: 'sepia' },
  { label: 'Dark', value: 'dark' },
];

const FONTS: { label: string; value: ReaderFontFamily }[] = [
  { label: 'Publisher serif', value: 'serif' },
  { label: 'Sans serif', value: 'sans-serif' },
  { label: 'Duospace', value: 'IA Writer Duospace' },
  { label: 'OpenDyslexic', value: 'OpenDyslexic' },
];

function NativeSheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <SwiftUIHStack
      spacing={12}
      modifiers={[
        padding({ top: 12, bottom: 12, leading: 20, trailing: 12 }),
        frame({ maxWidth: Infinity, alignment: 'leading' }),
      ]}
    >
      <SwiftUIText
        modifiers={[
          font({ textStyle: 'headline', weight: 'semibold' }),
          foregroundStyle(colors.text),
          frame({ maxWidth: Infinity, alignment: 'leading' }),
        ]}
      >
        {title}
      </SwiftUIText>
      <SwiftUIButton
        label="Close"
        systemImage="xmark"
        onPress={onClose}
        modifiers={[
          buttonStyle('glass'),
          labelStyle('iconOnly'),
          accessibilityLabel(`Close ${title}`),
        ]}
      />
    </SwiftUIHStack>
  );
}

export function ReaderSettingsSheet({
  visible,
  preferences,
  onChange,
  onClose,
}: {
  visible: boolean;
  preferences: ReaderPreferences;
  onChange: (preferences: ReaderPreferences) => void;
  onClose: () => void;
}) {
  const patch = (next: Partial<ReaderPreferences>) =>
    onChange({ ...preferences, ...next });

  if (Platform.OS === 'ios') {
    return (
      <SwiftUIHost colorScheme="dark" pointerEvents="none" style={{ position: 'absolute' }}>
        <SwiftUIBottomSheet
          isPresented={visible}
          onIsPresentedChange={(presented) => {
            if (!presented) onClose();
          }}
        >
          <SwiftUIGroup
            modifiers={[
              presentationBackground(colors.surface),
              presentationDetents(['medium', 'large']),
              presentationDragIndicator('visible'),
              frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' }),
            ]}
          >
            <SwiftUIVStack
              spacing={0}
              modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}
            >
              <NativeSheetHeader title="Reading settings" onClose={onClose} />
              <SwiftUIDivider />
              <SwiftUIForm>
                <SwiftUISection title="Appearance">
                  <SwiftUIPicker
                    label="Theme"
                    selection={preferences.theme}
                    onSelectionChange={(theme) => patch({ theme: theme as ReaderTheme })}
                    modifiers={[pickerStyle('segmented')]}
                  >
                    {THEMES.map((theme) => (
                      <SwiftUIText key={theme.value} modifiers={[tag(theme.value)]}>
                        {theme.label}
                      </SwiftUIText>
                    ))}
                  </SwiftUIPicker>
                  <SwiftUIPicker
                    label="Typeface"
                    selection={preferences.fontFamily}
                    onSelectionChange={(fontFamily) =>
                      patch({ fontFamily: fontFamily as ReaderFontFamily })
                    }
                  >
                    {FONTS.map((fontOption) => (
                      <SwiftUIText key={fontOption.value} modifiers={[tag(fontOption.value)]}>
                        {fontOption.label}
                      </SwiftUIText>
                    ))}
                  </SwiftUIPicker>
                </SwiftUISection>
                <SwiftUISection title="Page">
                  <SwiftUISlider
                    value={preferences.fontSize}
                    min={1}
                    max={3}
                    step={0.1}
                    onValueChange={(fontSize) => patch({ fontSize })}
                    label={<SwiftUIText>Text size</SwiftUIText>}
                    minimumValueLabel={<SwiftUIImage systemName="textformat.size.smaller" />}
                    maximumValueLabel={<SwiftUIImage systemName="textformat.size.larger" />}
                  />
                  <SwiftUISlider
                    value={preferences.lineHeight}
                    min={1}
                    max={2}
                    step={0.1}
                    onValueChange={(lineHeight) => patch({ lineHeight })}
                    label={<SwiftUIText>Line spacing</SwiftUIText>}
                  />
                  <SwiftUISlider
                    value={preferences.pageMargins}
                    min={0.5}
                    max={4}
                    step={0.5}
                    onValueChange={(pageMargins) => patch({ pageMargins })}
                    label={<SwiftUIText>Margins</SwiftUIText>}
                  />
                  <SwiftUIToggle
                    label="Continuous scrolling"
                    systemImage="scroll"
                    isOn={preferences.scroll}
                    onIsOnChange={(scroll) => patch({ scroll })}
                  />
                </SwiftUISection>
              </SwiftUIForm>
            </SwiftUIVStack>
          </SwiftUIGroup>
        </SwiftUIBottomSheet>
      </SwiftUIHost>
    );
  }

  return (
    <AndroidReaderSheet visible={visible} title="Reading settings" onClose={onClose}>
      <Text className="mb-2 text-xs font-semibold uppercase" style={{ color: colors.textMuted }}>
        Theme
      </Text>
      <View className="mb-5 flex-row gap-2">
        {THEMES.map((theme) => (
          <ChoiceButton
            key={theme.value}
            label={theme.label}
            selected={preferences.theme === theme.value}
            onPress={() => patch({ theme: theme.value })}
          />
        ))}
      </View>
      <Text className="mb-2 text-xs font-semibold uppercase" style={{ color: colors.textMuted }}>
        Typeface
      </Text>
      <View className="mb-5 gap-2">
        {FONTS.map((fontOption) => (
          <ChoiceButton
            key={fontOption.value}
            label={fontOption.label}
            selected={preferences.fontFamily === fontOption.value}
            onPress={() => patch({ fontFamily: fontOption.value })}
          />
        ))}
      </View>
      <StepSetting
        label="Text size"
        value={`${Math.round(preferences.fontSize * 100)}%`}
        onDecrease={() => patch({ fontSize: Math.max(1, preferences.fontSize - 0.1) })}
        onIncrease={() => patch({ fontSize: Math.min(3, preferences.fontSize + 0.1) })}
      />
      <StepSetting
        label="Line spacing"
        value={preferences.lineHeight.toFixed(1)}
        onDecrease={() => patch({ lineHeight: Math.max(1, preferences.lineHeight - 0.1) })}
        onIncrease={() => patch({ lineHeight: Math.min(2, preferences.lineHeight + 0.1) })}
      />
      <StepSetting
        label="Margins"
        value={preferences.pageMargins.toFixed(1)}
        onDecrease={() => patch({ pageMargins: Math.max(0.5, preferences.pageMargins - 0.5) })}
        onIncrease={() => patch({ pageMargins: Math.min(4, preferences.pageMargins + 0.5) })}
      />
      <ChoiceButton
        label="Continuous scrolling"
        selected={preferences.scroll}
        onPress={() => patch({ scroll: !preferences.scroll })}
      />
    </AndroidReaderSheet>
  );
}

export function ReaderTocSheet({
  visible,
  items,
  onSelect,
  onClose,
}: {
  visible: boolean;
  items: ReaderTocItem[];
  onSelect: (item: ReaderTocItem) => void;
  onClose: () => void;
}) {
  if (Platform.OS === 'ios') {
    return (
      <SwiftUIHost colorScheme="dark" pointerEvents="none" style={{ position: 'absolute' }}>
        <SwiftUIBottomSheet
          isPresented={visible}
          onIsPresentedChange={(presented) => {
            if (!presented) onClose();
          }}
        >
          <SwiftUIGroup
            modifiers={[
              presentationBackground(colors.surface),
              presentationDetents(['medium', 'large']),
              presentationDragIndicator('visible'),
              frame({ maxWidth: Infinity, maxHeight: Infinity }),
            ]}
          >
            <SwiftUIVStack
              spacing={0}
              modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}
            >
              <NativeSheetHeader title="Contents" onClose={onClose} />
              <SwiftUIDivider />
              <SwiftUIScrollView
                axes="vertical"
                modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}
              >
                <SwiftUIVStack spacing={2} modifiers={[padding({ vertical: 10 })]}>
                  {items.map((item, index) => (
                    <SwiftUIButton
                      key={`${item.href}:${index}`}
                      onPress={() => onSelect(item)}
                      modifiers={[buttonStyle('plain')]}
                    >
                      <SwiftUIText
                        modifiers={[
                          foregroundStyle(colors.text),
                          padding({
                            leading: 20 + item.depth * 18,
                            trailing: 20,
                            vertical: 10,
                          }),
                          frame({ maxWidth: Infinity, alignment: 'leading' }),
                        ]}
                      >
                        {item.title}
                      </SwiftUIText>
                    </SwiftUIButton>
                  ))}
                </SwiftUIVStack>
              </SwiftUIScrollView>
            </SwiftUIVStack>
          </SwiftUIGroup>
        </SwiftUIBottomSheet>
      </SwiftUIHost>
    );
  }

  return (
    <AndroidReaderSheet visible={visible} title="Contents" onClose={onClose}>
      {items.map((item, index) => (
        <Pressable
          key={`${item.href}:${index}`}
          onPress={() => onSelect(item)}
          accessibilityRole="button"
          className="min-h-12 justify-center border-b py-3"
          style={{
            paddingLeft: item.depth * 18,
            borderBottomColor: colors.border,
          }}
        >
          <Text className="text-sm" style={{ color: colors.text }}>
            {item.title}
          </Text>
        </Pressable>
      ))}
    </AndroidReaderSheet>
  );
}

function AndroidReaderSheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.58)' }}>
        <Pressable className="absolute inset-0" onPress={onClose} accessibilityLabel={`Close ${title}`} />
        <View
          className="max-h-[82%] rounded-t-3xl border-t px-5 pb-8 pt-4"
          style={{ backgroundColor: colors.surface, borderTopColor: colors.border }}
        >
          <View className="mb-4 flex-row items-center">
            <Text className="flex-1 text-lg font-semibold" style={{ color: colors.text }}>
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              className="h-10 w-10 items-center justify-center rounded-full"
              style={{ backgroundColor: colors.surfaceRaised }}
            >
              <Feather name="x" size={20} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ChoiceButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className="min-h-12 flex-1 flex-row items-center justify-between rounded-xl border px-4"
      style={{
        borderColor: selected ? colors.accent : colors.border,
        backgroundColor: selected ? colors.accentMuted : colors.surfaceRaised,
      }}
    >
      <Text className="text-sm font-medium" style={{ color: colors.text }}>
        {label}
      </Text>
      {selected ? <Feather name="check" size={17} color={colors.accent} /> : null}
    </Pressable>
  );
}

function StepSetting({
  label,
  value,
  onDecrease,
  onIncrease,
}: {
  label: string;
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <View className="mb-3 flex-row items-center rounded-xl px-4 py-2" style={{ backgroundColor: colors.surfaceRaised }}>
      <Text className="flex-1 text-sm font-medium" style={{ color: colors.text }}>
        {label}
      </Text>
      <Pressable onPress={onDecrease} className="h-10 w-10 items-center justify-center">
        <Feather name="minus" size={18} color={colors.text} />
      </Pressable>
      <Text className="w-14 text-center text-xs font-semibold" style={{ color: colors.textMuted }}>
        {value}
      </Text>
      <Pressable onPress={onIncrease} className="h-10 w-10 items-center justify-center">
        <Feather name="plus" size={18} color={colors.text} />
      </Pressable>
    </View>
  );
}
