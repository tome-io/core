import type { DesktopBridge } from '@readoi/contracts';

declare global {
  interface Window {
    readio: DesktopBridge;
  }
}

export {};
