import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

const workspacePackages = [
  '@tomeio/application',
  '@tomeio/contracts',
  '@tomeio/database',
  '@tomeio/design',
  '@tomeio/domain',
  '@tomeio/extension-open-library',
  '@tomeio/extension-project-gutenberg',
  '@tomeio/extension-protocol',
  '@tomeio/extension-runtime',
  '@tomeio/official-extensions',
  '@tomeio/sources',
  '@tomeio/sync',
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
