import {
  parseExtensionManifest,
  type BookExtension,
  type ExtensionPage,
  type ExtensionQuery,
  type ExtensionManifest,
  type ExtensionResourceName,
} from '@tomeio/extension-protocol';
import type { BookAcquisition, BookMetadata } from '@tomeio/domain';

export interface InstalledExtension {
  manifest: ExtensionManifest;
  manifestUrl: string;
  repositoryUrl: string;
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
}

export interface ExtensionRegistryStore {
  read(): Promise<InstalledExtension[]>;
  write(extensions: InstalledExtension[]): Promise<void>;
}

export interface ExtensionRegistrySnapshot {
  bundled: ExtensionManifest[];
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
    typeof value.updatedAt !== 'number'
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
  if (manifest.transport.kind === 'bundled') {
    throw new ExtensionInstallError(
      'Bundled transports are reserved for extensions shipped with Tomeio.'
    );
  }
}

export class ExtensionRegistry {
  private readonly store: ExtensionRegistryStore;
  private readonly bundled: readonly ExtensionManifest[];
  private readonly fetchFn: typeof fetch;

  constructor(
    store: ExtensionRegistryStore,
    bundled: readonly ExtensionManifest[],
    fetchFn: typeof fetch = fetch
  ) {
    this.store = store;
    this.bundled = bundled;
    this.fetchFn = fetchFn;
  }

  private async installed(): Promise<InstalledExtension[]> {
    return (await this.store.read()).map(validateInstalledExtension);
  }

  async list(): Promise<ExtensionRegistrySnapshot> {
    const thirdParty = await this.installed();
    return {
      bundled: [...this.bundled],
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
    };
    await this.store.write([
      ...installed.filter((candidate) => candidate.manifest.id !== manifest.id),
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
    if (updated.length) await this.store.write(checks.map((check) => check.extension));
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

export interface ScriptExtensionExecutor {
  load(manifest: ExtensionManifest): Promise<BookExtension>;
}

export interface ExtensionLoaderOptions {
  bundled: ReadonlyMap<string, BookExtension>;
  fetchFn?: typeof fetch;
  scriptExecutor?: ScriptExtensionExecutor;
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
    } else {
      endpoint = `${base}/${resource}/book/${encodeURIComponent(values.id ?? '')}.json`;
    }
  } else if (manifest.transport.kind === 'declarative') {
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

async function responseJson<T>(fetchFn: typeof fetch, url: string): Promise<T> {
  const response = await fetchFn(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Extension request failed (${response.status}) for ${url}.`);
  }
  return (await response.json()) as T;
}

function createRemoteExtension(
  manifest: ExtensionManifest,
  fetchFn: typeof fetch
): BookExtension {
  const has = (name: ExtensionResourceName) =>
    manifest.resources.some((resource) => resource.name === name);
  const page = (resource: 'catalog' | 'search', query: ExtensionQuery) =>
    responseJson<ExtensionPage<BookMetadata>>(
      fetchFn,
      endpointFor(manifest, resource, queryValues(query))
    );

  return {
    manifest,
    ...(has('catalog') ? { catalog: (query: ExtensionQuery) => page('catalog', query) } : {}),
    ...(has('search') ? { search: (query: ExtensionQuery) => page('search', query) } : {}),
    ...(has('meta')
      ? {
          meta: (id: string) =>
            responseJson<BookMetadata | null>(
              fetchFn,
              endpointFor(manifest, 'meta', { id })
            ),
        }
      : {}),
    ...(has('acquisition')
      ? {
          acquisition: (id: string) =>
            responseJson<BookAcquisition[]>(
              fetchFn,
              endpointFor(manifest, 'acquisition', { id })
            ),
        }
      : {}),
  };
}

export class ExtensionLoader {
  private readonly fetchFn: typeof fetch;
  private readonly options: ExtensionLoaderOptions;

  constructor(options: ExtensionLoaderOptions) {
    this.options = options;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async load(manifest: ExtensionManifest): Promise<BookExtension> {
    if (manifest.transport.kind === 'bundled') {
      const extension = this.options.bundled.get(manifest.id);
      if (!extension) {
        throw new ExtensionInstallError(
          `Bundled extension "${manifest.id}" is not registered in this application.`
        );
      }
      return extension;
    }
    if (manifest.transport.kind === 'script') {
      if (!this.options.scriptExecutor) {
        throw new ExtensionInstallError(
          `This platform does not provide a sandbox for script extension "${manifest.id}".`
        );
      }
      return this.options.scriptExecutor.load(manifest);
    }
    return createRemoteExtension(manifest, this.fetchFn);
  }
}
