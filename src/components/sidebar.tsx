import { Feather } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

const ACCENT = '#8b7cf6';
const BG = '#0b0b0f';

const ITEMS = [
  { route: '/home', label: 'Home', icon: 'home' as const },
  { route: '/search', label: 'Search', icon: 'search' as const },
  { route: '/library', label: 'Library', icon: 'book-open' as const },
  { route: '/reading-list', label: 'Reading list', icon: 'bookmark' as const },
];

const SETTINGS = { route: '/settings', label: 'Settings', icon: 'settings' as const };

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();

  const renderItem = (item: (typeof ITEMS)[number] | typeof SETTINGS) => {
    const active = pathname.startsWith(item.route);
    return (
      <Pressable
        key={item.route}
        accessibilityLabel={item.label}
        accessibilityRole="button"
        onPress={() => {
          if (!active) router.replace(item.route as any);
        }}
        className="h-12 w-12 items-center justify-center rounded-xl"
        style={{
          backgroundColor: active ? 'rgba(139,124,246,0.16)' : 'transparent',
        }}
      >
        <Feather name={item.icon} size={20} color={active ? ACCENT : '#6b6b76'} />
      </Pressable>
    );
  };

  return (
    <View
      className="h-full items-center justify-between py-5"
      style={{ width: 76, backgroundColor: BG }}
    >
      <View className="items-center gap-2">{ITEMS.map(renderItem)}</View>

      <View className="items-center">{renderItem(SETTINGS)}</View>
    </View>
  );
}
