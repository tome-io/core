import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  ExtensionRegistrySnapshot,
  InstalledExtension,
} from '@readoi/extension-runtime';

import { extensionRegistry } from '@/lib/extensions';

interface ExtensionsContextValue extends ExtensionRegistrySnapshot {
  ready: boolean;
  error: string | null;
  install(repositoryUrl: string): Promise<InstalledExtension>;
  remove(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
}

const EMPTY: ExtensionsContextValue = {
  bundled: [],
  thirdParty: [],
  ready: false,
  error: null,
  install: async () => {
    throw new Error('Extensions provider is unavailable.');
  },
  remove: async () => {
    throw new Error('Extensions provider is unavailable.');
  },
  setEnabled: async () => {
    throw new Error('Extensions provider is unavailable.');
  },
};

const ExtensionsContext = createContext<ExtensionsContextValue>(EMPTY);

export function ExtensionsProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ExtensionRegistrySnapshot>({
    bundled: [],
    thirdParty: [],
  });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setSnapshot(await extensionRegistry.list());
    setError(null);
  }, []);

  useEffect(() => {
    refresh()
      .catch((cause) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        console.error('Could not load extension registry:', cause);
      })
      .finally(() => setReady(true));
  }, [refresh]);

  const install = useCallback(
    async (repositoryUrl: string) => {
      const extension = await extensionRegistry.install(repositoryUrl);
      await refresh();
      return extension;
    },
    [refresh]
  );
  const remove = useCallback(
    async (id: string) => {
      await extensionRegistry.remove(id);
      await refresh();
    },
    [refresh]
  );
  const setEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      await extensionRegistry.setEnabled(id, enabled);
      await refresh();
    },
    [refresh]
  );

  const value = useMemo(
    () => ({ ...snapshot, ready, error, install, remove, setEnabled }),
    [snapshot, ready, error, install, remove, setEnabled]
  );

  return <ExtensionsContext.Provider value={value}>{children}</ExtensionsContext.Provider>;
}

export function useExtensions(): ExtensionsContextValue {
  return useContext(ExtensionsContext);
}
