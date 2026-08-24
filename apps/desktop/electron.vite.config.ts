import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

const workspacePackages = [
  '@readoi/application',
  '@readoi/contracts',
  '@readoi/database',
  '@readoi/design',
  '@readoi/domain',
  '@readoi/extension-internet-archive',
  '@readoi/extension-open-library',
  '@readoi/extension-project-gutenberg',
  '@readoi/extension-protocol',
  '@readoi/extension-runtime',
  '@readoi/official-extensions',
  '@readoi/sources',
  '@readoi/sync',
];

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: workspacePackages },
    },
  },
  preload: {
    build: {
      externalizeDeps: { exclude: workspacePackages },
    },
  },
  renderer: {
    plugins: [react()],
  },
});
