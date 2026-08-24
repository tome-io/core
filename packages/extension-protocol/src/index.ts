import type { BookAcquisition, BookMetadata } from '@readoi/domain';

export const EXTENSION_MANIFEST_VERSION = 1 as const;

export type ExtensionResourceName = 'catalog' | 'search' | 'meta' | 'acquisition';

export interface ExtensionResource {
  name: ExtensionResourceName;
  id?: string;
  supportsPagination?: boolean;
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
      type: 'text' | 'password';
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
  catalogs?: ExtensionCatalog[];
  config?: ExtensionConfigField[];
  behaviorHints?: ExtensionBehaviorHints;
  transport: ExtensionTransport;
  permissions?: {
    hosts?: string[];
  };
}

export interface ExtensionQuery {
  query?: string;
  catalogId?: string;
  page?: number;
  limit?: number;
  language?: string;
  format?: string;
}

export interface ExtensionPage<T> {
  items: T[];
  nextPage?: number;
}

export interface BookExtension {
  manifest: ExtensionManifest;
  catalog?(query: ExtensionQuery): Promise<ExtensionPage<BookMetadata>>;
  search?(query: ExtensionQuery): Promise<ExtensionPage<BookMetadata>>;
  meta?(id: string): Promise<BookMetadata | null>;
  acquisition?(id: string): Promise<BookAcquisition[]>;
}

export class InvalidExtensionManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidExtensionManifestError';
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
  'acquisition',
]);

const CONFIG_FIELD_TYPES = new Set<ExtensionConfigField['type']>([
  'text',
  'password',
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
        return {
          name: resource.name as ExtensionResourceName,
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
          type: field.type,
          title,
          ...(required != null ? { required } : {}),
          ...(typeof field.default === 'string' ? { default: field.default } : {}),
        };
      })
    : undefined;
  if (config && new Set(config.map((field) => field.key)).size !== config.length) {
    throw new InvalidExtensionManifestError('Config field keys must be unique.');
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
  if (
    parsedTransport.kind !== 'bundled' &&
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

  for (const key of ['author', 'homepage', 'repository', 'icon'] as const) {
    if (typeof value[key] === 'string') manifest[key] = value[key];
  }
  if (catalogs) manifest.catalogs = catalogs;
  if (config) manifest.config = config;
  if (behaviorHints) manifest.behaviorHints = behaviorHints;
  if (parsedHosts) manifest.permissions = { hosts: parsedHosts };
  return manifest;
}
