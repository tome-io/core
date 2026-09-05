import "../global.css";

import { colors } from "@tomeio/design";
import { DarkTheme, Stack, ThemeProvider, usePathname, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, useWindowDimensions, View } from "react-native";
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";

import { onboardingPreview } from "@/lib/onboarding-preview";
import { Sidebar } from "@/components/sidebar";
import { LibraryActivityToast } from "@/components/library-activity-toast";
import { DownloadProvider } from "@/context/download-context";
import { ExtensionsProvider } from "@/context/extensions-context";
import { HomeNavigationProvider } from "@/context/home-navigation-context";
import { LibraryFileMirrorProvider } from "@/context/library-file-mirror-context";
import { LibraryProvider } from "@/context/library-context";
import { SettingsContext } from "@/context/settings-context";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type Settings,
} from "@/lib/settings";

export default function RootLayout() {
  const { width } = useWindowDimensions();
  const pathname = usePathname();
  const router = useRouter();
  const previewOpened = useRef(false);
  const useBottomNavigation = width < 700;
  const useNativeNavigation = Platform.OS === "ios";
  const isBookOverview = pathname.startsWith("/book/");
  const isReader = pathname.startsWith("/read/");
  const isOnboarding = pathname.startsWith("/onboarding");
  const showSidebar = !isOnboarding && !isReader && !useNativeNavigation && !useBottomNavigation;
  const showBottomNavigation =
    !isOnboarding &&
    !isReader &&
    !useNativeNavigation &&
    useBottomNavigation &&
    !pathname.startsWith("/book/");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!ready || !onboardingPreview || previewOpened.current) return;
    previewOpened.current = true;
    router.replace('/onboarding');
  }, [ready, router]);
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
              <LibraryFileMirrorProvider>
                <DownloadProvider>
                  <HomeNavigationProvider>
                    <StatusBar style="light" />
                    <SafeAreaView
                      className="flex-1"
                      edges={
                        isReader || pathname === "/onboarding"
                          ? []
                          : isBookOverview && !showSidebar
                          ? ["right", "left"]
                          : useNativeNavigation
                            ? ["top", "right", "left"]
                            : ["top", "right", "bottom", "left"]
                      }
                      style={{ backgroundColor: colors.background }}
                    >
                      <View
                        className="flex-1"
                        style={{
                          flexDirection: useBottomNavigation ? "column" : "row",
                        }}
                      >
                        {showSidebar && <Sidebar />}
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
                        {showBottomNavigation && (
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
                      {!isOnboarding && <LibraryActivityToast />}
                    </SafeAreaView>
                  </HomeNavigationProvider>
                </DownloadProvider>
              </LibraryFileMirrorProvider>
            </LibraryProvider>
          </ExtensionsProvider>
        </SettingsContext.Provider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
