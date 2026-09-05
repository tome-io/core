import type {
  BookAcquisition,
  BookMetadata,
  BookOffer,
  BookReview,
} from '@tomeio/domain';

export const EXTENSION_MANIFEST_VERSION = 1 as const;

export type ExtensionResourceName =
  | 'catalog'
  | 'search'
  | 'meta'
  | 'resolve'
  | 'reviews'
  | 'acquisition'
  | 'reader'
  | 'libraryAction'
  | 'libraryImport';

export interface ExtensionResource {
  name: ExtensionResourceName;
  id?: string;
  supportsPagination?: boolean;
  /** Provider-specific subject IDs accepted by its search resource. */
  subjectFilters?: { id: string; name: string }[];
}

export interface ExtensionCatalog {
  id: string;
  name: string;
  resource: 'catalog';
}

export type ExtensionConfigValue = string | number | boolean;

export type ExtensionConfigField =
  | {
      key: string;
      type: 'text' | 'password' | 'directory';
      title: string;
      required?: boolean;
      default?: string;
    }
  | {
      key: string;
      type: 'number';
      title: string;
      required?: boolean;
      default?: number;
    }
  | {
      key: string;
      type: 'checkbox';
      title: string;
      required?: boolean;
      default?: boolean;
    }
  | {
      key: string;
      type: 'select';
      title: string;
      required?: boolean;
      default?: string;
      options: { label: string; value: string }[];
    };

export interface ExtensionBehaviorHints {
  configurable?: boolean;
  configurationRequired?: boolean;
}

export interface ExtensionAttribution {
  label: string;
  url: string;
  imageUrl?: string;
}

export type ExtensionProviderRole =
  | 'discovery'
  | 'search'
  | 'reviews'
  | 'acquisition'
  | 'cover';

export type ExtensionPlatform = 'android' | 'ios' | 'web' | 'desktop';

export type ExtensionDeviceCapability =
  | 'directory.read'
  | 'file.read'
  | 'archive.read'
  | 'sqlite.read'
  | 'android.preferences.read'
  | 'android.open-file';

/** A host-rendered action. Add-ons describe actions; they never inject UI. */
export interface ExtensionLibraryAction {
  id: string;
  title: string;
  icon?: string;
  placements: ('library' | 'details')[];
  requires?: {
    localFile?: boolean;
    platforms?: ExtensionPlatform[];
    formats?: string[];
  };
}

/** A host-rendered file import supplied only to a reviewed local integration. */
export interface ExtensionLibraryImport {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  fileExtensions: string[];
  mimeTypes?: string[];
  platforms?: ExtensionPlatform[];
}

/** A host-rendered setup flow for an external reader's account connection. */
export interface ExtensionReaderSetup {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  platforms?: ExtensionPlatform[];
}

export interface ExtensionReaderSetupRequest {
  setupId: string;
  action: 'status' | 'connect' | 'disconnect';
}

export interface ExtensionReaderSetupResult {
  connected: boolean;
  endpoint?: string;
  createdAt?: number;
  lastUsedAt?: number;
  instructions: string[];
  warnings?: string[];
}

export type ExtensionTransport =
  | {
      kind: 'bundled';
      module: string;
    }
  | {
      kind: 'http';
      baseUrl: string;
    }
  | {
      kind: 'declarative';
      endpoints: Partial<Record<ExtensionResourceName, string>>;
    }
  | {
      kind: 'declarative';
      definitionUrl: string;
    }
  | {
      /** Reviewed JSON workflow executed through permissioned device primitives. */
      kind: 'device';
      definitionUrl: string;
    }
  | {
      /** Reviewed device integration implemented by a narrow host capability. */
      kind: 'host';
      adapter: string;
    }
  | {
      kind: 'script';
      bundleUrl: string;
      sha256: string;
      entrypoint?: string;
    };

export interface ExtensionManifest {
  manifestVersion: typeof EXTENSION_MANIFEST_VERSION;
  id: string;
  version: string;
  name: string;
  description: string;
  author?: string;
  homepage?: string;
  repository?: string;
  icon?: string;
  types: ['book'];
  resources: ExtensionResource[];
  providerRoles?: ExtensionProviderRole[];
  catalogs?: ExtensionCatalog[];
  config?: ExtensionConfigField[];
  behaviorHints?: ExtensionBehaviorHints;
  attribution?: ExtensionAttribution;
  libraryActions?: ExtensionLibraryAction[];
  libraryImports?: ExtensionLibraryImport[];
  readerSetups?: ExtensionReaderSetup[];
  transport: ExtensionTransport;
  permissions?: {
    hosts?: string[];
    device?: ExtensionDeviceCapability[];
    androidPackages?: string[];
  };
}

export interface ExtensionQuery {
  query?: string;
  catalogId?: string;
  page?: number;
  limit?: number;
  language?: string;
  format?: string;
  subject?: string;
}

export function supportsExtensionProviderRole(
  manifest: ExtensionManifest,
  role: ExtensionProviderRole
): boolean {
  if (manifest.providerRoles) return manifest.providerRoles.includes(role);
  if (role === 'discovery') return false;
  if (role === 'cover') return false;
  if (role === 'reviews') {
    return manifest.resources.some((resource) => resource.name === 'reviews');
  }
  if (role === 'search') {
    return manifest.resources.some((resource) => resource.name === 'search');
  }
  const resources = new Set(manifest.resources.map((resource) => resource.name));
  return resources.has('acquisition') && (resources.has('resolve') || resources.has('search'));
}

export interface ExtensionPage<T> {
  items: T[];
  nextPage?: number;
}

/** Provider-neutral identity passed from discovery to a resolver. */
export interface ExtensionBookReference {
  id?: string;
  title: string;
  authors: string[];
  publishedYear?: number;
  identifiers: Record<string, string>;
}

export interface ExtensionResolveQuery {
  book: ExtensionBookReference;
  page?: number;
  limit?: number;
  format?: string;
}

export interface ExtensionReviewsQuery {
  book: ExtensionBookReference;
  page?: number;
  limit?: number;
}

export interface ExtensionLibraryBook extends ExtensionBookReference {
  localFile?: {
    /** Present only for trusted host/device integrations. */
    uri?: string;
    /** Present only for trusted host/device integrations. */
    filename?: string;
    format: string;
  };
}

export interface ExtensionLibraryActionRequest {
  actionId: string;
  book: ExtensionLibraryBook;
  platform: ExtensionPlatform;
}

export type ExtensionLibraryActionResult =
  | { kind: 'handled' }
  | { kind: 'openUrl'; url: string }
  | { kind: 'openLocalFile'; packageName: string };

export interface ExtensionLibraryImportRequest {
  importId: string;
  sourceUri: string;
  filename: string;
  platform: ExtensionPlatform;
}

export interface ExtensionReaderSyncRequest {
  /** Present only for reviewed host/device integrations. Remote add-ons never receive local URIs. */
  sourceUri?: string;
  books: ExtensionLibraryBook[];
}

export interface ExtensionReaderProgress {
  book: ExtensionBookReference;
  progress: number;
  isRead: boolean;
  readingTimeMs?: number;
  wordsRead?: number;
  lastReadAt?: number;
}

export interface ExtensionReaderBook extends ExtensionBookReference {
  sourceId: string;
  description?: string;
  subjects?: string[];
  format?: string;
  sourceFilename?: string;
  sourcePath?: string;
  addedAt?: number;
  progress?: number;
  isRead?: boolean;
  readingTimeMs?: number;
  wordsRead?: number;
  lastReadAt?: number;
}

export interface ExtensionReaderSyncResult {
  progress: ExtensionReaderProgress[];
  books?: ExtensionReaderBook[];
  warnings?: string[];
}

export interface ExtensionInvocationContext {
  configuration: Record<string, ExtensionConfigValue>;
}

export type ExtensionWorkflowExpression =
  | string
  | number
  | boolean
  | null
  | ExtensionWorkflowExpression[]
  | { [key: string]: ExtensionWorkflowExpression }
  | {
      $op:
        | 'path'
        | 'coalesce'
        | 'concat'
        | 'lowercase'
        | 'uppercase'
        | 'number'
        | 'string'
        | 'array'
        | 'split'
        | 'join'
        | 'encode'
        | 'add'
        | 'multiply'
        | 'equals'
        | 'lessThan'
        | 'in'
        | 'and'
        | 'not'
        | 'if'
        | 'length'
        | 'first'
        | 'map'
        | 'filter'
        | 'find'
        | 'flatten'
        | 'slice'
        | 'sortByOrder'
        | 'distinct'
        | 'compact'
        | 'get'
        | 'lookup'
        | 'trim'
        | 'basename'
        | 'fileStem'
        | 'fileExtension'
        | 'percent'
        | 'max'
        | 'endsWith'
        | 'sizeBytes'
        | 'absoluteUrl';
      path?: string;
      value?: ExtensionWorkflowExpression;
      values?: ExtensionWorkflowExpression[];
      separator?: string;
      index?: number;
      as?: string;
      by?: ExtensionWorkflowExpression;
      base?: ExtensionWorkflowExpression;
      default?: ExtensionWorkflowExpression;
    };

export type ExtensionDeviceOperation =
  | {
      kind: 'directory.scan';
      directory: ExtensionWorkflowExpression;
      filenames?: string[];
      extensions?: string[];
      maxDepth?: number;
      limit?: number;
      order?: 'modified-desc' | 'name-asc';
    }
  | {
      kind: 'file.read';
      file: ExtensionWorkflowExpression;
      response: 'text' | 'json' | 'bytes';
    }
  | {
      kind: 'archive.read';
      archive: ExtensionWorkflowExpression;
      entry:
        | { suffix: string }
        | {
            indexed: ExtensionWorkflowExpression;
            targetSuffix: string;
            entryExtension?: string;
          };
      response: 'text' | 'bytes';
    }
  | {
      kind: 'sqlite.query';
      database: ExtensionWorkflowExpression;
      queries: Record<string, string>;
    }
  | {
      kind: 'android.preferences.parse';
      text: ExtensionWorkflowExpression;
    }
  | {
      kind: 'android.open-file';
      uri: ExtensionWorkflowExpression;
      format?: ExtensionWorkflowExpression;
      packages: string[];
      activitySuffix?: string;
      mimeTypes?: Record<string, string>;
    };

export interface ExtensionDeviceWorkflowStep {
  id: string;
  when?: ExtensionWorkflowExpression;
  optional?: boolean;
  operation: ExtensionDeviceOperation;
}

export interface ExtensionDeviceWorkflowResource {
  steps: ExtensionDeviceWorkflowStep[];
  output: ExtensionWorkflowExpression;
}

export interface ExtensionDeviceWorkflowDefinition {
  deviceWorkflowVersion: 1;
  resources: Partial<
    Record<'reader' | 'libraryAction' | 'libraryImport', ExtensionDeviceWorkflowResource>
  >;
}

export interface ExtensionWorkflowRequest {
  urls: ExtensionWorkflowExpression;
  method?: 'GET' | 'POST' | 'HEAD';
  headers?: Record<string, ExtensionWorkflowExpression>;
  query?: Record<string, ExtensionWorkflowExpression>;
  form?: Record<string, ExtensionWorkflowExpression>;
  json?: ExtensionWorkflowExpression;
  response?: 'json' | 'text';
  timeoutMs?: number;
}

export interface ExtensionWorkflowStep {
  id: string;
  when?: ExtensionWorkflowExpression;
  request: ExtensionWorkflowRequest;
  accept?: ExtensionWorkflowExpression;
}

export interface ExtensionWorkflowResource {
  steps: ExtensionWorkflowStep[];
  output: ExtensionWorkflowExpression;
}

export interface ExtensionWorkflowDefinition {
  workflowVersion: 1;
  resources: Partial<Record<ExtensionResourceName, ExtensionWorkflowResource>>;
}

export interface BookExtension {
  manifest: ExtensionManifest;
  catalog?(
    query: ExtensionQuery,
    context?: ExtensionInvocationContext
  ): Promise<ExtensionPage<BookMetadata>>;
  search?(
    query: ExtensionQuery,
    context?: ExtensionInvocationContext
  ): Promise<ExtensionPage<BookMetadata>>;
  meta?(id: string, context?: ExtensionInvocationContext): Promise<BookMetadata | null>;
  resolve?(
    query: ExtensionResolveQuery,
    context?: ExtensionInvocationContext
  ): Promise<ExtensionPage<BookMetadata>>;
  reviews?(
    query: ExtensionReviewsQuery,
    context?: ExtensionInvocationContext
  ): Promise<ExtensionPage<BookReview>>;
  acquisition?(
    id: string,
    context?: ExtensionInvocationContext
  ): Promise<BookAcquisition[]>;
  libraryAction?(
    request: ExtensionLibraryActionRequest,
    context?: ExtensionInvocationContext
  ): Promise<ExtensionLibraryActionResult>;
  libraryImport?(
    request: ExtensionLibraryImportRequest,
    context?: ExtensionInvocationContext
  ): Promise<ExtensionReaderSyncResult>;
  readerSync?(
    request: ExtensionReaderSyncRequest,
    context?: ExtensionInvocationContext
  ): Promise<ExtensionReaderSyncResult>;
  readerSetup?(
    request: ExtensionReaderSetupRequest,
    context?: ExtensionInvocationContext
  ): Promise<ExtensionReaderSetupResult>;
}

export class InvalidExtensionManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidExtensionManifestError';
  }
}

export class InvalidExtensionResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidExtensionResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredString(
  value: Record<string, unknown>,
  key: string
): string {
  const result = value[key];
  if (typeof result !== 'string' || !result.trim()) {
    throw new InvalidExtensionManifestError(`Manifest field "${key}" must be a non-empty string.`);
  }
  return result;
}

function requireHttps(value: string, field: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new InvalidExtensionManifestError(`${field} must be a valid URL.`);
  }
  if (parsed.protocol !== 'https:') {
    throw new InvalidExtensionManifestError(`${field} must use HTTPS.`);
  }
}

const RESOURCE_NAMES = new Set<ExtensionResourceName>([
  'catalog',
  'search',
  'meta',
  'resolve',
  'reviews',
  'acquisition',
  'reader',
  'libraryAction',
  'libraryImport',
]);

const CONFIG_FIELD_TYPES = new Set<ExtensionConfigField['type']>([
  'text',
  'password',
  'directory',
  'number',
  'checkbox',
  'select',
]);

export function parseExtensionManifest(input: unknown): ExtensionManifest {
  const value = record(input);
  if (!value) throw new InvalidExtensionManifestError('Manifest must be a JSON object.');
  if (value.manifestVersion !== EXTENSION_MANIFEST_VERSION) {
    throw new InvalidExtensionManifestError(
      `Unsupported manifest version: ${String(value.manifestVersion)}.`
    );
  }

  const id = requiredString(value, 'id');
  if (!/^[a-z0-9][a-z0-9._-]+$/.test(id)) {
    throw new InvalidExtensionManifestError(
      'Manifest id may only contain lowercase letters, numbers, dots, dashes, and underscores.'
    );
  }

  const resources = Array.isArray(value.resources)
    ? value.resources.map((candidate, index): ExtensionResource => {
        const resource = record(candidate);
        if (!resource || !RESOURCE_NAMES.has(resource.name as ExtensionResourceName)) {
          throw new InvalidExtensionManifestError(`Invalid resource at index ${index}.`);
        }
        let subjectFilters: ExtensionResource['subjectFilters'];
        if (resource.subjectFilters != null) {
          if (resource.name !== 'search' || !Array.isArray(resource.subjectFilters) || resource.subjectFilters.length > 100) {
            throw new InvalidExtensionManifestError('Subject filters must belong to a search resource.');
          }
          const ids = new Set<string>();
          subjectFilters = resource.subjectFilters.map((value) => {
            const filter = record(value);
            if (!filter || typeof filter.id !== 'string' || !filter.id.trim() || filter.id.length > 128 ||
              typeof filter.name !== 'string' || !filter.name.trim() || filter.name.length > 80 || ids.has(filter.id)) {
              throw new InvalidExtensionManifestError('Invalid or duplicate subject filter.');
            }
            ids.add(filter.id);
            return { id: filter.id, name: filter.name };
          });
        }
        return {
          name: resource.name as ExtensionResourceName,
          ...(subjectFilters ? { subjectFilters } : {}),
          ...(typeof resource.id === 'string' ? { id: resource.id } : {}),
          ...(typeof resource.supportsPagination === 'boolean'
            ? { supportsPagination: resource.supportsPagination }
            : {}),
        };
      })
    : [];
  if (!resources.length) {
    throw new InvalidExtensionManifestError('Manifest must declare at least one resource.');
  }

  if (value.providerRoles != null && !Array.isArray(value.providerRoles)) {
    throw new InvalidExtensionManifestError('providerRoles must be an array.');
  }
  const providerRoles = Array.isArray(value.providerRoles)
    ? value.providerRoles.map((candidate, index): ExtensionProviderRole => {
        if (!['discovery', 'search', 'reviews', 'acquisition', 'cover'].includes(String(candidate))) {
          throw new InvalidExtensionManifestError(
            `Invalid provider role at index ${index}.`
          );
        }
        return candidate as ExtensionProviderRole;
      })
    : undefined;
  if (providerRoles && new Set(providerRoles).size !== providerRoles.length) {
    throw new InvalidExtensionManifestError('providerRoles values must be unique.');
  }
  if (
    providerRoles?.includes('search') &&
    !resources.some((resource) => resource.name === 'search')
  ) {
    throw new InvalidExtensionManifestError('Search providers must declare the search resource.');
  }
  if (
    providerRoles?.includes('reviews') &&
    !resources.some((resource) => resource.name === 'reviews')
  ) {
    throw new InvalidExtensionManifestError('Review providers must declare the reviews resource.');
  }
  if (
    providerRoles?.includes('acquisition') &&
    (!resources.some((resource) => resource.name === 'acquisition') ||
      !resources.some(
        (resource) => resource.name === 'resolve' || resource.name === 'search'
      ))
  ) {
    throw new InvalidExtensionManifestError(
      'Acquisition providers must declare resolve or acquisition resources.'
    );
  }
  if (
    providerRoles?.includes('cover') &&
    !resources.some((resource) => resource.name === 'resolve')
  ) {
    throw new InvalidExtensionManifestError(
      'Cover providers must declare the resolve resource.'
    );
  }

  const transport = record(value.transport);
  if (!transport || typeof transport.kind !== 'string') {
    throw new InvalidExtensionManifestError('Manifest transport is missing.');
  }

  let parsedTransport: ExtensionTransport;
  if (transport.kind === 'bundled') {
    parsedTransport = { kind: 'bundled', module: requiredString(transport, 'module') };
  } else if (transport.kind === 'http') {
    const baseUrl = requiredString(transport, 'baseUrl');
    requireHttps(baseUrl, 'transport.baseUrl');
    parsedTransport = { kind: 'http', baseUrl };
  } else if (transport.kind === 'declarative' && typeof transport.definitionUrl === 'string') {
    const definitionUrl = requiredString(transport, 'definitionUrl');
    requireHttps(definitionUrl, 'transport.definitionUrl');
    parsedTransport = { kind: 'declarative', definitionUrl };
  } else if (transport.kind === 'device') {
    const definitionUrl = requiredString(transport, 'definitionUrl');
    requireHttps(definitionUrl, 'transport.definitionUrl');
    parsedTransport = { kind: 'device', definitionUrl };
  } else if (transport.kind === 'declarative') {
    const endpoints = record(transport.endpoints);
    if (!endpoints) {
      throw new InvalidExtensionManifestError('Declarative transport requires endpoints.');
    }
    const parsedEndpoints: Partial<Record<ExtensionResourceName, string>> = {};
    for (const [name, endpoint] of Object.entries(endpoints)) {
      if (!RESOURCE_NAMES.has(name as ExtensionResourceName) || typeof endpoint !== 'string') {
        throw new InvalidExtensionManifestError(`Invalid declarative endpoint "${name}".`);
      }
      requireHttps(endpoint, `transport.endpoints.${name}`);
      parsedEndpoints[name as ExtensionResourceName] = endpoint;
    }
    parsedTransport = { kind: 'declarative', endpoints: parsedEndpoints };
  } else if (transport.kind === 'host') {
    parsedTransport = { kind: 'host', adapter: requiredString(transport, 'adapter') };
  } else if (transport.kind === 'script') {
    const bundleUrl = requiredString(transport, 'bundleUrl');
    const sha256 = requiredString(transport, 'sha256').toLowerCase();
    requireHttps(bundleUrl, 'transport.bundleUrl');
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
      throw new InvalidExtensionManifestError(
        'Script transport requires a lowercase SHA-256 digest.'
      );
    }
    parsedTransport = {
      kind: 'script',
      bundleUrl,
      sha256,
      ...(typeof transport.entrypoint === 'string'
        ? { entrypoint: transport.entrypoint }
        : {}),
    };
  } else {
    throw new InvalidExtensionManifestError(
      `Unsupported transport kind: ${transport.kind}.`
    );
  }
  if (
    parsedTransport.kind === 'device' &&
    resources.some(
      (resource) =>
        resource.name !== 'reader' &&
        resource.name !== 'libraryAction' &&
        resource.name !== 'libraryImport'
    )
  ) {
    throw new InvalidExtensionManifestError(
      'Device integrations may declare only reader, libraryAction, and libraryImport resources.'
    );
  }

  const types = value.types;
  if (!Array.isArray(types) || types.length !== 1 || types[0] !== 'book') {
    throw new InvalidExtensionManifestError('This client currently supports only the book type.');
  }

  const catalogs = Array.isArray(value.catalogs)
    ? value.catalogs.map((candidate, index): ExtensionCatalog => {
        const catalog = record(candidate);
        if (!catalog) {
          throw new InvalidExtensionManifestError(`Invalid catalog at index ${index}.`);
        }
        return {
          id: requiredString(catalog, 'id'),
          name: requiredString(catalog, 'name'),
          resource: 'catalog',
        };
      })
    : undefined;
  if (
    providerRoles?.includes('discovery') &&
    (!resources.some((resource) => resource.name === 'catalog') || !catalogs?.length)
  ) {
    throw new InvalidExtensionManifestError(
      'Discovery providers must declare catalog resources and catalogs.'
    );
  }

  const config = Array.isArray(value.config)
    ? value.config.map((candidate, index): ExtensionConfigField => {
        const field = record(candidate);
        if (!field || !CONFIG_FIELD_TYPES.has(field.type as ExtensionConfigField['type'])) {
          throw new InvalidExtensionManifestError(`Invalid config field at index ${index}.`);
        }
        const key = requiredString(field, 'key');
        if (!/^[a-z][a-z0-9._-]*$/.test(key)) {
          throw new InvalidExtensionManifestError(
            `Config field key "${key}" must start with a lowercase letter and contain only lowercase letters, numbers, dots, dashes, or underscores.`
          );
        }
        const title = requiredString(field, 'title');
        const required = typeof field.required === 'boolean' ? field.required : undefined;

        if (field.type === 'number') {
          if (field.default != null && typeof field.default !== 'number') {
            throw new InvalidExtensionManifestError(`Default for config field "${key}" must be a number.`);
          }
          return { key, type: 'number', title, ...(required != null ? { required } : {}), ...(typeof field.default === 'number' ? { default: field.default } : {}) };
        }
        if (field.type === 'checkbox') {
          if (field.default != null && typeof field.default !== 'boolean') {
            throw new InvalidExtensionManifestError(`Default for config field "${key}" must be a boolean.`);
          }
          return { key, type: 'checkbox', title, ...(required != null ? { required } : {}), ...(typeof field.default === 'boolean' ? { default: field.default } : {}) };
        }
        if (field.type === 'select') {
          if (!Array.isArray(field.options) || !field.options.length) {
            throw new InvalidExtensionManifestError(`Select config field "${key}" requires options.`);
          }
          const options = field.options.map((candidateOption, optionIndex) => {
            const option = record(candidateOption);
            if (!option) {
              throw new InvalidExtensionManifestError(
                `Invalid option ${optionIndex} for config field "${key}".`
              );
            }
            if (typeof option.value !== 'string') {
              throw new InvalidExtensionManifestError(
                `Option ${optionIndex} for config field "${key}" must have a string value.`
              );
            }
            return { label: requiredString(option, 'label'), value: option.value };
          });
          if (field.default != null && typeof field.default !== 'string') {
            throw new InvalidExtensionManifestError(`Default for config field "${key}" must be a string.`);
          }
          if (
            typeof field.default === 'string' &&
            !options.some((option) => option.value === field.default)
          ) {
            throw new InvalidExtensionManifestError(
              `Default for config field "${key}" must match a declared option.`
            );
          }
          return { key, type: 'select', title, options, ...(required != null ? { required } : {}), ...(typeof field.default === 'string' ? { default: field.default } : {}) };
        }
        if (field.default != null && typeof field.default !== 'string') {
          throw new InvalidExtensionManifestError(`Default for config field "${key}" must be a string.`);
        }
        return {
          key,
          type: field.type as 'text' | 'password' | 'directory',
          title,
          ...(required != null ? { required } : {}),
          ...(typeof field.default === 'string' ? { default: field.default } : {}),
        };
      })
    : undefined;
  if (config && new Set(config.map((field) => field.key)).size !== config.length) {
    throw new InvalidExtensionManifestError('Config field keys must be unique.');
  }
  if (
    parsedTransport.kind !== 'host' &&
    parsedTransport.kind !== 'device' &&
    config?.some((field) => field.type === 'directory')
  ) {
    throw new InvalidExtensionManifestError(
      'Directory configuration is available only to reviewed device integrations.'
    );
  }

  const behaviorHintsValue = record(value.behaviorHints);
  const behaviorHints = behaviorHintsValue
    ? {
        ...(typeof behaviorHintsValue.configurable === 'boolean'
          ? { configurable: behaviorHintsValue.configurable }
          : {}),
        ...(typeof behaviorHintsValue.configurationRequired === 'boolean'
          ? { configurationRequired: behaviorHintsValue.configurationRequired }
          : {}),
      }
    : undefined;
  if (behaviorHints?.configurationRequired && !config?.some((field) => field.required)) {
    throw new InvalidExtensionManifestError(
      'configurationRequired extensions must declare at least one required config field.'
    );
  }

  const attributionValue = record(value.attribution);
  const attributionImageUrl = attributionValue?.imageUrl;
  if (
    attributionImageUrl != null &&
    (typeof attributionImageUrl !== 'string' || !attributionImageUrl.trim())
  ) {
    throw new InvalidExtensionManifestError(
      'Manifest field "attribution.imageUrl" must be a non-empty string.'
    );
  }
  const attribution = attributionValue
    ? {
        label: requiredString(attributionValue, 'label'),
        url: requiredString(attributionValue, 'url'),
        ...(typeof attributionImageUrl === 'string' ? { imageUrl: attributionImageUrl } : {}),
      }
    : undefined;
  if (attribution) {
    requireHttps(attribution.url, 'attribution.url');
    if (attribution.imageUrl) requireHttps(attribution.imageUrl, 'attribution.imageUrl');
  }

  const libraryActions = Array.isArray(value.libraryActions)
    ? value.libraryActions.map((candidate, index): ExtensionLibraryAction => {
        const action = record(candidate);
        if (!action) {
          throw new InvalidExtensionManifestError(`Invalid library action at index ${index}.`);
        }
        const actionId = requiredString(action, 'id');
        const rawPlacements = action.placements;
        if (!Array.isArray(rawPlacements)) {
          throw new InvalidExtensionManifestError(
            `Library action "${actionId}" must declare valid placements.`
          );
        }
        const placements = rawPlacements.filter(
          (placement): placement is ExtensionLibraryAction['placements'][number] =>
            placement === 'library' || placement === 'details'
        );
        if (!placements.length || placements.length !== rawPlacements.length) {
          throw new InvalidExtensionManifestError(
            `Library action "${actionId}" must declare valid placements.`
          );
        }
        const requiresValue = record(action.requires);
        const rawPlatforms = requiresValue?.platforms;
        const platforms = Array.isArray(rawPlatforms)
          ? rawPlatforms.filter(
              (platform): platform is ExtensionPlatform =>
                platform === 'android' ||
                platform === 'ios' ||
                platform === 'web' ||
                platform === 'desktop'
            )
          : undefined;
        if (
          platforms &&
          Array.isArray(rawPlatforms) &&
          platforms.length !== rawPlatforms.length
        ) {
          throw new InvalidExtensionManifestError(
            `Library action "${actionId}" declares an unsupported platform.`
          );
        }
        const rawFormats = requiresValue?.formats;
        const formats = Array.isArray(rawFormats)
          ? rawFormats.filter((format): format is string => typeof format === 'string')
          : undefined;
        if (
          formats &&
          Array.isArray(rawFormats) &&
          formats.length !== rawFormats.length
        ) {
          throw new InvalidExtensionManifestError(
            `Library action "${actionId}" declares an invalid format.`
          );
        }
        return {
          id: actionId,
          title: requiredString(action, 'title'),
          ...(typeof action.icon === 'string' ? { icon: action.icon } : {}),
          placements,
          ...(requiresValue
            ? {
                requires: {
                  ...(typeof requiresValue.localFile === 'boolean'
                    ? { localFile: requiresValue.localFile }
                    : {}),
                  ...(platforms ? { platforms } : {}),
                  ...(formats ? { formats } : {}),
                },
              }
            : {}),
        };
      })
    : undefined;
  if (
    libraryActions &&
    new Set(libraryActions.map((action) => action.id)).size !== libraryActions.length
  ) {
    throw new InvalidExtensionManifestError('Library action ids must be unique.');
  }
  if (
    libraryActions?.length &&
    !resources.some((resource) => resource.name === 'libraryAction')
  ) {
    throw new InvalidExtensionManifestError(
      'Manifests with libraryActions must declare the libraryAction resource.'
    );
  }
  if (
    parsedTransport.kind !== 'host' &&
    parsedTransport.kind !== 'device' &&
    libraryActions?.some((action) => action.requires?.localFile)
  ) {
    throw new InvalidExtensionManifestError(
      'Only reviewed device integrations may request local files for library actions.'
    );
  }

  const libraryImports = Array.isArray(value.libraryImports)
    ? value.libraryImports.map((candidate, index): ExtensionLibraryImport => {
        const libraryImport = record(candidate);
        if (!libraryImport) {
          throw new InvalidExtensionManifestError(`Invalid library import at index ${index}.`);
        }
        const importId = requiredString(libraryImport, 'id');
        const rawExtensions = libraryImport.fileExtensions;
        if (
          !Array.isArray(rawExtensions) ||
          !rawExtensions.length ||
          rawExtensions.some(
            (extension) =>
              typeof extension !== 'string' || !/^[a-z0-9][a-z0-9._+-]*$/i.test(extension)
          )
        ) {
          throw new InvalidExtensionManifestError(
            `Library import "${importId}" must declare valid fileExtensions.`
          );
        }
        const rawMimeTypes = libraryImport.mimeTypes;
        if (
          rawMimeTypes != null &&
          (!Array.isArray(rawMimeTypes) ||
            rawMimeTypes.some(
              (mimeType) =>
                typeof mimeType !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(mimeType)
            ))
        ) {
          throw new InvalidExtensionManifestError(
            `Library import "${importId}" declares an invalid MIME type.`
          );
        }
        const rawPlatforms = libraryImport.platforms;
        const platforms = Array.isArray(rawPlatforms)
          ? rawPlatforms.filter(
              (platform): platform is ExtensionPlatform =>
                platform === 'android' ||
                platform === 'ios' ||
                platform === 'web' ||
                platform === 'desktop'
            )
          : undefined;
        if (
          rawPlatforms != null &&
          (!Array.isArray(rawPlatforms) || platforms?.length !== rawPlatforms.length)
        ) {
          throw new InvalidExtensionManifestError(
            `Library import "${importId}" declares an unsupported platform.`
          );
        }
        return {
          id: importId,
          title: requiredString(libraryImport, 'title'),
          ...(typeof libraryImport.description === 'string'
            ? { description: libraryImport.description }
            : {}),
          ...(typeof libraryImport.icon === 'string' ? { icon: libraryImport.icon } : {}),
          fileExtensions: rawExtensions.map((extension) => extension.toLowerCase()),
          ...(Array.isArray(rawMimeTypes) ? { mimeTypes: [...rawMimeTypes] } : {}),
          ...(platforms ? { platforms } : {}),
        };
      })
    : undefined;
  if (
    libraryImports &&
    new Set(libraryImports.map((libraryImport) => libraryImport.id)).size !==
      libraryImports.length
  ) {
    throw new InvalidExtensionManifestError('Library import ids must be unique.');
  }
  if (
    libraryImports?.length &&
    !resources.some((resource) => resource.name === 'libraryImport')
  ) {
    throw new InvalidExtensionManifestError(
      'Manifests with libraryImports must declare the libraryImport resource.'
    );
  }
  if (
    (libraryImports?.length || resources.some((resource) => resource.name === 'libraryImport')) &&
    parsedTransport.kind !== 'host' &&
    parsedTransport.kind !== 'device'
  ) {
    throw new InvalidExtensionManifestError(
      'Library imports are available only to reviewed local integrations.'
    );
  }

  const readerSetups = Array.isArray(value.readerSetups)
    ? value.readerSetups.map((candidate, index): ExtensionReaderSetup => {
        const setup = record(candidate);
        if (!setup) {
          throw new InvalidExtensionManifestError(`Invalid reader setup at index ${index}.`);
        }
        const setupId = requiredString(setup, 'id');
        const rawPlatforms = setup.platforms;
        const platforms = Array.isArray(rawPlatforms)
          ? rawPlatforms.filter(
              (platform): platform is ExtensionPlatform =>
                platform === 'android' ||
                platform === 'ios' ||
                platform === 'web' ||
                platform === 'desktop'
            )
          : undefined;
        if (
          rawPlatforms != null &&
          (!Array.isArray(rawPlatforms) || platforms?.length !== rawPlatforms.length)
        ) {
          throw new InvalidExtensionManifestError(
            `Reader setup "${setupId}" declares an unsupported platform.`
          );
        }
        return {
          id: setupId,
          title: requiredString(setup, 'title'),
          ...(typeof setup.description === 'string'
            ? { description: setup.description }
            : {}),
          ...(typeof setup.icon === 'string' ? { icon: setup.icon } : {}),
          ...(platforms ? { platforms } : {}),
        };
      })
    : undefined;
  if (
    readerSetups &&
    new Set(readerSetups.map((setup) => setup.id)).size !== readerSetups.length
  ) {
    throw new InvalidExtensionManifestError('Reader setup ids must be unique.');
  }
  if (
    readerSetups?.length &&
    !resources.some((resource) => resource.name === 'reader')
  ) {
    throw new InvalidExtensionManifestError(
      'Manifests with readerSetups must declare the reader resource.'
    );
  }
  if (
    readerSetups?.length &&
    parsedTransport.kind !== 'host'
  ) {
    throw new InvalidExtensionManifestError(
      'Reader setup is available only to reviewed host integrations.'
    );
  }

  const permissions = record(value.permissions);
  const hosts = permissions?.hosts;
  if (hosts != null && !Array.isArray(hosts)) {
    throw new InvalidExtensionManifestError('permissions.hosts must be an array.');
  }
  const parsedHosts = Array.isArray(hosts)
    ? hosts.map((host, index) => {
        if (typeof host !== 'string') {
          throw new InvalidExtensionManifestError(`Invalid host permission at index ${index}.`);
        }
        requireHttps(host, `permissions.hosts[${index}]`);
        return host;
      })
    : undefined;
  const device = permissions?.device;
  if (device != null && !Array.isArray(device)) {
    throw new InvalidExtensionManifestError('permissions.device must be an array.');
  }
  const validDeviceCapabilities = new Set<ExtensionDeviceCapability>([
    'directory.read',
    'file.read',
    'archive.read',
    'sqlite.read',
    'android.preferences.read',
    'android.open-file',
  ]);
  const parsedDevice = Array.isArray(device)
    ? device.map((capability, index) => {
        if (
          typeof capability !== 'string' ||
          !validDeviceCapabilities.has(capability as ExtensionDeviceCapability)
        ) {
          throw new InvalidExtensionManifestError(
            `Invalid device permission at index ${index}.`
          );
        }
        return capability as ExtensionDeviceCapability;
      })
    : undefined;
  if (parsedDevice && new Set(parsedDevice).size !== parsedDevice.length) {
    throw new InvalidExtensionManifestError('permissions.device values must be unique.');
  }
  const androidPackages = permissions?.androidPackages;
  if (androidPackages != null && !Array.isArray(androidPackages)) {
    throw new InvalidExtensionManifestError(
      'permissions.androidPackages must be an array.'
    );
  }
  const parsedAndroidPackages = Array.isArray(androidPackages)
    ? androidPackages.map((packageName, index) => {
        if (
          typeof packageName !== 'string' ||
          !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(packageName)
        ) {
          throw new InvalidExtensionManifestError(
            `Invalid Android package permission at index ${index}.`
          );
        }
        return packageName;
      })
    : undefined;
  if (
    parsedAndroidPackages &&
    new Set(parsedAndroidPackages).size !== parsedAndroidPackages.length
  ) {
    throw new InvalidExtensionManifestError(
      'permissions.androidPackages values must be unique.'
    );
  }
  if (parsedTransport.kind === 'device' && !parsedDevice?.length) {
    throw new InvalidExtensionManifestError(
      'Device integrations must declare permissions.device capabilities.'
    );
  }
  if (
    parsedDevice?.includes('android.open-file') &&
    !parsedAndroidPackages?.length
  ) {
    throw new InvalidExtensionManifestError(
      'android.open-file requires permissions.androidPackages.'
    );
  }
  if (
    parsedTransport.kind !== 'bundled' &&
    parsedTransport.kind !== 'host' &&
    !parsedHosts?.length
  ) {
    throw new InvalidExtensionManifestError(
      'Remote extensions must declare every allowed HTTPS origin in permissions.hosts.'
    );
  }

  const manifest: ExtensionManifest = {
    manifestVersion: EXTENSION_MANIFEST_VERSION,
    id,
    version: requiredString(value, 'version'),
    name: requiredString(value, 'name'),
    description: requiredString(value, 'description'),
    types: ['book'],
    resources,
    transport: parsedTransport,
  };
  if (providerRoles) manifest.providerRoles = providerRoles;

  for (const key of ['author', 'homepage', 'repository'] as const) {
    if (typeof value[key] === 'string') manifest[key] = value[key];
  }
  if (value.icon != null) {
    const icon = requiredString(value, 'icon');
    requireHttps(icon, 'icon');
    manifest.icon = icon;
  }
  if (catalogs) manifest.catalogs = catalogs;
  if (config) manifest.config = config;
  if (behaviorHints) manifest.behaviorHints = behaviorHints;
  if (attribution) manifest.attribution = attribution;
  if (libraryActions) manifest.libraryActions = libraryActions;
  if (libraryImports) manifest.libraryImports = libraryImports;
  if (readerSetups) manifest.readerSetups = readerSetups;
  if (parsedHosts || parsedDevice || parsedAndroidPackages) {
    manifest.permissions = {
      ...(parsedHosts ? { hosts: parsedHosts } : {}),
      ...(parsedDevice ? { device: parsedDevice } : {}),
      ...(parsedAndroidPackages ? { androidPackages: parsedAndroidPackages } : {}),
    };
  }
  return manifest;
}

function responseString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new InvalidExtensionResponseError(`${field} must be a non-empty string.`);
  }
  return value;
}

function responseStrings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new InvalidExtensionResponseError(`${field} must be an array of strings.`);
  }
  return value;
}

function responseUrl(value: unknown, field: string): string | undefined {
  if (value == null) return undefined;
  const result = responseString(value, field);
  try {
    if (new URL(result).protocol !== 'https:') throw new Error('not HTTPS');
  } catch {
    throw new InvalidExtensionResponseError(`${field} must be a valid HTTPS URL.`);
  }
  return result;
}

export function parseExtensionLibraryActionResult(
  input: unknown
): ExtensionLibraryActionResult {
  const value = record(input);
  if (!value) {
    throw new InvalidExtensionResponseError('Library action result must be an object.');
  }
  if (value.kind === 'handled') return { kind: 'handled' };
  if (value.kind === 'openUrl') {
    const url = responseUrl(value.url, 'libraryAction.url');
    if (!url) {
      throw new InvalidExtensionResponseError('libraryAction.url is required.');
    }
    return { kind: 'openUrl', url };
  }
  if (value.kind === 'openLocalFile') {
    const packageName = responseString(
      value.packageName,
      'libraryAction.packageName'
    );
    if (!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(packageName)) {
      throw new InvalidExtensionResponseError(
        'libraryAction.packageName must be a valid Android package name.'
      );
    }
    return { kind: 'openLocalFile', packageName };
  }
  throw new InvalidExtensionResponseError(
    'Library action result has an unsupported kind.'
  );
}

export function parseBookAcquisition(input: unknown): BookAcquisition {
  const value = record(input);
  if (!value) throw new InvalidExtensionResponseError('Acquisition must be an object.');
  const headersValue = record(value.headers);
  const headers = headersValue
    ? Object.fromEntries(
        Object.entries(headersValue).map(([key, header]) => [
          key,
          responseString(header, `acquisition.headers.${key}`),
        ])
      )
    : undefined;
  const sizeBytes = value.sizeBytes;
  if (sizeBytes != null && (typeof sizeBytes !== 'number' || sizeBytes < 0)) {
    throw new InvalidExtensionResponseError('acquisition.sizeBytes must be a positive number.');
  }
  return {
    id: responseString(value.id, 'acquisition.id'),
    bookId: responseString(value.bookId, 'acquisition.bookId'),
    format: responseString(value.format, 'acquisition.format'),
    label: responseString(value.label, 'acquisition.label'),
    downloadUrl: responseUrl(value.downloadUrl, 'acquisition.downloadUrl'),
    openUrl: responseUrl(value.openUrl, 'acquisition.openUrl'),
    ...(typeof sizeBytes === 'number' ? { sizeBytes } : {}),
    ...(typeof value.language === 'string' ? { language: value.language } : {}),
    ...(headers ? { headers } : {}),
  };
}

export function parseBookMetadata(input: unknown): BookMetadata {
  const value = record(input);
  if (!value) throw new InvalidExtensionResponseError('Book metadata must be an object.');
  const identifiersValue = record(value.identifiers);
  if (!identifiersValue) {
    throw new InvalidExtensionResponseError('book.identifiers must be an object.');
  }
  const identifiers = Object.fromEntries(
    Object.entries(identifiersValue).map(([key, identifier]) => [
      key,
      responseString(identifier, `book.identifiers.${key}`),
    ])
  );
  const optionalNumber = (field: string): number | undefined => {
    const candidate = value[field];
    if (candidate == null) return undefined;
    if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
      throw new InvalidExtensionResponseError(`book.${field} must be a finite number.`);
    }
    return candidate;
  };
  const offers = Array.isArray(value.offers)
    ? value.offers.map((candidate, index): BookOffer => {
        const offer = record(candidate);
        if (!offer) {
          throw new InvalidExtensionResponseError(`book.offers[${index}] must be an object.`);
        }
        const availability = responseString(
          offer.availability,
          `book.offers[${index}].availability`
        );
        if (!['for-sale', 'free', 'preorder'].includes(availability)) {
          throw new InvalidExtensionResponseError(
            `book.offers[${index}].availability is unsupported.`
          );
        }
        const priceValue = record(offer.price);
        const amount = priceValue?.amount;
        if (
          priceValue &&
          (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0)
        ) {
          throw new InvalidExtensionResponseError(
            `book.offers[${index}].price.amount must be a non-negative finite number.`
          );
        }
        const offerUrl = responseUrl(offer.url, `book.offers[${index}].url`);
        if (!offerUrl) {
          throw new InvalidExtensionResponseError(`book.offers[${index}].url is required.`);
        }
        return {
          provider: responseString(offer.provider, `book.offers[${index}].provider`),
          availability: availability as BookOffer['availability'],
          ...(typeof offer.country === 'string' ? { country: offer.country } : {}),
          ...(priceValue
            ? {
                price: {
                  amount: amount as number,
                  currency: responseString(
                    priceValue.currency,
                    `book.offers[${index}].price.currency`
                  ),
                },
              }
            : {}),
          url: offerUrl,
        };
      })
    : undefined;
  return {
    id: responseString(value.id, 'book.id'),
    title: responseString(value.title, 'book.title'),
    authors: responseStrings(value.authors, 'book.authors'),
    subjects: responseStrings(value.subjects, 'book.subjects'),
    identifiers,
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(value.coverUrl != null
      ? { coverUrl: responseUrl(value.coverUrl, 'book.coverUrl') }
      : {}),
    ...(optionalNumber('publishedYear') != null
      ? { publishedYear: optionalNumber('publishedYear') }
      : {}),
    ...(optionalNumber('rating') != null ? { rating: optionalNumber('rating') } : {}),
    ...(optionalNumber('ratingsCount') != null
      ? { ratingsCount: optionalNumber('ratingsCount') }
      : {}),
    ...(optionalNumber('seriesPosition') != null
      ? { seriesPosition: optionalNumber('seriesPosition') }
      : {}),
    ...(value.infoUrl != null ? { infoUrl: responseUrl(value.infoUrl, 'book.infoUrl') } : {}),
    ...(offers ? { offers } : {}),
    ...(Array.isArray(value.acquisitions)
      ? { acquisitions: value.acquisitions.map(parseBookAcquisition) }
      : {}),
  };
}

export function parseExtensionPage(input: unknown): ExtensionPage<BookMetadata> {
  const value = record(input);
  if (!value || !Array.isArray(value.items)) {
    throw new InvalidExtensionResponseError('Page response must contain an items array.');
  }
  if (
    value.nextPage != null &&
    (typeof value.nextPage !== 'number' || !Number.isInteger(value.nextPage) || value.nextPage < 1)
  ) {
    throw new InvalidExtensionResponseError('Page nextPage must be a positive integer.');
  }
  return {
    items: value.items.map(parseBookMetadata),
    ...(typeof value.nextPage === 'number' ? { nextPage: value.nextPage } : {}),
  };
}

export function parseBookReview(input: unknown): BookReview {
  const value = record(input);
  if (!value) throw new InvalidExtensionResponseError('Review must be an object.');
  const optionalNumber = (field: string): number | undefined => {
    const candidate = value[field];
    if (candidate == null) return undefined;
    if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < 0) {
      throw new InvalidExtensionResponseError(`review.${field} must be a non-negative number.`);
    }
    return candidate;
  };
  const rating = optionalNumber('rating');
  const likesCount = optionalNumber('likesCount');
  if (rating != null && rating > 5) {
    throw new InvalidExtensionResponseError('review.rating must be between 0 and 5.');
  }
  const reviewedAt = value.reviewedAt;
  if (reviewedAt != null && typeof reviewedAt !== 'string') {
    throw new InvalidExtensionResponseError('review.reviewedAt must be a string.');
  }
  return {
    id: responseString(value.id, 'review.id'),
    author: responseString(value.author, 'review.author'),
    text: responseString(value.text, 'review.text'),
    ...(rating != null ? { rating } : {}),
    ...(typeof reviewedAt === 'string' ? { reviewedAt } : {}),
    ...(typeof value.containsSpoilers === 'boolean'
      ? { containsSpoilers: value.containsSpoilers }
      : {}),
    ...(likesCount != null ? { likesCount } : {}),
    ...(value.authorAvatarUrl != null
      ? { authorAvatarUrl: responseUrl(value.authorAvatarUrl, 'review.authorAvatarUrl') }
      : {}),
    ...(value.authorUrl != null
      ? { authorUrl: responseUrl(value.authorUrl, 'review.authorUrl') }
      : {}),
  };
}

export function parseExtensionReviewPage(input: unknown): ExtensionPage<BookReview> {
  const value = record(input);
  if (!value || !Array.isArray(value.items)) {
    throw new InvalidExtensionResponseError('Review page response must contain an items array.');
  }
  if (
    value.nextPage != null &&
    (typeof value.nextPage !== 'number' || !Number.isInteger(value.nextPage) || value.nextPage < 1)
  ) {
    throw new InvalidExtensionResponseError('Review page nextPage must be a positive integer.');
  }
  return {
    items: value.items.map(parseBookReview),
    ...(typeof value.nextPage === 'number' ? { nextPage: value.nextPage } : {}),
  };
}
