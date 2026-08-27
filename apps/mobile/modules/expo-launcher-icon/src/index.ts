import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

export type LauncherIcon = 'full' | 'monochrome';

interface LauncherIconNativeModule {
  getIcon(): Promise<LauncherIcon>;
  setIcon(icon: LauncherIcon): Promise<LauncherIcon>;
}

let nativeModule: LauncherIconNativeModule | null = null;

if (Platform.OS === 'android') {
  try {
    nativeModule = requireNativeModule<LauncherIconNativeModule>('LauncherIcon');
  } catch {
    nativeModule = null;
  }
}

export function hasNativeLauncherIcon(): boolean {
  return nativeModule !== null;
}

function requireLauncherIconModule(): LauncherIconNativeModule {
  if (!nativeModule) {
    throw new Error(
      'Changing the launcher icon requires a freshly built Tomeio Android app. Expo Go and older development builds do not include this native module.'
    );
  }
  return nativeModule;
}

export function getNativeLauncherIcon(): Promise<LauncherIcon> {
  return requireLauncherIconModule().getIcon();
}

export function setNativeLauncherIcon(icon: LauncherIcon): Promise<LauncherIcon> {
  return requireLauncherIconModule().setIcon(icon);
}
