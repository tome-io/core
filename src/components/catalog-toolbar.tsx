import { Pressable, ScrollView, Text, View } from 'react-native';

const ACCENT = '#8b7cf6';

export interface CatalogOption<T extends string> {
  label: string;
  value: T;
}

function Chip<T extends string>({ option, selected, onSelect }: {
  option: CatalogOption<T>;
  selected: boolean;
  onSelect: (value: T) => void;
}) {
  return (
    <Pressable
      onPress={() => onSelect(option.value)}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className="h-9 px-4 rounded-full items-center justify-center active:opacity-75"
      style={{ backgroundColor: selected ? ACCENT : '#17171c' }}
    >
      <Text className={selected ? 'text-xs font-semibold text-white' : 'text-xs text-neutral-400'}>
        {option.label}
      </Text>
    </Pressable>
  );
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
            <Chip key={option.value} option={option} selected={option.value === selectedFilter} onSelect={onFilter} />
          ))}
        </ScrollView>
        <View className="h-7 w-px bg-[#292930]" />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingRight: 24, gap: 8 }}
          style={{ flexGrow: 0, maxWidth: '48%' }}
        >
          {sorts.map((option) => (
            <Chip key={option.value} option={option} selected={option.value === selectedSort} onSelect={onSort} />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}
