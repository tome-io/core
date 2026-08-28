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
  ExtensionLibraryAction,
  ExtensionLibraryBook,
  ExtensionManifest,
  ExtensionPage,
  ExtensionQuery,
  ExtensionReaderSyncRequest,
  ExtensionReaderSyncResult,
} from '@tomeio/extension-protocol';
import type {
  ExtensionRegistrySnapshot,
  InstalledExtension,
} from '@tomeio/extension-runtime';
import { Linking } from 'react-native';

import {
  missingRequiredConfiguration,
  readExtensionConfiguration,
  removeExtensionConfiguration,
  writeExtensionConfiguration,
} from '@/lib/extension-configuration';
import {
  extensionLoader,
  extensionRegistry,
  refreshCommunityExtensionRegistry,
} from '@/lib/extensions';
import {
  readAcquisitionExtensionId,
  readSearchExtensionId,
  writeAcquisitionExtensionId,
  writeSearchExtensionId,
} from '@/lib/extension-preferences';

export interface AvailableLibraryAction extends ExtensionLibraryAction {
  extensionId: string;
}

interface ExtensionsContextValue extends ExtensionRegistrySnapshot {
  ready: boolean;
  error: string | null;
  updateError: string | null;
  searchExtensionId: string | null;
  acquisitionExtensionId: string | null;
  install(repositoryUrl: string): Promise<InstalledExtension>;
  installCommunity(id: string): Promise<InstalledExtension>;
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
  libraryActions(
    book: ExtensionLibraryBook,
    placement: 'library' | 'details',
    platform: 'android' | 'ios' | 'web' | 'desktop'
  ): AvailableLibraryAction[];
  runLibraryAction(
    extensionId: string,
    actionId: string,
    book: ExtensionLibraryBook
  ): Promise<void>;
  readerSync(
    extensionId: string,
    request: ExtensionReaderSyncRequest
  ): Promise<ExtensionReaderSyncResult>;
}

const EMPTY: ExtensionsContextValue = {
  bundled: [],
  community: [],
  thirdParty: [],
  ready: false,
  error: null,
  updateError: null,
  searchExtensionId: null,
  acquisitionExtensionId: null,
  install: async () => {
    throw new Error('Extensions provider is unavailable.');
  },
  installCommunity: async () => {
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
  libraryActions: () => [],
  runLibraryAction: async () => {
    throw new Error('Extensions provider is unavailable.');
  },
  readerSync: async () => {
    throw new Error('Extensions provider is unavailable.');
  },
};

const ExtensionsContext = createContext<ExtensionsContextValue>(EMPTY);

export function ExtensionsProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ExtensionRegistrySnapshot>({
    bundled: [],
    community: [],
    thirdParty: [],
  });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
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
        manifest.resources.some(
          (resource) => resource.name === 'resolve' || resource.name === 'search'
        ) &&
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

  const checkForUpdates = useCallback(async () => {
    const result = await extensionRegistry.updateEnabled(async (manifest) => {
      const values = await readExtensionConfiguration(manifest);
      const missing = missingRequiredConfiguration(manifest, values);
      if (missing.length) {
        throw new Error(`Update requires configuration: ${missing.join(', ')}.`);
      }
      await extensionLoader.load(manifest, values);
    });
    setUpdateError(
      result.failures.length
        ? result.failures
            .map((failure) => `${failure.name}: ${failure.message}`)
            .join('\n')
        : null
    );
    if (result.updated.length) await refresh();
  }, [refresh]);

  useEffect(() => {
    let active = true;
    const start = async () => {
      let communityError: string | null = null;
      try {
        await refreshCommunityExtensionRegistry();
      } catch (cause) {
        communityError = `Community add-ons are unavailable: ${
          cause instanceof Error ? cause.message : String(cause)
        }`;
        console.error('Could not load community extension registry:', cause);
      }
      try {
        await refresh();
        if (active && communityError) setError(communityError);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (active) setError(message);
        console.error('Could not load extension registry:', cause);
      } finally {
        if (active) setReady(true);
      }
      if (!active) return;
      try {
        await checkForUpdates();
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (active) setUpdateError(message);
        console.error('Could not check extension updates:', cause);
      }
    };
    void start();
    return () => {
      active = false;
    };
  }, [checkForUpdates, refresh]);

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
  const installCommunity = useCallback(
    async (id: string) => {
      const extension = await extensionRegistry.installCommunity(id);
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
      return extensionLoader.load(manifest, values);
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
  const libraryActions = useCallback(
    (
      book: ExtensionLibraryBook,
      placement: 'library' | 'details',
      platform: 'android' | 'ios' | 'web' | 'desktop'
    ): AvailableLibraryAction[] => {
      const format = book.localFile?.format.toLowerCase();
      const manifests = [
        ...snapshot.thirdParty
          .filter((extension) => extension.enabled)
          .map((extension) => extension.manifest),
        ...snapshot.bundled,
      ];
      return manifests.flatMap((manifest) =>
          (manifest.libraryActions ?? [])
            .filter((action) => action.placements.includes(placement))
            .filter((action) => !action.requires?.localFile || !!book.localFile)
            .filter(
              (action) =>
                !action.requires?.platforms?.length ||
                action.requires.platforms.includes(platform)
            )
            .filter(
              (action) =>
                !action.requires?.formats?.length ||
                (!!format &&
                  action.requires.formats.some(
                    (candidate) => candidate.toLowerCase() === format
                  ))
            )
            .map((action) => ({ ...action, extensionId: manifest.id }))
        );
    },
    [snapshot.bundled, snapshot.thirdParty]
  );
  const runLibraryAction = useCallback(
    async (extensionId: string, actionId: string, book: ExtensionLibraryBook) => {
      const extension = await load(extensionId);
      if (!extension.libraryAction) {
        throw new Error(`Extension "${extension.manifest.name}" does not provide library actions.`);
      }
      const actionBook =
        extension.manifest.transport.kind === 'host' ||
        extension.manifest.transport.kind === 'device'
          ? book
          : { ...book, localFile: undefined };
      const result = await extension.libraryAction({ actionId, book: actionBook });
      if (result.kind === 'openUrl') {
        const url = new URL(result.url);
        if (url.protocol !== 'https:') {
          throw new Error('Add-on library actions may only open HTTPS URLs.');
        }
        await Linking.openURL(url.toString());
      }
    },
    [load]
  );
  const readerSync = useCallback(
    async (extensionId: string, request: ExtensionReaderSyncRequest) => {
      const extension = await load(extensionId);
      if (!extension.readerSync) {
        throw new Error(`Extension "${extension.manifest.name}" does not provide reader sync.`);
      }
      const localRequest =
        extension.manifest.transport.kind === 'host' ||
        extension.manifest.transport.kind === 'device';
      if (localRequest) return extension.readerSync(request);
      const { sourceUri: _sourceUri, ...remoteRequest } = request;
      return extension.readerSync({
        ...remoteRequest,
        books: request.books.map(({ localFile: _localFile, ...book }) => book),
      });
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
      if (
        !manifest ||
        (!resources.has('resolve') && !resources.has('search')) ||
        !resources.has('acquisition')
      ) {
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
      updateError,
      searchExtensionId,
      acquisitionExtensionId,
      install,
      installCommunity,
      remove,
      setEnabled,
      setSearchExtension,
      setAcquisitionExtension,
      configuration,
      configure,
      load,
      search,
      libraryActions,
      runLibraryAction,
      readerSync,
    }),
    [
      snapshot,
      ready,
      error,
      updateError,
      searchExtensionId,
      acquisitionExtensionId,
      install,
      installCommunity,
      remove,
      setEnabled,
      setSearchExtension,
      setAcquisitionExtension,
      configuration,
      configure,
      load,
      search,
      libraryActions,
      runLibraryAction,
      readerSync,
    ]
  );

  return (
    <ExtensionsContext.Provider value={value}>
      {children}
    </ExtensionsContext.Provider>
  );
}

export function useExtensions(): ExtensionsContextValue {
  return useContext(ExtensionsContext);
}
