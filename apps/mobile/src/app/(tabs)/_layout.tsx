import { colors } from '@tomeio/design';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';
import { Platform } from 'react-native';

/**
 * Tab state stays mounted when switching, while inactive native screens are
 * detached and frozen. The profiler showed `router.replace` remounting Home
 * at 270–480ms / 700–970 fibers.
 */
export default function TabsLayout() {
  if (Platform.OS === 'ios') {
    return (
      <NativeTabs
        tintColor={colors.accent}
        iconColor={{ default: colors.textMuted, selected: colors.accent }}
        labelStyle={{
          default: { color: colors.textMuted },
          selected: { color: colors.accent },
        }}
        minimizeBehavior="never"
      >
        <NativeTabs.Trigger
          name="home"
          contentStyle={{ backgroundColor: colors.background }}
        >
          <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
          <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger
          name="library"
          contentStyle={{ backgroundColor: colors.background }}
        >
          <NativeTabs.Trigger.Icon
            sf={{ default: 'books.vertical', selected: 'books.vertical.fill' }}
          />
          <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger
          name="reading-list"
          contentStyle={{ backgroundColor: colors.background }}
        >
          <NativeTabs.Trigger.Icon sf={{ default: 'bookmark', selected: 'bookmark.fill' }} />
          <NativeTabs.Trigger.Label>Saved</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger
          name="extensions"
          contentStyle={{ backgroundColor: colors.background }}
        >
          <NativeTabs.Trigger.Icon
            sf={{ default: 'puzzlepiece.extension', selected: 'puzzlepiece.extension.fill' }}
          />
          <NativeTabs.Trigger.Label>Add-ons</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger
          name="settings"
          contentStyle={{ backgroundColor: colors.background }}
        >
          <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} />
          <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  return (
    <Tabs>
      <TabSlot />
      <TabList style={{ height: 0, overflow: 'hidden' }} pointerEvents="none">
        <TabTrigger name="home" href="/home" />
        <TabTrigger name="library" href="/library" />
        <TabTrigger name="reading-list" href="/reading-list" />
        <TabTrigger name="extensions" href="/extensions" />
        <TabTrigger name="settings" href="/settings" />
      </TabList>
    </Tabs>
  );
}
