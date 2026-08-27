import type { DesktopBridge } from '@tomeio/contracts';

declare global {
  interface Window {
    readio: DesktopBridge;
  }
}

export {};
