import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  type StyleProp,
  Text,
  View,
  type ViewStyle,
} from 'react-native';

import { AppDialog, colors, radii, usePageGutter } from '@/components/app-ui';

export interface CatalogOption<T extends string> {
  label: string;
  value: T;
}

export function CatalogToolbar<TFilter extends string, TSort extends string>({
  title,
  filters,
  selectedFilter,
  onFilter,
  filterLabel = 'Filter',
  sorts,
  selectedSort,
  onSort,
  sortLabel = 'Sort',
}: {
  title?: string;
  filters: CatalogOption<TFilter>[];
  selectedFilter: TFilter;
  onFilter: (value: TFilter) => void;
  filterLabel?: string;
  sorts: CatalogOption<TSort>[];
  selectedSort: TSort;
  onSort: (value: TSort) => void;
  sortLabel?: string;
}) {
  const gutter = usePageGutter();
  const [openPicker, setOpenPicker] = useState<'filter' | 'sort' | null>(null);
  const selectedFilterOption = filters.find((option) => option.value === selectedFilter);
  const selectedSortOption = sorts.find((option) => option.value === selectedSort);
  const pickerOptions: CatalogOption<string>[] = openPicker === 'filter' ? filters : sorts;
  const selectedValue = openPicker === 'filter' ? selectedFilter : selectedSort;

  const select = (value: string) => {
    if (openPicker === 'filter') onFilter(value as TFilter);
    if (openPicker === 'sort') onSort(value as TSort);
  };

  return (
    <View className="gap-4 pb-2 pt-3">
      {!!title && (
        <Text
          className="text-2xl font-semibold text-neutral-100"
          style={{ paddingHorizontal: gutter }}
        >
          {title}
        </Text>
      )}
      <View className="flex-row gap-3" style={{ paddingHorizontal: gutter }}>
        <CatalogSelect
          label={filterLabel}
          value={selectedFilterOption?.label ?? selectedFilter}
          onPress={() => setOpenPicker('filter')}
          style={{ flex: 1 }}
        />
        <CatalogSelect
          label={sortLabel}
          value={selectedSortOption?.label ?? selectedSort}
          onPress={() => setOpenPicker('sort')}
          style={{ flex: 1 }}
        />
      </View>
      <CatalogOptionsDialog
        visible={openPicker !== null}
        title={openPicker === 'filter' ? filterLabel : sortLabel}
        options={pickerOptions}
        selectedValue={selectedValue}
        onSelect={select}
        onClose={() => setOpenPicker(null)}
      />
    </View>
  );
}

export function CatalogOptionsDialog<T extends string>({
  visible,
  title,
  options,
  selectedValue,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: CatalogOption<T>[];
  selectedValue: T;
  onSelect: (value: T) => void;
  onClose: () => void;
}) {
  if (!visible) return null;

  return (
    <AppDialog visible={visible} title={title} onClose={onClose}>
      <ScrollView
        className="max-h-[420px]"
        contentContainerStyle={{ gap: 8 }}
        showsVerticalScrollIndicator={false}
      >
        {options.map((option) => {
          const selected = option.value === selectedValue;
          return (
            <Pressable
              key={option.value}
              onPress={() => {
                onSelect(option.value);
                onClose();
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              className="h-12 flex-row items-center rounded-xl px-4 active:opacity-75"
              style={{
                backgroundColor: selected ? colors.accentMuted : colors.surfaceRaised,
              }}
            >
              <Text
                className="flex-1 text-sm font-medium"
                style={{ color: selected ? colors.accent : colors.text }}
              >
                {option.label}
              </Text>
              {selected ? <Feather name="check" size={18} color={colors.accent} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </AppDialog>
  );
}

export function CatalogSelect({
  label,
  value,
  onPress,
  style,
}: {
  label: string;
  value: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      className="h-12 min-w-0 flex-row items-center gap-3 px-4 active:opacity-75"
      style={[{ backgroundColor: colors.surfaceRaised, borderRadius: radii.pill }, style]}
    >
      <View className="min-w-0 flex-1">
        <Text
          className="text-[9px] font-semibold uppercase tracking-wider"
          style={{ color: colors.textMuted }}
        >
          {label}
        </Text>
        <Text numberOfLines={1} className="text-sm font-medium" style={{ color: colors.text }}>
          {value}
        </Text>
      </View>
      <Feather name="chevron-down" size={17} color={colors.textMuted} />
    </Pressable>
  );
}
