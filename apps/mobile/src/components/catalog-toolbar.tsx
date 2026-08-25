import { ScrollView, Text, View } from 'react-native';

import { colors, FilterChip } from '@/components/app-ui';

export interface CatalogOption<T extends string> {
  label: string;
  value: T;
}

export function CatalogToolbar<TFilter extends string, TSort extends string>({
  title,
  filters,
  selectedFilter,
  onFilter,
  sorts,
  selectedSort,
  onSort,
}: {
  title?: string;
  filters: CatalogOption<TFilter>[];
  selectedFilter: TFilter;
  onFilter: (value: TFilter) => void;
  sorts: CatalogOption<TSort>[];
  selectedSort: TSort;
  onSort: (value: TSort) => void;
}) {
  return (
    <View className="pt-5 pb-2 gap-4">
      {!!title && <Text className="px-6 text-2xl font-semibold text-neutral-100">{title}</Text>}
      <View className="flex-row items-center gap-5">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingLeft: 24, gap: 8 }}
          className="flex-1"
        >
          {filters.map((option) => (
            <FilterChip
              key={option.value}
              label={option.label}
              selected={option.value === selectedFilter}
              onPress={() => onFilter(option.value)}
            />
          ))}
        </ScrollView>
        <View className="h-7 w-px" style={{ backgroundColor: colors.border }} />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingRight: 24, gap: 8 }}
          style={{ flexGrow: 0, maxWidth: '48%' }}
        >
          {sorts.map((option) => (
            <FilterChip
              key={option.value}
              label={option.label}
              selected={option.value === selectedSort}
              onPress={() => onSort(option.value)}
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}
