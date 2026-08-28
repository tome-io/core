import { Feather } from '@expo/vector-icons';
import { colors, radii } from '@tomeio/design';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ComponentProps, ReactNode } from 'react';

export { colors, radii };

export const MOBILE_PAGE_GUTTER = 12;
export const WIDE_PAGE_GUTTER = 24;
export const MOBILE_NAV_HEIGHT = 80;
export const MOBILE_NAV_FADE_HEIGHT = 132;

export function usePageGutter() {
  const { width } = useWindowDimensions();
  return width < 700 ? MOBILE_PAGE_GUTTER : WIDE_PAGE_GUTTER;
}

export function usePageBottomPadding(basePadding = 40) {
  const { width } = useWindowDimensions();
  return width < 700 ? MOBILE_NAV_HEIGHT + 24 : basePadding;
}

type FeatherName = ComponentProps<typeof Feather>['name'];

export function SettingsSection({
  title,
  children,
  onLayout,
  compact = false,
}: {
  title: string;
  children: ReactNode;
  onLayout?: ComponentProps<typeof View>['onLayout'];
  compact?: boolean;
}) {
  return (
    <View
      onLayout={onLayout}
      className={`w-full border-b ${compact ? 'py-6' : 'py-10'}`}
      style={{ maxWidth: 560, borderBottomColor: colors.border }}
    >
      <Text
        className={`${compact ? 'mb-6' : 'mb-8'} text-[29px] font-light`}
        style={{ color: colors.text }}
      >
        {title}
      </Text>
      <View className="gap-6">{children}</View>
    </View>
  );
}

export function SettingsOption({
  label,
  detail,
  icon,
  compact,
  children,
}: {
  label: string;
  detail?: string;
  icon?: FeatherName;
  compact: boolean;
  children: ReactNode;
}) {
  return (
    <View className={compact ? 'w-full gap-3' : 'w-full min-h-14 flex-row items-center gap-8'}>
      <View className="flex-1 flex-row items-center gap-3">
        {icon ? <Feather name={icon} size={21} color={colors.text} /> : null}
        <View className="flex-1 gap-1">
          <Text className="text-[15px] leading-5" style={{ color: colors.text }}>
            {label}
          </Text>
          {detail ? (
            <Text className="text-xs leading-[18px]" style={{ color: colors.textMuted }}>
              {detail}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={compact ? undefined : { width: 270 }}>{children}</View>
    </View>
  );
}

export function SelectField({
  label,
  onPress,
  icon,
  dense = false,
}: {
  label: string;
  onPress: () => void;
  icon?: FeatherName;
  dense?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className={`${dense ? 'h-12' : 'h-14'} w-full flex-row items-center gap-3 px-5 active:opacity-80`}
      style={{ backgroundColor: colors.surfaceRaised, borderRadius: radii.pill }}
    >
      {icon ? <Feather name={icon} size={17} color={colors.textMuted} /> : null}
      <Text numberOfLines={1} className="flex-1 text-[15px]" style={{ color: colors.text }}>
        {label}
      </Text>
      <Feather name="chevron-down" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

export function SearchField({
  value,
  onChangeText,
  placeholder,
  ...props
}: Pick<TextInputProps, 'value' | 'onChangeText' | 'placeholder'> & TextInputProps) {
  return (
    <View
      className="h-12 min-w-0 flex-1 flex-row items-center px-4"
      style={{ backgroundColor: colors.surfaceRaised, borderRadius: radii.pill }}
    >
      <TextInput
        {...props}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        className="h-12 flex-1 text-sm"
        style={{ color: colors.text }}
      />
      <Feather name="search" size={19} color={colors.textMuted} />
    </View>
  );
}

export function FilterChip({
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
      className="h-9 items-center justify-center px-4 active:opacity-75"
      style={{
        borderRadius: radii.pill,
        backgroundColor: selected ? colors.accent : colors.surfaceRaised,
      }}
    >
      <Text
        className="text-xs"
        style={{
          color: selected ? colors.onAccent : colors.textMuted,
          fontWeight: selected ? '600' : '500',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function SectionAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="h-9 shrink-0 flex-row items-center justify-center gap-1 rounded-full pl-3 pr-2 active:opacity-70"
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
      })}
    >
      <Text className="text-[13px] font-semibold" style={{ color: colors.textMuted }}>
        {label}
      </Text>
      <Feather name="chevron-right" size={17} color={colors.textMuted} />
    </Pressable>
  );
}

export function SectionHeader({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const gutter = usePageGutter();
  return (
    <View className="mb-3 flex-row items-center" style={{ paddingHorizontal: gutter }}>
      <Text
        numberOfLines={1}
        className="flex-1 pr-3 text-[15px] font-semibold uppercase tracking-[1.4px]"
        style={{ color: colors.textMuted }}
      >
        {title}
      </Text>
      {actionLabel && onAction ? <SectionAction label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

export function BookStatusChips({
  rating,
  progress,
  isRead = false,
}: {
  rating?: number;
  progress?: number;
  isRead?: boolean;
}) {
  const normalizedProgress = isRead
    ? 100
    : typeof progress === 'number'
      ? Math.max(0, Math.min(100, progress))
      : null;
  if (!rating && (!normalizedProgress || normalizedProgress <= 0)) return null;

  return (
    <View className="mt-3 flex-row flex-wrap gap-2">
      {rating ? (
        <View
          className="h-8 flex-row items-center justify-center rounded-full px-3"
          style={{ backgroundColor: 'rgba(10, 10, 14, 0.72)' }}
        >
          <Text className="text-xs font-bold" style={{ color: colors.rating }}>
            ★ {rating.toFixed(1)}
          </Text>
        </View>
      ) : null}
      {normalizedProgress && normalizedProgress > 0 ? (
        <View
          className="h-8 flex-row items-center justify-center gap-1.5 rounded-full px-3"
          style={{
            backgroundColor: isRead ? colors.success : colors.accentMuted,
          }}
        >
          <Feather
            name={isRead ? 'check' : 'book-open'}
            size={13}
            color={colors.text}
          />
          <Text className="text-xs font-semibold" style={{ color: colors.text }}>
            {isRead ? 'Read' : `${Math.max(1, Math.round(normalizedProgress))}% read`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function PillButton({
  label,
  icon,
  onPress,
  variant = 'overlay',
  disabled,
}: {
  label: string;
  icon?: FeatherName;
  onPress: () => void;
  variant?: 'overlay' | 'accent' | 'success' | 'outline' | 'ghost';
  disabled?: boolean;
}) {
  const backgroundColor =
    variant === 'accent'
      ? colors.accent
      : variant === 'success'
        ? colors.success
        : variant === 'overlay'
          ? colors.surfaceRaised
          : 'transparent';
  const foregroundColor = variant === 'accent' ? colors.onAccent : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className="h-12 flex-row items-center justify-center gap-2 px-5 active:opacity-75 disabled:opacity-40"
      style={{
        borderRadius: radii.pill,
        backgroundColor,
        borderColor: variant === 'outline' ? colors.textMuted : 'transparent',
        borderWidth: variant === 'outline' ? 1 : 0,
      }}
    >
      {icon ? <Feather name={icon} size={18} color={foregroundColor} /> : null}
      <Text className="text-sm font-semibold" style={{ color: foregroundColor }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function AppDialog({
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
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const compact = width < 600;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View className="flex-1 bg-black/70">
        <Pressable className="absolute inset-0" onPress={onClose} accessibilityLabel="Close" />
        <KeyboardAvoidingView
          behavior="padding"
          pointerEvents="box-none"
          className={compact ? 'flex-1 justify-end' : 'flex-1 items-center justify-center'}
        >
          <View
            className={
              compact
                ? 'w-full rounded-t-3xl border p-5'
                : 'w-full max-w-[560px] rounded-3xl border p-6'
            }
            style={{
              backgroundColor: colors.surface,
              borderColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 20),
              maxHeight: '90%',
              flexShrink: 1,
            }}
          >
            <View className="mb-5 flex-row items-center justify-between">
              <Text className="text-xl font-semibold" style={{ color: colors.text }}>
                {title}
              </Text>
              <Pressable
                onPress={onClose}
                className="h-10 w-10 items-center justify-center"
                style={{ backgroundColor: colors.surfaceRaised, borderRadius: radii.pill }}
              >
                <Feather name="x" size={20} color={colors.textMuted} />
              </Pressable>
            </View>
            {children}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
