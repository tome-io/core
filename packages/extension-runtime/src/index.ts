import {
  parseExtensionManifest,
  parseBookAcquisition,
  parseBookMetadata,
  parseExtensionPage,
  parseExtensionReviewPage,
  parseExtensionLibraryActionResult,
  type BookExtension,
  type ExtensionQuery,
  type ExtensionManifest,
  type ExtensionConfigValue,
  type ExtensionLibraryActionRequest,
  type ExtensionLibraryImportRequest,
  type ExtensionResourceName,
  type ExtensionResolveQuery,
  type ExtensionReviewsQuery,
  type ExtensionReaderSyncRequest,
  type ExtensionReaderSyncResult,
  type ExtensionWorkflowDefinition,
} from '@tomeio/extension-protocol';
import {
  createDeclarativeWorkflowExtension,
  fetchWorkflowDefinition,
} from './declarative';
import {
  createDeviceWorkflowExtension,
  fetchDeviceWorkflowDefinition,
  type ExtensionDeviceHost,
} from './device';

export { parseWorkflowDefinition } from './declarative';
export {
  parseDeviceWorkflowDefinition,
  type ExtensionDeviceExecutionContext,
  type ExtensionDeviceHost,
} from './device';

export interface InstalledExtension {
  manifest: ExtensionManifest;
  manifestUrl: string;
  repositoryUrl: string;
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
  source?: 'community' | 'third-party';
}

export interface CommunityExtension {
  manifest: ExtensionManifest;
  manifestUrl: string;
  repositoryUrl: string;
  minimumClientVersion?: string;
  reviewedAt?: string;
  hostAdapters?: string[];
  deviceCapabilities?: string[];
  androidPackages?: string[];
}

export interface ExtensionRegistryStore {
  read(): Promise<InstalledExtension[]>;
  write(extensions: InstalledExtension[]): Promise<void>;
}

export interface ExtensionRegistrySnapshot {
  bundled: ExtensionManifest[];
  community: CommunityExtension[];
  thirdParty: InstalledExtension[];
}

export interface ExtensionUpdateFailure {
  id: string;
  name: string;
  message: string;
}

export interface ExtensionUpdateResult {
  updated: InstalledExtension[];
  failures: ExtensionUpdateFailure[];
}

interface ExtensionUpdateCheck {
  extension: InstalledExtension;
  updated?: InstalledExtension;
  failure?: ExtensionUpdateFailure;
}

interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function semanticVersion(value: string): SemanticVersion | null {
  const match = value.trim().match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
  );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.') ?? [],
  };
}

export function compareExtensionVersions(left: string, right: string): number | null {
  const a = semanticVersion(left);
  const b = semanticVersion(right);
  if (!a || !b) return null;
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    if (a.prerelease.length === b.prerelease.length) return 0;
    return a.prerelease.length ? -1 : 1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart == null) return -1;
    if (rightPart == null) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber != null && rightNumber != null) return leftNumber > rightNumber ? 1 : -1;
    if (leftNumber != null) return -1;
    if (rightNumber != null) return 1;
    return leftPart.localeCompare(rightPart) > 0 ? 1 : -1;
  }
  return 0;
}

function validateInstalledExtension(value: InstalledExtension): InstalledExtension {
  if (
    typeof value !== 'object' ||
    value == null ||
    typeof value.manifestUrl !== 'string' ||
    typeof value.repositoryUrl !== 'string' ||
    typeof value.enabled !== 'boolean' ||
    typeof value.installedAt !== 'number' ||
    typeof value.updatedAt !== 'number' ||
    (value.source != null &&
      value.source !== 'community' &&
      value.source !== 'third-party')
  ) {
    throw new ExtensionInstallError('Saved third-party extension record is invalid.');
  }
  return { ...value, manifest: parseExtensionManifest(value.manifest) };
}

export class ExtensionInstallError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ExtensionInstallError';
  }
}

export function resolveExtensionManifestUrl(input: string): string {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch (cause) {
    throw new ExtensionInstallError('Extension location must be a valid HTTPS URL.', {
      cause,
    });
  }
  if (url.protocol !== 'https:') {
    throw new ExtensionInstallError('Extension locations must use HTTPS.');
  }

  if (url.hostname === 'raw.githubusercontent.com') return url.toString();
  if (url.hostname !== 'github.com') {
    return url.pathname.endsWith('.json')
      ? url.toString()
      : new URL('tomeio-extension.json', `${url.toString().replace(/\/$/, '')}/`).toString();
  }

  const parts = url.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new ExtensionInstallError('GitHub extension URL must include an owner and repository.');
  }
  const owner = parts[0];
  const repository = parts[1];
  const mode = parts[2];
  const ref = parts[3];
  const pathParts = parts.slice(4);
  if (!owner || !repository) {
    throw new ExtensionInstallError('GitHub extension URL must include an owner and repository.');
  }
  if (mode === 'blob' && ref && pathParts.length) {
    return `https://raw.githubusercontent.com/${owner}/${repository}/${ref}/${pathParts.join('/')}`;
  }
  if (mode === 'tree' && ref) {
    const directory = pathParts.length ? `${pathParts.join('/')}/` : '';
    return `https://raw.githubusercontent.com/${owner}/${repository}/${ref}/${directory}tomeio-extension.json`;
  }
  return `https://raw.githubusercontent.com/${owner}/${repository}/HEAD/tomeio-extension.json`;
}

async function fetchManifest(
  input: string,
  fetchFn: typeof fetch
): Promise<{ manifest: ExtensionManifest; manifestUrl: string }> {
  const manifestUrl = resolveExtensionManifestUrl(input);
  let response: Response;
  try {
    response = await fetchFn(manifestUrl, {
      headers: { Accept: 'application/json' },
    });
  } catch (cause) {
    throw new ExtensionInstallError(`Could not download extension manifest from ${manifestUrl}.`, {
      cause,
    });
  }
  if (!response.ok) {
    throw new ExtensionInstallError(
      `Extension manifest request failed (${response.status}) for ${manifestUrl}.`
    );
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch (cause) {
    throw new ExtensionInstallError('Extension manifest is not valid JSON.', { cause });
  }
  return { manifest: parseExtensionManifest(json), manifestUrl };
}

function assertThirdPartyTransport(manifest: ExtensionManifest): void {
  if (
    manifest.transport.kind === 'bundled' ||
    manifest.transport.kind === 'host' ||
    manifest.transport.kind === 'device'
  ) {
    throw new ExtensionInstallError(
      'Bundled, host, and device transports are reserved for reviewed add-ons.'
    );
  }
  if (manifest.transport.kind === 'script') {
    throw new ExtensionInstallError(
      'Executable script add-ons are no longer supported. Publish an HTTP add-on using @tomeio/addon-sdk.'
    );
  }
}

export class ExtensionRegistry {
  private readonly store: ExtensionRegistryStore;
  private readonly bundled: readonly ExtensionManifest[];
  private community: readonly CommunityExtension[];
  private readonly fetchFn: typeof fetch;

  constructor(
    store: ExtensionRegistryStore,
    bundled: readonly ExtensionManifest[],
    communityOrFetch: readonly CommunityExtension[] | typeof fetch = [],
    fetchFn: typeof fetch = fetch
  ) {
    this.store = store;
    this.bundled = bundled;
    this.community =
      typeof communityOrFetch === 'function' ? [] : communityOrFetch;
    this.fetchFn = typeof communityOrFetch === 'function' ? communityOrFetch : fetchFn;
  }

  setCommunity(extensions: readonly CommunityExtension[]): void {
    this.community = extensions.map((extension) => ({
      ...extension,
      manifest: parseExtensionManifest(extension.manifest),
    }));
  }

  private async installed(): Promise<InstalledExtension[]> {
    return (await this.store.read()).map(validateInstalledExtension);
  }

  async list(): Promise<ExtensionRegistrySnapshot> {
    const thirdParty = await this.installed();
    return {
      bundled: [...this.bundled],
      community: this.community
        .map((definition) => ({
          ...definition,
          manifest: parseExtensionManifest(definition.manifest),
        }))
        .sort((left, right) => left.manifest.name.localeCompare(right.manifest.name)),
      thirdParty: [...thirdParty].sort((left, right) =>
        left.manifest.name.localeCompare(right.manifest.name)
      ),
    };
  }

  async install(repositoryUrl: string): Promise<InstalledExtension> {
    const { manifest, manifestUrl } = await fetchManifest(repositoryUrl, this.fetchFn);
    assertThirdPartyTransport(manifest);

    const installed = await this.installed();
    if (this.bundled.some((candidate) => candidate.id === manifest.id)) {
      throw new ExtensionInstallError(
        `Extension id "${manifest.id}" is already used by a bundled extension.`
      );
    }
    const now = Date.now();
    const previous = installed.find((candidate) => candidate.manifest.id === manifest.id);
    const next: InstalledExtension = {
      manifest,
      manifestUrl,
      repositoryUrl: repositoryUrl.trim(),
      enabled: previous?.enabled ?? true,
      installedAt: previous?.installedAt ?? now,
      updatedAt: now,
      source: 'third-party',
    };
    await this.store.write([
      ...installed.filter((candidate) => candidate.manifest.id !== manifest.id),
      next,
    ]);
    return next;
  }

  async installCommunity(id: string): Promise<InstalledExtension> {
    const definition = this.community.find((candidate) => candidate.manifest.id === id);
    if (!definition) throw new ExtensionInstallError(`Community add-on "${id}" was not found.`);
    const manifest = parseExtensionManifest(definition.manifest);
    if (manifest.transport.kind === 'bundled' || manifest.transport.kind === 'script') {
      throw new ExtensionInstallError(
        'Community add-ons must use HTTP, declarative, or reviewed device transports.'
      );
    }
    if (
      manifest.transport.kind === 'host' &&
      !definition.hostAdapters?.includes(manifest.transport.adapter)
    ) {
      throw new ExtensionInstallError(
        `Community add-on "${id}" has not been reviewed for host adapter "${manifest.transport.adapter}".`
      );
    }
    if (
      manifest.transport.kind === 'device' &&
      manifest.permissions?.device?.some(
        (capability) => !definition.deviceCapabilities?.includes(capability)
      )
    ) {
      throw new ExtensionInstallError(
        `Community add-on "${id}" requests an unreviewed device capability.`
      );
    }
    if (
      manifest.transport.kind === 'device' &&
      manifest.permissions?.androidPackages?.some(
        (packageName) => !definition.androidPackages?.includes(packageName)
      )
    ) {
      throw new ExtensionInstallError(
        `Community add-on "${id}" requests an unreviewed Android package.`
      );
    }
    const installed = await this.installed();
    if (this.bundled.some((candidate) => candidate.id === manifest.id)) {
      throw new ExtensionInstallError(`Add-on id "${manifest.id}" is already bundled.`);
    }
    const now = Date.now();
    const previous = installed.find((candidate) => candidate.manifest.id === id);
    const next: InstalledExtension = {
      manifest,
      manifestUrl: definition.manifestUrl,
      repositoryUrl: definition.repositoryUrl,
      enabled: previous?.enabled ?? true,
      installedAt: previous?.installedAt ?? now,
      updatedAt: now,
      source: 'community',
    };
    await this.store.write([
      ...installed.filter((candidate) => candidate.manifest.id !== id),
      next,
    ]);
    return next;
  }

  async updateEnabled(
    validate?: (manifest: ExtensionManifest) => Promise<void>
  ): Promise<ExtensionUpdateResult> {
    const installed = await this.installed();
    const checks = await Promise.all(
      installed.map(async (extension): Promise<ExtensionUpdateCheck> => {
        if (!extension.enabled) return { extension };
        try {
          if (extension.source === 'community') {
            const definition = this.community.find(
              (candidate) => candidate.manifest.id === extension.manifest.id
            );
            if (!definition) {
              throw new ExtensionInstallError(
                `Community add-on "${extension.manifest.id}" is no longer in this registry.`
              );
            }
            const manifest = parseExtensionManifest(definition.manifest);
            const comparison = compareExtensionVersions(
              manifest.version,
              extension.manifest.version
            );
            if (comparison == null) {
              throw new ExtensionInstallError(
                `Cannot compare extension versions "${extension.manifest.version}" and "${manifest.version}".`
              );
            }
            if (comparison <= 0) return { extension };
            await validate?.(manifest);
            const updated: InstalledExtension = {
              ...extension,
              manifest,
              repositoryUrl: definition.repositoryUrl,
              manifestUrl: definition.manifestUrl,
              updatedAt: Date.now(),
            };
            return { extension: updated, updated };
          }
          const { manifest, manifestUrl } = await fetchManifest(
            extension.manifestUrl,
            this.fetchFn
          );
          assertThirdPartyTransport(manifest);
          if (manifest.id !== extension.manifest.id) {
            throw new ExtensionInstallError(
              `Update changed extension id from "${extension.manifest.id}" to "${manifest.id}".`
            );
          }
          const comparison = compareExtensionVersions(
            manifest.version,
            extension.manifest.version
          );
          if (comparison == null) {
            throw new ExtensionInstallError(
              `Cannot compare extension versions "${extension.manifest.version}" and "${manifest.version}".`
            );
          }
          if (comparison <= 0) return { extension };
          await validate?.(manifest);
          const updated: InstalledExtension = {
            ...extension,
            manifest,
            manifestUrl,
            updatedAt: Date.now(),
          };
          return { extension: updated, updated };
        } catch (cause) {
          return {
            extension,
            failure: {
              id: extension.manifest.id,
              name: extension.manifest.name,
              message: cause instanceof Error ? cause.message : String(cause),
            },
          };
        }
      })
    );
    const updated = checks.flatMap((check) => (check.updated ? [check.updated] : []));
    if (updated.length) {
      await this.store.write(checks.map((check) => check.updated ?? check.extension));
    }
    return {
      updated,
      failures: checks.flatMap((check) => (check.failure ? [check.failure] : [])),
    };
  }

  async remove(id: string): Promise<void> {
    const installed = await this.installed();
    await this.store.write(installed.filter((candidate) => candidate.manifest.id !== id));
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const installed = await this.installed();
    const index = installed.findIndex((candidate) => candidate.manifest.id === id);
    if (index < 0) throw new ExtensionInstallError(`Extension "${id}" is not installed.`);
    const extension = installed[index];
    if (!extension) throw new ExtensionInstallError(`Extension "${id}" is not installed.`);
    installed[index] = { ...extension, enabled, updatedAt: Date.now() };
    await this.store.write(installed);
  }
}

export interface ExtensionLoaderOptions {
  bundled: ReadonlyMap<string, BookExtension>;
  host?: ReadonlyMap<string, ExtensionHostAdapter>;
  device?: ExtensionDeviceHost;
  fetchFn?: typeof fetch;
}

export interface ExtensionHostAdapter extends Omit<BookExtension, 'manifest'> {
  extensionId: string;
}

function endpointFor(
  manifest: ExtensionManifest,
  resource: ExtensionResourceName,
  values: Record<string, string>
): string {
  let endpoint: string;
  if (manifest.transport.kind === 'http') {
    const base = manifest.transport.baseUrl.replace(/\/$/, '');
    if (resource === 'catalog') {
      endpoint = `${base}/catalog/book/${encodeURIComponent(values.catalogId ?? '')}.json`;
    } else if (resource === 'search') {
      endpoint = `${base}/search/book.json`;
    } else if (resource === 'resolve') {
      endpoint = `${base}/resolve/book.json`;
    } else if (resource === 'libraryAction') {
      endpoint = `${base}/action/library.json`;
    } else if (resource === 'reader') {
      endpoint = `${base}/reader/sync.json`;
    } else {
      endpoint = `${base}/${resource}/book/${encodeURIComponent(values.id ?? '')}.json`;
    }
  } else if (manifest.transport.kind === 'declarative') {
    if (!('endpoints' in manifest.transport)) {
      throw new ExtensionInstallError(
        `Extension "${manifest.id}" uses a declarative workflow definition.`
      );
    }
    const template = manifest.transport.endpoints[resource];
    if (!template) {
      throw new ExtensionInstallError(
        `Extension "${manifest.id}" has no ${resource} endpoint.`
      );
    }
    endpoint = template.replace(/\{([a-zA-Z]+)\}/g, (_match, key: string) =>
      encodeURIComponent(values[key] ?? '')
    );
  } else {
    throw new ExtensionInstallError(
      `Transport "${manifest.transport.kind}" cannot be loaded as an HTTP extension.`
    );
  }

  const url = new URL(endpoint);
  if (values.query) url.searchParams.set('query', values.query);
  if (values.page) url.searchParams.set('page', values.page);
  if (values.limit) url.searchParams.set('limit', values.limit);
  if (values.language) url.searchParams.set('language', values.language);
  if (values.format) url.searchParams.set('format', values.format);
  const allowedHosts = manifest.permissions?.hosts;
  if (allowedHosts?.length) {
    const allowed = allowedHosts.some((host) => new URL(host).origin === url.origin);
    if (!allowed) {
      throw new ExtensionInstallError(
        `Extension "${manifest.id}" attempted to access undeclared host ${url.origin}.`
      );
    }
  }
  return url.toString();
}

function queryValues(query: ExtensionQuery): Record<string, string> {
  return {
    query: query.query ?? '',
    catalogId: query.catalogId ?? '',
    page: String(query.page ?? 1),
    limit: String(query.limit ?? 30),
    language: query.language ?? '',
    format: query.format ?? '',
  };
}

function requestHeaders(configuration: Record<string, ExtensionConfigValue>): Record<string, string> {
  return {
    Accept: 'application/json',
    ...(Object.keys(configuration).length
      ? { 'X-Tomeio-Config': encodeURIComponent(JSON.stringify(configuration)) }
      : {}),
  };
}

async function responseJson<T>(
  fetchFn: typeof fetch,
  url: string,
  configuration: Record<string, ExtensionConfigValue>
): Promise<T> {
  const response = await fetchFn(url, {
    headers: requestHeaders(configuration),
    redirect: 'error',
  });
  if (!response.ok) {
    throw new Error(`Extension request failed (${response.status}) for ${url}.`);
  }
  return (await response.json()) as T;
}

async function postJson<T>(
  fetchFn: typeof fetch,
  url: string,
  body: unknown,
  configuration: Record<string, ExtensionConfigValue>
): Promise<T> {
  const response = await fetchFn(url, {
    method: 'POST',
    headers: { ...requestHeaders(configuration), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
  });
  if (!response.ok) {
    throw new Error(`Extension request failed (${response.status}) for ${url}.`);
  }
  return (await response.json()) as T;
}

function createRemoteExtension(
  manifest: ExtensionManifest,
  fetchFn: typeof fetch,
  configuration: Record<string, ExtensionConfigValue>
): BookExtension {
  const has = (name: ExtensionResourceName) =>
    manifest.resources.some((resource) => resource.name === name);
  const page = (resource: 'catalog' | 'search', query: ExtensionQuery) =>
    responseJson<unknown>(
      fetchFn,
      endpointFor(manifest, resource, queryValues(query)),
      configuration
    ).then(parseExtensionPage);

  return {
    manifest,
    ...(has('catalog') ? { catalog: (query: ExtensionQuery) => page('catalog', query) } : {}),
    ...(has('search') ? { search: (query: ExtensionQuery) => page('search', query) } : {}),
    ...(has('meta')
      ? {
          meta: (id: string) =>
            responseJson<unknown>(
              fetchFn,
              endpointFor(manifest, 'meta', { id }),
              configuration
            ).then((value) => (value == null ? null : parseBookMetadata(value))),
        }
      : {}),
    ...(has('resolve')
      ? {
          resolve: (query: ExtensionResolveQuery) =>
            postJson<unknown>(
              fetchFn,
              endpointFor(manifest, 'resolve', {}),
              query,
              configuration
            ).then(parseExtensionPage),
        }
      : {}),
    ...(has('reviews')
      ? {
          reviews: (query: ExtensionReviewsQuery) =>
            postJson<unknown>(
              fetchFn,
              endpointFor(manifest, 'reviews', {}),
              query,
              configuration
            ).then(parseExtensionReviewPage),
        }
      : {}),
    ...(has('acquisition')
      ? {
          acquisition: (id: string) =>
            responseJson<unknown>(
              fetchFn,
              endpointFor(manifest, 'acquisition', { id }),
              configuration
            ).then((value) => {
              if (!Array.isArray(value)) {
                throw new Error('Acquisition response must be an array.');
              }
              return value.map(parseBookAcquisition);
            }),
        }
      : {}),
    ...(has('libraryAction')
      ? {
          libraryAction: (request: ExtensionLibraryActionRequest) =>
            postJson<unknown>(
              fetchFn,
              endpointFor(manifest, 'libraryAction', {}),
              request,
              configuration
            ).then(parseExtensionLibraryActionResult),
        }
      : {}),
    ...(has('reader')
      ? {
          readerSync: (request: ExtensionReaderSyncRequest) =>
            postJson<ExtensionReaderSyncResult>(
              fetchFn,
              endpointFor(manifest, 'reader', {}),
              request,
              configuration
            ),
        }
      : {}),
  };
}

export class ExtensionLoader {
  private readonly fetchFn: typeof fetch;
  private readonly options: ExtensionLoaderOptions;
  private readonly workflowDefinitions = new Map<
    string,
    Promise<ExtensionWorkflowDefinition>
  >();
  private readonly deviceWorkflowDefinitions = new Map<
    string,
    ReturnType<typeof fetchDeviceWorkflowDefinition>
  >();

  constructor(options: ExtensionLoaderOptions) {
    this.options = options;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private workflowDefinition(manifest: ExtensionManifest): Promise<ExtensionWorkflowDefinition> {
    const transport = manifest.transport;
    if (transport.kind !== 'declarative' || !('definitionUrl' in transport)) {
      throw new ExtensionInstallError(`Extension "${manifest.id}" has no workflow definition.`);
    }
    const cacheKey = `${manifest.id}@${manifest.version}:${transport.definitionUrl}`;
    const existing = this.workflowDefinitions.get(cacheKey);
    if (existing) return existing;
    const pending = fetchWorkflowDefinition(manifest, this.fetchFn).catch((cause) => {
      this.workflowDefinitions.delete(cacheKey);
      throw cause;
    });
    this.workflowDefinitions.set(cacheKey, pending);
    return pending;
  }

  private deviceWorkflowDefinition(manifest: ExtensionManifest) {
    const transport = manifest.transport;
    if (transport.kind !== 'device') {
      throw new ExtensionInstallError(`Extension "${manifest.id}" has no device workflow definition.`);
    }
    const cacheKey = `${manifest.id}@${manifest.version}:${transport.definitionUrl}`;
    const existing = this.deviceWorkflowDefinitions.get(cacheKey);
    if (existing) return existing;
    const pending = fetchDeviceWorkflowDefinition(manifest, this.fetchFn).catch((cause) => {
      this.deviceWorkflowDefinitions.delete(cacheKey);
      throw cause;
    });
    this.deviceWorkflowDefinitions.set(cacheKey, pending);
    return pending;
  }

  async load(
    manifest: ExtensionManifest,
    configuration: Record<string, ExtensionConfigValue> = {}
  ): Promise<BookExtension> {
    if (manifest.transport.kind === 'bundled') {
      const extension = this.options.bundled.get(manifest.id);
      if (!extension) {
        throw new ExtensionInstallError(
          `Bundled extension "${manifest.id}" is not registered in this application.`
        );
      }
      const context = { configuration };
      return {
        manifest,
        ...(extension.catalog
          ? { catalog: (query: ExtensionQuery) => extension.catalog!(query, context) }
          : {}),
        ...(extension.search
          ? { search: (query: ExtensionQuery) => extension.search!(query, context) }
          : {}),
        ...(extension.meta
          ? { meta: (id: string) => extension.meta!(id, context) }
          : {}),
        ...(extension.resolve
          ? { resolve: (query: ExtensionResolveQuery) => extension.resolve!(query, context) }
          : {}),
        ...(extension.acquisition
          ? { acquisition: (id: string) => extension.acquisition!(id, context) }
          : {}),
        ...(extension.libraryAction
          ? {
              libraryAction: (request: ExtensionLibraryActionRequest) =>
                extension.libraryAction!(request, context),
            }
          : {}),
        ...(extension.libraryImport
          ? {
              libraryImport: (request: ExtensionLibraryImportRequest) =>
                extension.libraryImport!(request, context),
            }
          : {}),
        ...(extension.readerSync
          ? {
              readerSync: (request: ExtensionReaderSyncRequest) =>
                extension.readerSync!(request, context),
            }
          : {}),
      };
    }
    if (manifest.transport.kind === 'host') {
      const adapter = this.options.host?.get(manifest.transport.adapter);
      if (!adapter || adapter.extensionId !== manifest.id) {
        throw new ExtensionInstallError(
          `This version of Tomeio does not provide host adapter "${manifest.transport.adapter}".`
        );
      }
      const { extensionId: _extensionId, ...handlers } = adapter;
      return { manifest, ...handlers };
    }
    if (manifest.transport.kind === 'device') {
      if (!this.options.device) {
        throw new ExtensionInstallError(
          `This version of Tomeio does not provide device workflow capabilities.`
        );
      }
      return createDeviceWorkflowExtension(
        manifest,
        await this.deviceWorkflowDefinition(manifest),
        this.options.device,
        configuration
      );
    }
    if (manifest.transport.kind === 'script') {
      throw new ExtensionInstallError(
        `Executable script add-on "${manifest.id}" is not supported.`
      );
    }
    if (
      manifest.transport.kind === 'declarative' &&
      'definitionUrl' in manifest.transport
    ) {
      return createDeclarativeWorkflowExtension(
        manifest,
        await this.workflowDefinition(manifest),
        this.fetchFn,
        configuration
      );
    }
    return createRemoteExtension(manifest, this.fetchFn, configuration);
  }
}
