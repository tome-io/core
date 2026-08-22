import '../global.css';

import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';

import { Sidebar } from '@/components/sidebar';
import { LibraryProvider } from '@/context/library-context';
import { SettingsContext } from '@/context/settings-context';
import { loadSettings, saveSettings } from '@/lib/settings';
import type { Settings } from '@/lib/settings';
import { DEFAULT_SETTINGS } from '@/lib/settings';

const BG = '#0b0b0f';

export default function RootLayout() {
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
        background: BG,
        card: BG,
        primary: '#8b7cf6',
      },
    }),
    []
  );

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ThemeProvider value={theme}>
        <SettingsContext.Provider value={value}>
          <LibraryProvider>
            <StatusBar style="light" />
            <SafeAreaView
              className="flex-1"
              edges={['top', 'right', 'bottom', 'left']}
              style={{ backgroundColor: BG }}
            >
              <View className="flex-1 flex-row">
                <Sidebar />
                <View className="flex-1" style={{ backgroundColor: BG }}>
                  <Stack screenOptions={{ headerShown: false }} />
                </View>
              </View>
            </SafeAreaView>
          </LibraryProvider>
        </SettingsContext.Provider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
