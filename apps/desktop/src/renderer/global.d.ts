import type { DesktopBridge } from '@tomeio/contracts';

declare global {
  interface Window {
    tomeio: DesktopBridge;
  }
}

export {};
