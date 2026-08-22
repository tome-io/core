import '../global.css';

import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { Sidebar } from '@/components/sidebar';
import { SettingsContext } from '@/context/settings-context';
import { loadSettings, saveSettings } from '@/lib/settings';
import type { Settings } from '@/lib/settings';
import { DEFAULT_SETTINGS } from '@/lib/settings';

const BG = '#0b0b0f';

export default function RootLayout() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setReady(true);
    });
  }, []);

  const update = useCallback(async (patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
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
    <ThemeProvider value={theme}>
      <StatusBar style="light" />
      <View className="flex-1 flex-row">
        <Sidebar />
        <View className="flex-1" style={{ backgroundColor: BG }}>
          <Stack screenOptions={{ headerShown: false }} />
        </View>
      </View>
    </ThemeProvider>
  );
}
