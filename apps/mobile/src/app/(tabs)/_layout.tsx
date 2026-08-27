import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';

/**
 * Tab state stays mounted when switching, while inactive native screens are
 * detached and frozen. The profiler showed `router.replace` remounting Home
 * at 270–480ms / 700–970 fibers.
 */
export default function TabsLayout() {
  return (
    <Tabs options={{ unmountOnBlur: false, freezeOnBlur: true, lazy: true }}>
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
