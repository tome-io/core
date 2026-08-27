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
  BookExtension,
  ExtensionConfigValue,
  ExtensionManifest,
  ExtensionPage,
  ExtensionQuery,
} from '@tomeio/extension-protocol';
import type {
  ExtensionRegistrySnapshot,
  InstalledExtension,
} from '@tomeio/extension-runtime';

import { ExtensionSandboxes } from '@/components/extension-sandboxes';
import {
  missingRequiredConfiguration,
  readExtensionConfiguration,
  removeExtensionConfiguration,
  writeExtensionConfiguration,
} from '@/lib/extension-configuration';
import { extensionLoader, extensionRegistry } from '@/lib/extensions';
import {
  readAcquisitionExtensionId,
  readSearchExtensionId,
  writeAcquisitionExtensionId,
  writeSearchExtensionId,
} from '@/lib/extension-preferences';
import { mobileScriptExtensionExecutor } from '@/lib/script-extension-executor';

interface ExtensionsContextValue extends ExtensionRegistrySnapshot {
  ready: boolean;
  error: string | null;
  searchExtensionId: string | null;
  acquisitionExtensionId: string | null;
  install(repositoryUrl: string): Promise<InstalledExtension>;
  remove(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  setSearchExtension(id: string): Promise<void>;
  setAcquisitionExtension(id: string): Promise<void>;
  configuration(manifest: ExtensionManifest): Promise<Record<string, ExtensionConfigValue>>;
  configure(
    manifest: ExtensionManifest,
    values: Record<string, ExtensionConfigValue>
  ): Promise<void>;
  load(id: string): Promise<BookExtension>;
  search(id: string, query: ExtensionQuery): Promise<ExtensionPage<import('@tomeio/domain').BookMetadata>>;
}

const EMPTY: ExtensionsContextValue = {
  bundled: [],
  thirdParty: [],
  ready: false,
  error: null,
  searchExtensionId: null,
  acquisitionExtensionId: null,
  install: async () => {
    throw new Error('Extensions provider is unavailable.');
  },
  remove: async () => {
    throw new Error('Extensions provider is unavailable.');
  },
  setEnabled: async () => {
    throw new Error('Extensions provider is unavailable.');
  },
  setSearchExtension: async () => {},
  setAcquisitionExtension: async () => {},
  configuration: async () => ({}),
  configure: async () => {},
  load: async () => {
    throw new Error('Extensions provider is unavailable.');
  },
  search: async () => {
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
  const [searchExtensionId, setSearchExtensionId] = useState<string | null>(null);
  const [acquisitionExtensionId, setAcquisitionExtensionId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await extensionRegistry.list();
    setSnapshot(next);
    const [savedSearchId, savedAcquisitionId] = await Promise.all([
      readSearchExtensionId(),
      readAcquisitionExtensionId(),
    ]);
    const enabledManifests = [
      ...next.thirdParty.filter((extension) => extension.enabled).map((extension) => extension.manifest),
      ...next.bundled,
    ];
    const searchCandidates = enabledManifests.filter((manifest) =>
      manifest.resources.some((resource) => resource.name === 'search')
    );
    const acquisitionCandidates = enabledManifests.filter(
      (manifest) =>
        manifest.resources.some((resource) => resource.name === 'search') &&
        manifest.resources.some((resource) => resource.name === 'acquisition')
    );
    const selectedSearch = searchCandidates.some((manifest) => manifest.id === savedSearchId)
      ? savedSearchId
      : searchCandidates.find((manifest) => manifest.id === 'org.tomeio.open-library')?.id ??
        searchCandidates[0]?.id ??
        null;
    const selectedAcquisition = acquisitionCandidates.some(
      (manifest) => manifest.id === savedAcquisitionId
    )
      ? savedAcquisitionId
      : acquisitionCandidates.some((manifest) => manifest.id === savedSearchId)
        ? savedSearchId
        : acquisitionCandidates.find(
              (manifest) => manifest.id === 'org.tomeio.internet-archive'
            )?.id ??
          acquisitionCandidates[0]?.id ??
          null;
    await Promise.all([
      selectedSearch !== savedSearchId
        ? writeSearchExtensionId(selectedSearch)
        : Promise.resolve(),
      selectedAcquisition !== savedAcquisitionId
        ? writeAcquisitionExtensionId(selectedAcquisition)
        : Promise.resolve(),
    ]);
    setSearchExtensionId(selectedSearch);
    setAcquisitionExtensionId(selectedAcquisition);
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
      const values = await readExtensionConfiguration(extension.manifest);
      if (missingRequiredConfiguration(extension.manifest, values).length) {
        await extensionRegistry.setEnabled(extension.manifest.id, false);
      }
      await refresh();
      return extension;
    },
    [refresh]
  );
  const remove = useCallback(
    async (id: string) => {
      const extension = snapshot.thirdParty.find((candidate) => candidate.manifest.id === id);
      await extensionRegistry.remove(id);
      if (extension) await removeExtensionConfiguration(extension.manifest);
      await mobileScriptExtensionExecutor.purge(id);
      await refresh();
    },
    [refresh, snapshot.thirdParty]
  );

  const configuration = useCallback(
    (manifest: ExtensionManifest) => readExtensionConfiguration(manifest),
    []
  );
  const configure = useCallback(
    async (
      manifest: ExtensionManifest,
      values: Record<string, ExtensionConfigValue>
    ) => {
      await writeExtensionConfiguration(manifest, values);
      mobileScriptExtensionExecutor.invalidate(manifest.id);
      if (!missingRequiredConfiguration(manifest, values).length) {
        const installed = snapshot.thirdParty.find(
          (candidate) => candidate.manifest.id === manifest.id
        );
        if (installed && !installed.enabled) await extensionRegistry.setEnabled(manifest.id, true);
      }
      await refresh();
    },
    [refresh, snapshot.thirdParty]
  );
  const load = useCallback(
    async (id: string) => {
      const installed = snapshot.thirdParty.find((candidate) => candidate.manifest.id === id);
      const manifest =
        installed?.manifest ?? snapshot.bundled.find((candidate) => candidate.id === id);
      if (!manifest || (installed && !installed.enabled)) {
        throw new Error(`Extension "${id}" is not enabled.`);
      }
      const values = await readExtensionConfiguration(manifest);
      const missing = missingRequiredConfiguration(manifest, values);
      if (missing.length) {
        throw new Error(
          `Extension "${manifest.name}" requires configuration: ${missing.join(', ')}.`
        );
      }
      return extensionLoader.load(manifest);
    },
    [snapshot]
  );
  const search = useCallback(
    async (id: string, query: ExtensionQuery) => {
      const extension = await load(id);
      if (!extension.search) throw new Error(`Extension "${id}" does not provide search.`);
      return extension.search(query);
    },
    [load]
  );
  const setEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      if (enabled) {
        const installed = snapshot.thirdParty.find(
          (candidate) => candidate.manifest.id === id
        );
        if (!installed) throw new Error(`Extension "${id}" is not installed.`);
        const values = await readExtensionConfiguration(installed.manifest);
        const missing = missingRequiredConfiguration(installed.manifest, values);
        if (missing.length) {
          throw new Error(
            `Configure ${installed.manifest.name} before enabling it: ${missing.join(', ')}.`
          );
        }
      }
      await extensionRegistry.setEnabled(id, enabled);
      await refresh();
    },
    [refresh, snapshot.thirdParty]
  );
  const setSearchExtension = useCallback(
    async (id: string) => {
      const manifest = [
        ...snapshot.thirdParty
          .filter((extension) => extension.enabled)
          .map((extension) => extension.manifest),
        ...snapshot.bundled,
      ].find((candidate) => candidate.id === id);
      if (!manifest?.resources.some((resource) => resource.name === 'search')) {
        throw new Error(`Extension "${id}" is not an enabled search provider.`);
      }
      await writeSearchExtensionId(id);
      setSearchExtensionId(id);
    },
    [snapshot]
  );
  const setAcquisitionExtension = useCallback(
    async (id: string) => {
      const manifest = [
        ...snapshot.thirdParty
          .filter((extension) => extension.enabled)
          .map((extension) => extension.manifest),
        ...snapshot.bundled,
      ].find((candidate) => candidate.id === id);
      const resources = new Set(manifest?.resources.map((resource) => resource.name));
      if (!manifest || !resources.has('search') || !resources.has('acquisition')) {
        throw new Error(`Extension "${id}" cannot resolve and download books.`);
      }
      await writeAcquisitionExtensionId(id);
      setAcquisitionExtensionId(id);
    },
    [snapshot]
  );

  const value = useMemo(
    () => ({
      ...snapshot,
      ready,
      error,
      searchExtensionId,
      acquisitionExtensionId,
      install,
      remove,
      setEnabled,
      setSearchExtension,
      setAcquisitionExtension,
      configuration,
      configure,
      load,
      search,
    }),
    [
      snapshot,
      ready,
      error,
      searchExtensionId,
      acquisitionExtensionId,
      install,
      remove,
      setEnabled,
      setSearchExtension,
      setAcquisitionExtension,
      configuration,
      configure,
      load,
      search,
    ]
  );

  return (
    <ExtensionsContext.Provider value={value}>
      {children}
      <ExtensionSandboxes />
    </ExtensionsContext.Provider>
  );
}

export function useExtensions(): ExtensionsContextValue {
  return useContext(ExtensionsContext);
}
