import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  BookExtension,
  ExtensionConfigValue,
  ExtensionBookReference,
  ExtensionLibraryAction,
  ExtensionLibraryBook,
  ExtensionLibraryImport,
  ExtensionManifest,
  ExtensionPage,
  ExtensionQuery,
  ExtensionReaderSyncRequest,
  ExtensionReaderSyncResult,
  ExtensionReaderSetup,
  ExtensionReaderSetupRequest,
  ExtensionReaderSetupResult,
  ExtensionReviewsQuery,
} from '@tomeio/extension-protocol';
import { supportsExtensionProviderRole } from '@tomeio/extension-protocol';
import type { BookMetadata, BookReview } from '@tomeio/domain';
import type {
  ExtensionRegistrySnapshot,
  InstalledExtension,
} from '@tomeio/extension-runtime';
import { Linking, Platform } from 'react-native';

import {
  missingRequiredConfiguration,
  readExtensionConfiguration,
  removeExtensionConfiguration,
  writeExtensionConfiguration,
} from '@/lib/extension-configuration';
import { openLocalFileInAndroidPackage } from '@/lib/device-extension-host';
import {
  extensionLoader,
  extensionRegistry,
  refreshCommunityExtensionRegistry,
} from '@/lib/extensions';
import {
  readDiscoveryExtensionId,
  readAcquisitionExtensionId,
  readSearchExtensionId,
  writeDiscoveryExtensionId,
  writeAcquisitionExtensionId,
  writeSearchExtensionId,
} from '@/lib/extension-preferences';
import { cachedExtensionResult } from '@/lib/extension-result-cache';

export interface AvailableLibraryAction extends ExtensionLibraryAction {
  extensionId: string;
}

export interface AvailableLibraryImport extends ExtensionLibraryImport {
  extensionId: string;
  extensionName: string;
}

export interface AvailableReaderSetup extends ExtensionReaderSetup {
  extensionId: string;
  extensionName: string;
}

export interface AvailableCoverProvider {
  id: string;
  name: string;
  version: string;
}

export interface AvailableReviewProvider {
  id: string;
  name: string;
  attribution?: ExtensionManifest['attribution'];
}

interface ExtensionsContextValue extends ExtensionRegistrySnapshot {
  ready: boolean;
  error: string | null;
  updateError: string | null;
  discoveryExtensionId: string | null;
  searchExtensionId: string | null;
  acquisitionExtensionId: string | null;
  install(repositoryUrl: string): Promise<InstalledExtension>;
  installCommunity(id: string): Promise<InstalledExtension>;
  refreshCommunity(): Promise<void>;
  remove(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  setDiscoveryExtension(id: string): Promise<void>;
  setSearchExtension(id: string): Promise<void>;
  setAcquisitionExtension(id: string): Promise<void>;
  configuration(manifest: ExtensionManifest): Promise<Record<string, ExtensionConfigValue>>;
  configure(
    manifest: ExtensionManifest,
    values: Record<string, ExtensionConfigValue>
  ): Promise<void>;
  load(id: string): Promise<BookExtension>;
  catalog(id: string, query: ExtensionQuery): Promise<ExtensionPage<BookMetadata>>;
  search(id: string, query: ExtensionQuery): Promise<ExtensionPage<BookMetadata>>;
  coverProviders(): AvailableCoverProvider[];
  resolveBooks(extensionId: string, book: ExtensionBookReference): Promise<BookMetadata[]>;
  cover(extensionId: string, book: ExtensionBookReference): Promise<string | null>;
  reviewProviders(): AvailableReviewProvider[];
  reviews(
    extensionId: string,
    query: ExtensionReviewsQuery
  ): Promise<ExtensionPage<BookReview>>;
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
  libraryImports(): AvailableLibraryImport[];
  runLibraryImport(
    extensionId: string,
    importId: string,
    sourceUri: string,
    filename: string
  ): Promise<ExtensionReaderSyncResult>;
  readerSync(
    extensionId: string,
    request: ExtensionReaderSyncRequest
  ): Promise<ExtensionReaderSyncResult>;
  readerSetups(): AvailableReaderSetup[];
  runReaderSetup(
    extensionId: string,
    request: ExtensionReaderSetupRequest
  ): Promise<ExtensionReaderSetupResult>;
}

const EMPTY: ExtensionsContextValue = {
  bundled: [],
  community: [],
  thirdParty: [],
  ready: false,
  error: null,
  updateError: null,
  discoveryExtensionId: null,
  searchExtensionId: null,
  acquisitionExtensionId: null,
  install: async () => {
    throw new Error('Extensions provider is unavailable.');
  },
  installCommunity: async () => {
    throw new Error('Extensions provider is unavailable.');
  },
  refreshCommunity: async () => {
    throw new Error('Extensions provider is unavailable.');
  },
  remove: async () => {
    throw new Error('Extensions provider is unavailable.');
  },
  setEnabled: async () => {
    throw new Error('Extensions provider is unavailable.');
  },
  setDiscoveryExtension: async () => {},
  setSearchExtension: async () => {},
  setAcquisitionExtension: async () => {},
  configuration: async () => ({}),
  configure: async () => {},
  load: async () => {
    throw new Error('Extensions provider is unavailable.');
  },
  catalog: async () => {
    throw new Error('Extensions provider is unavailable.');
  },
  search: async () => {
    throw new Error('Extensions provider is unavailable.');
  },
  coverProviders: () => [],
  resolveBooks: async () => {
    throw new Error('Extensions provider is unavailable.');
  },
  cover: async () => {
    throw new Error('Extensions provider is unavailable.');
  },
  reviewProviders: () => [],
  reviews: async () => {
    throw new Error('Extensions provider is unavailable.');
  },
  libraryActions: () => [],
  runLibraryAction: async () => {
    throw new Error('Extensions provider is unavailable.');
  },
  libraryImports: () => [],
  runLibraryImport: async () => {
    throw new Error('Extensions provider is unavailable.');
  },
  readerSync: async () => {
    throw new Error('Extensions provider is unavailable.');
  },
  readerSetups: () => [],
  runReaderSetup: async () => {
    throw new Error('Extensions provider is unavailable.');
  },
};

const ExtensionsContext = createContext<ExtensionsContextValue>(EMPTY);

function sameRegistrySection(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function ExtensionsProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ExtensionRegistrySnapshot>({
    bundled: [],
    community: [],
    thirdParty: [],
  });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [discoveryExtensionId, setDiscoveryExtensionId] = useState<string | null>(null);
  const [searchExtensionId, setSearchExtensionId] = useState<string | null>(null);
  const [acquisitionExtensionId, setAcquisitionExtensionId] = useState<string | null>(null);
  const discoveryExtensionIdRef = useRef<string | null>(null);
  const searchExtensionIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await extensionRegistry.list();
    setSnapshot((current) => {
      const bundled = sameRegistrySection(current.bundled, next.bundled)
        ? current.bundled
        : next.bundled;
      const community = sameRegistrySection(current.community, next.community)
        ? current.community
        : next.community;
      const thirdParty = sameRegistrySection(current.thirdParty, next.thirdParty)
        ? current.thirdParty
        : next.thirdParty;
      return bundled === current.bundled &&
        community === current.community &&
        thirdParty === current.thirdParty
        ? current
        : { bundled, community, thirdParty };
    });
    const [savedDiscoveryId, savedSearchId, savedAcquisitionId] = await Promise.all([
      readDiscoveryExtensionId(),
      readSearchExtensionId(),
      readAcquisitionExtensionId(),
    ]);
    const enabledManifests = [
      ...next.thirdParty.filter((extension) => extension.enabled).map((extension) => extension.manifest),
      ...next.bundled,
    ];
    const searchCandidates = enabledManifests.filter((manifest) =>
      supportsExtensionProviderRole(manifest, 'search')
    );
    const discoveryCandidates = enabledManifests.filter((manifest) =>
      supportsExtensionProviderRole(manifest, 'discovery')
    );
    const selectedDiscovery = discoveryCandidates.some(
      (manifest) => manifest.id === savedDiscoveryId
    )
      ? savedDiscoveryId
      : discoveryCandidates.find((manifest) => manifest.id === 'org.tomeio.open-library')?.id ??
        discoveryCandidates[0]?.id ??
        null;
    const acquisitionCandidates = enabledManifests.filter((manifest) =>
      supportsExtensionProviderRole(manifest, 'acquisition')
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
              (manifest) => manifest.id === 'org.tomeio.open-library'
            )?.id ??
          acquisitionCandidates[0]?.id ??
          null;
    await Promise.all([
      selectedDiscovery !== savedDiscoveryId
        ? writeDiscoveryExtensionId(selectedDiscovery)
        : Promise.resolve(),
      selectedSearch !== savedSearchId
        ? writeSearchExtensionId(selectedSearch)
        : Promise.resolve(),
      selectedAcquisition !== savedAcquisitionId
        ? writeAcquisitionExtensionId(selectedAcquisition)
        : Promise.resolve(),
    ]);
    discoveryExtensionIdRef.current = selectedDiscovery;
    searchExtensionIdRef.current = selectedSearch;
    setDiscoveryExtensionId(selectedDiscovery);
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

  const refreshCommunity = useCallback(async () => {
    try {
      await refreshCommunityExtensionRegistry();
      await refresh();
      await checkForUpdates();
    } catch (cause) {
      const message = `Community add-ons are unavailable: ${
        cause instanceof Error ? cause.message : String(cause)
      }`;
      setError(message);
      throw cause;
    }
  }, [checkForUpdates, refresh]);

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
      if (id !== searchExtensionIdRef.current) {
        throw new Error(`Extension "${id}" is not the active search provider.`);
      }
      const extension = await load(id);
      if (!extension.search) throw new Error(`Extension "${id}" does not provide search.`);
      return extension.search(query);
    },
    [load]
  );
  const catalog = useCallback(
    async (id: string, query: ExtensionQuery) => {
      if (id !== discoveryExtensionIdRef.current) {
        throw new Error(`Extension "${id}" is not the active discovery provider.`);
      }
      const extension = await load(id);
      if (!extension.catalog) throw new Error(`Extension "${id}" does not provide catalogs.`);
      return extension.catalog(query);
    },
    [load]
  );
  const coverProviders = useCallback((): AvailableCoverProvider[] => {
    const manifests = [
      ...snapshot.thirdParty
        .filter((extension) => extension.enabled)
        .map((extension) => extension.manifest),
      ...snapshot.bundled,
    ].filter((manifest) => supportsExtensionProviderRole(manifest, 'cover'));
    const priority = (id: string) =>
      id === 'org.tomeio.open-library'
        ? 0
        : id === 'community.tomeio.zlibrary'
          ? 1
          : 2;
    return manifests
      .map((manifest) => ({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
      }))
      .sort(
        (left, right) =>
          priority(left.id) - priority(right.id) ||
          left.name.localeCompare(right.name)
      );
  }, [snapshot.bundled, snapshot.thirdParty]);
  const resolveBooks = useCallback(
    async (extensionId: string, book: ExtensionBookReference) => {
      const provider = coverProviders().find(
        (candidate) => candidate.id === extensionId
      );
      if (!provider) {
        throw new Error(`Extension "${extensionId}" is not an enabled cover provider.`);
      }
      const extension = await load(extensionId);
      if (!extension.resolve) {
        throw new Error(`Extension "${provider.name}" does not resolve books.`);
      }
      const key = `resolve:${extensionId}@${provider.version}:${JSON.stringify(book)}`;
      const resolved = await cachedExtensionResult(key, () =>
        extension.resolve!({ book, page: 1, limit: 8 })
      );
      return resolved.items;
    },
    [coverProviders, load]
  );
  const cover = useCallback(
    async (extensionId: string, book: ExtensionBookReference) =>
      (await resolveBooks(extensionId, book)).find((candidate) => !!candidate.coverUrl)
        ?.coverUrl ?? null,
    [resolveBooks]
  );
  const reviewProviders = useCallback((): AvailableReviewProvider[] => {
    const manifests = [
      ...snapshot.thirdParty
        .filter((extension) => extension.enabled)
        .map((extension) => extension.manifest),
      ...snapshot.bundled,
    ].filter((manifest) => supportsExtensionProviderRole(manifest, 'reviews'));
    return manifests
      .map((manifest) => ({
        id: manifest.id,
        name: manifest.name,
        ...(manifest.attribution ? { attribution: manifest.attribution } : {}),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [snapshot.bundled, snapshot.thirdParty]);
  const reviews = useCallback(
    async (extensionId: string, query: ExtensionReviewsQuery) => {
      const provider = reviewProviders().find((candidate) => candidate.id === extensionId);
      if (!provider) {
        throw new Error(`Extension "${extensionId}" is not an enabled review provider.`);
      }
      const extension = await load(extensionId);
      if (!extension.reviews) {
        throw new Error(`Extension "${provider.name}" does not provide reviews.`);
      }
      return extension.reviews(query);
    },
    [load, reviewProviders]
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
          : {
              ...book,
              localFile: book.localFile
                ? {
                    format: book.localFile.format,
                  }
                : undefined,
            };
      const platform =
        Platform.OS === 'android' || Platform.OS === 'ios' || Platform.OS === 'web'
          ? Platform.OS
          : 'desktop';
      const result = await extension.libraryAction({ actionId, book: actionBook, platform });
      if (result.kind === 'openUrl') {
        const url = new URL(result.url);
        if (url.protocol !== 'https:') {
          throw new Error('Add-on library actions may only open HTTPS URLs.');
        }
        await Linking.openURL(url.toString());
      } else if (result.kind === 'openLocalFile') {
        if (!extension.manifest.permissions?.androidPackages?.includes(result.packageName)) {
          throw new Error(
            `Add-on "${extension.manifest.name}" requested an undeclared Android package.`
          );
        }
        if (!book.localFile?.uri) {
          throw new Error('Download this book before opening it in another reading app.');
        }
        await openLocalFileInAndroidPackage(book.localFile, result.packageName);
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
  const libraryImports = useCallback((): AvailableLibraryImport[] => {
    const platform =
      Platform.OS === 'android' || Platform.OS === 'ios' || Platform.OS === 'web'
        ? Platform.OS
        : 'desktop';
    return snapshot.thirdParty
      .filter((extension) => extension.enabled)
      .flatMap((extension) =>
        (extension.manifest.libraryImports ?? [])
          .filter(
            (libraryImport) =>
              !libraryImport.platforms?.length || libraryImport.platforms.includes(platform)
          )
          .map((libraryImport) => ({
            ...libraryImport,
            extensionId: extension.manifest.id,
            extensionName: extension.manifest.name,
          }))
      );
  }, [snapshot.thirdParty]);
  const readerSetups = useCallback((): AvailableReaderSetup[] => {
    const platform =
      Platform.OS === 'android' || Platform.OS === 'ios' || Platform.OS === 'web'
        ? Platform.OS
        : 'desktop';
    return snapshot.thirdParty
      .filter((extension) => extension.enabled)
      .flatMap((extension) =>
        (extension.manifest.readerSetups ?? [])
          .filter(
            (setup) => !setup.platforms?.length || setup.platforms.includes(platform)
          )
          .map((setup) => ({
            ...setup,
            extensionId: extension.manifest.id,
            extensionName: extension.manifest.name,
          }))
      );
  }, [snapshot.thirdParty]);
  const runReaderSetup = useCallback(
    async (extensionId: string, request: ExtensionReaderSetupRequest) => {
      const extension = await load(extensionId);
      if (extension.manifest.transport.kind !== 'host' || !extension.readerSetup) {
        throw new Error('Reader setup is available only to reviewed host integrations.');
      }
      const descriptor = extension.manifest.readerSetups?.find(
        (candidate) => candidate.id === request.setupId
      );
      if (!descriptor) {
        throw new Error(`Extension "${extension.manifest.name}" does not provide this setup.`);
      }
      return extension.readerSetup(request);
    },
    [load]
  );
  const runLibraryImport = useCallback(
    async (extensionId: string, importId: string, sourceUri: string, filename: string) => {
      const extension = await load(extensionId);
      if (
        extension.manifest.transport.kind !== 'host' &&
        extension.manifest.transport.kind !== 'device'
      ) {
        throw new Error('Backup files may be read only by reviewed local integrations.');
      }
      const descriptor = extension.manifest.libraryImports?.find(
        (candidate) => candidate.id === importId
      );
      if (!descriptor || !extension.libraryImport) {
        throw new Error(`Extension "${extension.manifest.name}" does not provide this import.`);
      }
      const platform =
        Platform.OS === 'android' || Platform.OS === 'ios' || Platform.OS === 'web'
          ? Platform.OS
          : 'desktop';
      return extension.libraryImport({ importId, sourceUri, filename, platform });
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
      if (!manifest || !supportsExtensionProviderRole(manifest, 'search')) {
        throw new Error(`Extension "${id}" is not an enabled search provider.`);
      }
      await writeSearchExtensionId(id);
      searchExtensionIdRef.current = id;
      setSearchExtensionId(id);
    },
    [snapshot]
  );
  const setDiscoveryExtension = useCallback(
    async (id: string) => {
      const manifest = [
        ...snapshot.thirdParty
          .filter((extension) => extension.enabled)
          .map((extension) => extension.manifest),
        ...snapshot.bundled,
      ].find((candidate) => candidate.id === id);
      if (!manifest || !supportsExtensionProviderRole(manifest, 'discovery')) {
        throw new Error(`Extension "${id}" is not an enabled discovery provider.`);
      }
      await writeDiscoveryExtensionId(id);
      discoveryExtensionIdRef.current = id;
      setDiscoveryExtensionId(id);
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
      if (!manifest || !supportsExtensionProviderRole(manifest, 'acquisition')) {
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
      discoveryExtensionId,
      searchExtensionId,
      acquisitionExtensionId,
      install,
      installCommunity,
      refreshCommunity,
      remove,
      setEnabled,
      setDiscoveryExtension,
      setSearchExtension,
      setAcquisitionExtension,
      configuration,
      configure,
      load,
      catalog,
      search,
      coverProviders,
      resolveBooks,
      cover,
      reviewProviders,
      reviews,
      libraryActions,
      runLibraryAction,
      libraryImports,
      runLibraryImport,
      readerSync,
      readerSetups,
      runReaderSetup,
    }),
    [
      snapshot,
      ready,
      error,
      updateError,
      discoveryExtensionId,
      searchExtensionId,
      acquisitionExtensionId,
      install,
      installCommunity,
      refreshCommunity,
      remove,
      setEnabled,
      setDiscoveryExtension,
      setSearchExtension,
      setAcquisitionExtension,
      configuration,
      configure,
      load,
      catalog,
      search,
      coverProviders,
      resolveBooks,
      cover,
      reviewProviders,
      reviews,
      libraryActions,
      runLibraryAction,
      libraryImports,
      runLibraryImport,
      readerSync,
      readerSetups,
      runReaderSetup,
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
