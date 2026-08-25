import { Feather } from '@expo/vector-icons';
import { colors } from '@readoi/design';
import { usePathname, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

const ITEMS = [
  { route: '/home', label: 'Home', icon: 'home' as const },
  { route: '/library', label: 'Library', icon: 'book-open' as const },
  { route: '/reading-list', label: 'Reading list', icon: 'bookmark' as const },
  { route: '/extensions', label: 'Add-ons', icon: 'package' as const },
];

const SETTINGS = { route: '/settings', label: 'Settings', icon: 'settings' as const };

interface SidebarProps {
  compact?: boolean;
}

export function Sidebar({ compact = false }: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();

  const renderItem = (item: (typeof ITEMS)[number] | typeof SETTINGS) => {
    const active = pathname.startsWith(item.route);
    return (
      <Pressable
        key={item.route}
        accessibilityLabel={item.label}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        onPress={() => {
          if (!active) router.replace(item.route as any);
        }}
        className={
          compact
            ? 'flex-1 h-full items-center justify-center gap-0.5 active:opacity-75'
            : 'h-12 w-12 items-center justify-center rounded-xl'
        }
        style={
          compact
            ? undefined
            : { backgroundColor: active ? 'rgba(139,124,246,0.16)' : 'transparent' }
        }
      >
        <View
          className="items-center justify-center rounded-xl"
          style={
            compact
              ? {
                  width: 42,
                  height: 27,
                  backgroundColor: active ? 'rgba(139,124,246,0.16)' : 'transparent',
                }
              : undefined
          }
        >
          <Feather
            name={item.icon}
            size={compact ? 19 : 20}
            color={active ? colors.accent : '#6b6b76'}
          />
        </View>
        {compact && (
          <Text
            numberOfLines={1}
            style={{ color: active ? colors.accent : '#777782', fontSize: 9, fontWeight: '600' }}
          >
            {item.label}
          </Text>
        )}
      </Pressable>
    );
  };

  if (compact) {
    return (
      <View
        className="w-full flex-row items-center"
        style={{
          height: 58,
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: 1,
        }}
      >
        {[...ITEMS, SETTINGS].map(renderItem)}
      </View>
    );
  }

  return (
    <View
      className="h-full items-center justify-between pt-5 pb-1"
      style={{ width: 76, backgroundColor: colors.background }}
    >
      <View className="items-center gap-2">{ITEMS.map(renderItem)}</View>

      <View className="items-center">{renderItem(SETTINGS)}</View>
    </View>
  );
}
