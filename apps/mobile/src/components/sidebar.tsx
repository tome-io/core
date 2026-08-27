import { Ionicons } from '@expo/vector-icons';
import { colors } from '@tomeio/design';
import { usePathname, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { MOBILE_NAV_FADE_HEIGHT, MOBILE_NAV_HEIGHT } from '@/components/app-ui';

const ITEMS = [
  {
    route: '/home',
    label: 'Home',
    icon: 'home' as const,
    outlineIcon: 'home-outline' as const,
  },
  {
    route: '/library',
    label: 'Library',
    icon: 'library' as const,
    outlineIcon: 'library-outline' as const,
  },
  {
    route: '/reading-list',
    label: 'Reading list',
    icon: 'bookmark' as const,
    outlineIcon: 'bookmark-outline' as const,
  },
  {
    route: '/extensions',
    label: 'Add-ons',
    icon: 'extension-puzzle' as const,
    outlineIcon: 'extension-puzzle-outline' as const,
  },
];

const SETTINGS = {
  route: '/settings',
  label: 'Settings',
  icon: 'settings' as const,
  outlineIcon: 'settings-outline' as const,
};

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
          if (!active) router.navigate(item.route as any);
        }}
        className={
          compact
            ? 'h-full flex-1 items-center justify-center gap-1.5 active:scale-95 active:opacity-75'
            : 'h-12 w-12 items-center justify-center rounded-xl'
        }
        style={
          compact
            ? undefined
            : { backgroundColor: active ? colors.accentMuted : 'transparent' }
        }
      >
        <Ionicons
          name={active ? item.icon : item.outlineIcon}
          size={compact ? 29 : 20}
          color={active ? colors.accent : colors.text}
          style={compact && !active ? { opacity: 0.35 } : undefined}
        />
        {compact && (
          <Text
            numberOfLines={1}
            style={{
              color: active ? colors.accent : colors.text,
              fontSize: 11,
              fontWeight: '500',
              opacity: active ? 1 : 0.6,
            }}
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
        pointerEvents="box-none"
        className="w-full"
        style={{
          height: MOBILE_NAV_FADE_HEIGHT,
          backgroundColor: 'transparent',
          experimental_backgroundImage: `linear-gradient(to top, ${colors.background} 0%, rgba(16, 11, 8, 0.96) 24%, rgba(16, 11, 8, 0.78) 48%, rgba(16, 11, 8, 0.46) 70%, rgba(16, 11, 8, 0.16) 88%, rgba(16, 11, 8, 0) 100%)`,
        }}
      >
        <View
          className="absolute right-0 bottom-0 left-0 flex-row items-stretch"
          style={{ height: MOBILE_NAV_HEIGHT, paddingHorizontal: 16 }}
        >
          {[...ITEMS, SETTINGS].map(renderItem)}
        </View>
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
