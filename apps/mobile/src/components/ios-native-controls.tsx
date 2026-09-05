import {
  Button,
  Host,
  HStack,
  Image,
  Menu,
  Text,
  TextField,
  useNativeState,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  disabled as disabledModifier,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  labelStyle,
  onSubmit,
  padding,
  submitLabel,
  textFieldStyle,
} from '@expo/ui/swift-ui/modifiers';
import { colors } from '@tomeio/design';
import type { SFSymbol } from 'expo-symbols';
import { useEffect } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

export interface IosNativeOption<T extends string> {
  label: string;
  value: T;
}

export function IosNativeSelect<T extends string>({
  label,
  value,
  selectedValue,
  options,
  onSelect,
  systemImage,
  dense = false,
  style,
}: {
  label?: string;
  value: string;
  selectedValue: T;
  options: readonly IosNativeOption<T>[];
  onSelect: (value: T) => void;
  systemImage?: SFSymbol;
  dense?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Host
      colorScheme="dark"
      seedColor={colors.accent}
      ignoreSafeArea="all"
      style={[{ height: dense ? 48 : 56 }, style]}
    >
      <Menu
        label={
          <HStack
            spacing={10}
            modifiers={[
              padding({ leading: 16, trailing: 14, vertical: 8 }),
              frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'leading' }),
              glassEffect({ glass: { variant: 'regular' }, shape: 'capsule' }),
            ]}
          >
            {systemImage ? (
              <Image systemName={systemImage} size={17} color={colors.textMuted} />
            ) : null}
            <VStack
              alignment="leading"
              spacing={label ? 1 : 0}
              modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}
            >
              {label ? (
                <Text
                  modifiers={[
                    font({ size: 10, weight: 'semibold' }),
                    foregroundStyle(colors.textMuted),
                  ]}
                >
                  {label.toLocaleUpperCase()}
                </Text>
              ) : null}
              <Text
                modifiers={[
                  font({ size: 15, weight: 'medium' }),
                  foregroundStyle(colors.text),
                ]}
              >
                {value}
              </Text>
            </VStack>
            <Image systemName="chevron.down" size={13} color={colors.textMuted} />
          </HStack>
        }
      >
        {options.map((option) => (
          <Button
            key={option.value}
            label={option.label}
            systemImage={option.value === selectedValue ? 'checkmark' : undefined}
            onPress={() => onSelect(option.value)}
          />
        ))}
      </Menu>
    </Host>
  );
}

export function IosNativeAction({
  label,
  onPress,
  systemImage,
  disabled = false,
  fullWidth = false,
  prominent = false,
  plain = false,
  compact = false,
  destructive = false,
  iconPlacement = 'leading',
}: {
  label: string;
  onPress: () => void;
  systemImage?: SFSymbol;
  disabled?: boolean;
  fullWidth?: boolean;
  prominent?: boolean;
  plain?: boolean;
  compact?: boolean;
  destructive?: boolean;
  iconPlacement?: 'leading' | 'trailing';
}) {
  return (
    <Host
      matchContents={fullWidth ? undefined : compact ? { horizontal: true } : true}
      colorScheme="dark"
      seedColor={colors.accent}
      ignoreSafeArea="all"
      style={
        fullWidth
          ? { width: '100%', height: compact ? 48 : 52 }
          : compact
            ? { height: 48 }
            : undefined
      }
    >
      <Button
        onPress={onPress}
        role={destructive ? 'destructive' : 'default'}
        modifiers={[
          buttonStyle(plain ? 'plain' : prominent ? 'glassProminent' : 'glass'),
          buttonBorderShape('capsule'),
          controlSize(compact ? 'regular' : 'large'),
          foregroundStyle(destructive ? colors.danger : colors.text),
          disabledModifier(disabled),
          accessibilityLabel(label),
        ]}
      >
        <HStack
          spacing={8}
          modifiers={
            fullWidth
              ? [frame({ maxWidth: Infinity, maxHeight: Infinity })]
              : compact
                ? [frame({ maxHeight: Infinity })]
              : undefined
          }
        >
          {systemImage && iconPlacement === 'leading' ? (
            <Image systemName={systemImage} size={18} />
          ) : null}
          <Text>{label}</Text>
          {systemImage && iconPlacement === 'trailing' ? (
            <Image systemName={systemImage} size={18} />
          ) : null}
        </HStack>
      </Button>
    </Host>
  );
}

export function IosNativeBackButton({ onPress }: { onPress: () => void }) {
  return (
    <Host
      matchContents
      colorScheme="dark"
      seedColor={colors.accent}
      ignoreSafeArea="all"
    >
      <Button
        label="Back"
        systemImage="chevron.left"
        onPress={onPress}
        modifiers={[
          buttonStyle('glass'),
          buttonBorderShape('circle'),
          controlSize('large'),
          foregroundStyle(colors.text),
          labelStyle('iconOnly'),
          accessibilityLabel('Go back'),
        ]}
      />
    </Host>
  );
}

export function IosNativeSearchField({
  value,
  onChangeText,
  placeholder,
  onSearch,
  autoFocus = false,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  onSearch?: () => void;
  autoFocus?: boolean;
}) {
  const nativeText = useNativeState(value);

  useEffect(() => {
    if (nativeText.get() !== value) nativeText.set(value);
  }, [nativeText, value]);

  return (
    <Host
      colorScheme="dark"
      seedColor={colors.accent}
      ignoreSafeArea="all"
      style={{ height: 48, flex: 1 }}
    >
      <HStack
        spacing={6}
        modifiers={[
          padding({ leading: 16, trailing: 14, vertical: 5 }),
          frame({ maxWidth: Infinity, maxHeight: Infinity }),
          glassEffect({ glass: { variant: 'regular' }, shape: 'capsule' }),
        ]}
      >
        <TextField
          text={nativeText}
          autoFocus={autoFocus}
          placeholder={placeholder}
          onTextChange={onChangeText}
          modifiers={[
            textFieldStyle('plain'),
            font({ size: 15, weight: 'medium' }),
            foregroundStyle(colors.text),
            frame({ maxWidth: Infinity }),
            submitLabel('search'),
            onSubmit(() => onSearch?.()),
          ]}
        />
        {value ? (
          <Button
            label="Clear"
            systemImage="xmark.circle.fill"
            onPress={() => onChangeText('')}
            modifiers={[
              buttonStyle('plain'),
              labelStyle('iconOnly'),
              accessibilityLabel('Clear search'),
            ]}
          />
        ) : null}
        {onSearch ? (
          <Button
            label="Search"
            systemImage="magnifyingglass"
            onPress={onSearch}
            modifiers={[
              buttonStyle('plain'),
              labelStyle('iconOnly'),
              disabledModifier(value.trim().length < 2),
              accessibilityLabel('Search'),
            ]}
          />
        ) : (
          <Image systemName="magnifyingglass" size={18} />
        )}
      </HStack>
    </Host>
  );
}
