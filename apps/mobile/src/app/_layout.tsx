import '../global.css';

import { colors } from '@readoi/design';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';

import { Sidebar } from '@/components/sidebar';
import { ExtensionsProvider } from '@/context/extensions-context';
import { LibraryProvider } from '@/context/library-context';
import { SettingsContext } from '@/context/settings-context';
import { loadSettings, saveSettings } from '@/lib/settings';
import type { Settings } from '@/lib/settings';
import { DEFAULT_SETTINGS } from '@/lib/settings';

export default function RootLayout() {
  const { width } = useWindowDimensions();
  const useBottomNavigation = width < 700;
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const settingsRef = useRef(settings);
  const settingsQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    loadSettings().then((s) => {
      settingsRef.current = s;
      setSettings(s);
      setReady(true);
    });
  }, []);

  const update = useCallback((patch: Partial<Settings>): Promise<void> => {
    const operation = settingsQueue.current.then(async () => {
      const next = { ...settingsRef.current, ...patch };
      await saveSettings(next);
      settingsRef.current = next;
      setSettings(next);
    });
    settingsQueue.current = operation.catch(() => {});
    return operation;
  }, []);

  const value = useMemo(() => ({ settings, ready, update }), [settings, ready, update]);

  // Stremio is a dark-first product; we go dark-only and drop light/dark mixing
  const theme = useMemo(
    () => ({
      ...DarkTheme,
      colors: {
        ...DarkTheme.colors,
        background: colors.background,
        card: colors.background,
        primary: colors.accent,
      },
    }),
    []
  );

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ThemeProvider value={theme}>
        <SettingsContext.Provider value={value}>
          <ExtensionsProvider>
            <LibraryProvider>
              <StatusBar style="light" />
              <SafeAreaView
                className="flex-1"
                edges={['top', 'right', 'bottom', 'left']}
                style={{ backgroundColor: colors.background }}
              >
                <View
                  className="flex-1"
                  style={{ flexDirection: useBottomNavigation ? 'column' : 'row' }}
                >
                  {!useBottomNavigation && <Sidebar />}
                  <View className="flex-1" style={{ backgroundColor: colors.background }}>
                    <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
                  </View>
                  {useBottomNavigation && <Sidebar compact />}
                </View>
              </SafeAreaView>
            </LibraryProvider>
          </ExtensionsProvider>
        </SettingsContext.Provider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
