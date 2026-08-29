import "../global.css";

import { colors } from "@tomeio/design";
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWindowDimensions, View } from "react-native";
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";

import { Sidebar } from "@/components/sidebar";
import { AppErrorDialog } from "@/components/app-error-dialog";
import { DownloadProvider } from "@/context/download-context";
import { ExtensionsProvider } from "@/context/extensions-context";
import { HomeNavigationProvider } from "@/context/home-navigation-context";
import { LibraryProvider, useLibraryUiStatus } from "@/context/library-context";
import { SettingsContext } from "@/context/settings-context";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type Settings,
} from "@/lib/settings";

function LibraryStatusDialog() {
  const { error, warning, dismissError, dismissWarning } = useLibraryUiStatus();
  const message = error ?? warning;
  return (
    <AppErrorDialog
      title={error ? "Library error" : "Library needs attention"}
      message={message}
      onClose={error ? dismissError : dismissWarning}
    />
  );
}

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

  const value = useMemo(
    () => ({ settings, ready, update }),
    [settings, ready, update],
  );

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
    [],
  );

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ThemeProvider value={theme}>
        <SettingsContext.Provider value={value}>
          <ExtensionsProvider>
            <LibraryProvider>
              <DownloadProvider>
                <HomeNavigationProvider>
                  <StatusBar style="light" />
                  <SafeAreaView
                    className="flex-1"
                    edges={["top", "right", "bottom", "left"]}
                    style={{ backgroundColor: colors.background }}
                  >
                    <View
                      className="flex-1"
                      style={{
                        flexDirection: useBottomNavigation ? "column" : "row",
                      }}
                    >
                      {!useBottomNavigation && <Sidebar />}
                      <View
                        className="flex-1"
                        style={{ backgroundColor: colors.background }}
                      >
                        <Stack
                          screenOptions={{
                            headerShown: false,
                            animation: "none",
                          }}
                        />
                      </View>
                      {useBottomNavigation && (
                        <View
                          pointerEvents="box-none"
                          style={{
                            position: "absolute",
                            right: 0,
                            bottom: 0,
                            left: 0,
                            zIndex: 20,
                          }}
                        >
                          <Sidebar compact />
                        </View>
                      )}
                    </View>
                    <LibraryStatusDialog />
                  </SafeAreaView>
                </HomeNavigationProvider>
              </DownloadProvider>
            </LibraryProvider>
          </ExtensionsProvider>
        </SettingsContext.Provider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
