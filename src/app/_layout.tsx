import '../global.css';

import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { SettingsContext } from '@/context/settings-context';
import { loadSettings, saveSettings } from '@/lib/settings';
import type { Settings } from '@/lib/settings';
import { DEFAULT_SETTINGS } from '@/lib/settings';

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
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

  const navTheme = useMemo(
    () =>
      colorScheme === 'dark'
        ? { ...DarkTheme, colors: { ...DarkTheme.colors, primary: '#e11d48' } }
        : { ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: '#e11d48' } },
    [colorScheme]
  );

  return (
    <ThemeProvider value={navTheme}>
      {/* Activates NativeWind's dark: variants under class strategy */}
      <View className={`flex-1 ${colorScheme === 'dark' ? 'dark' : ''}`}>
        <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShadowVisible: false,
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="book/[id]"
            options={{ title: '', headerBackTitle: 'Back', headerTransparent: true }}
          />
        </Stack>
      </View>
    </ThemeProvider>
  );
}
