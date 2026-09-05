import {
  parseExtensionManifest,
  type BookExtension,
  type ExtensionLibraryActionRequest,
  type ExtensionLibraryImportRequest,
  type ExtensionManifest,
  type ExtensionInvocationContext,
  type ExtensionQuery,
  type ExtensionResolveQuery,
  type ExtensionReviewsQuery,
  type ExtensionReaderSyncRequest,
  type ExtensionDeviceWorkflowDefinition,
  type ExtensionWorkflowDefinition,
} from '@tomeio/extension-protocol';

export type {
  BookAcquisition,
  BookMetadata,
  BookOffer,
  BookPrice,
  BookReview,
} from '@tomeio/domain';
export * from '@tomeio/extension-protocol';

export type TomeAddon = BookExtension;
export type TomeAddonManifest = ExtensionManifest;
export type AddonManifest = ExtensionManifest;
export type AddonQuery = ExtensionQuery;
export type AddonResolveQuery = ExtensionResolveQuery;
export type AddonReviewsQuery = ExtensionReviewsQuery;
export type AddonLibraryActionRequest = ExtensionLibraryActionRequest;
export type AddonLibraryImportRequest = ExtensionLibraryImportRequest;

export interface AddonRequestContext extends ExtensionInvocationContext {
  request: Request;
}

export class AddonProtocolError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'AddonProtocolError';
    this.status = status;
  }
}

/** Defines a JSON-only workflow that Tomeio can interpret without executing add-on code. */
export function defineWorkflow(
  definition: ExtensionWorkflowDefinition
): ExtensionWorkflowDefinition {
  return definition;
}

/** Defines a reviewed JSON-only workflow using permissioned device capabilities. */
export function defineDeviceWorkflow(
  definition: ExtensionDeviceWorkflowDefinition
): ExtensionDeviceWorkflowDefinition {
  return definition;
}

export function readAddonConfiguration(
  request: Request
): Record<string, string | number | boolean> {
  const encoded = request.headers.get('x-tomeio-config');
  if (!encoded) return {};
  try {
    const value: unknown = JSON.parse(decodeURIComponent(encoded));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('configuration must be an object');
    }
    if (
      Object.values(value).some(
        (entry) =>
          typeof entry !== 'string' &&
          typeof entry !== 'number' &&
          typeof entry !== 'boolean'
      )
    ) {
      throw new Error('configuration values must be strings, numbers, or booleans');
    }
    return value as Record<string, string | number | boolean>;
  } catch (cause) {
    throw new AddonProtocolError(
      `X-Tomeio-Config is invalid: ${cause instanceof Error ? cause.message : String(cause)}`
    );
  }
}

/**
 * Defines an add-on while checking that every handler is declared as a resource.
 * The returned object is framework-independent and can also be used for host adapters.
 */
export function defineAddon(
  manifestInput: ExtensionManifest,
  handlers: Omit<BookExtension, 'manifest'>
): TomeAddon {
  const manifest = parseExtensionManifest(manifestInput);
  const declared = new Set(manifest.resources.map((resource) => resource.name));
  for (const resource of [
    'catalog',
    'search',
    'meta',
    'resolve',
    'reviews',
    'acquisition',
    'readerSync',
    'readerSetup',
    'libraryAction',
    'libraryImport',
  ] as const) {
    if (!handlers[resource]) continue;
    const manifestResource =
      resource === 'readerSync' || resource === 'readerSetup' ? 'reader' : resource;
    if (!declared.has(manifestResource)) {
      throw new AddonProtocolError(
        `Handler "${resource}" is not declared in ${manifest.id}'s resources.`
      );
    }
  }
  return { manifest, ...handlers };
}

function numberParameter(url: URL, key: string): number | undefined {
  const value = url.searchParams.get(key);
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AddonProtocolError(`Query parameter "${key}" must be a positive integer.`);
  }
  return parsed;
}

function queryFromUrl(url: URL): ExtensionQuery {
  return {
    query: url.searchParams.get('query') ?? undefined,
    catalogId: url.searchParams.get('catalogId') ?? undefined,
    page: numberParameter(url, 'page'),
    limit: numberParameter(url, 'limit'),
    language: url.searchParams.get('language') ?? undefined,
    format: url.searchParams.get('format') ?? undefined,
    subject: url.searchParams.get('subject') ?? undefined,
  };
}

async function jsonBody<T>(request: Request): Promise<T> {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new AddonProtocolError('Request body must use application/json.');
  }
  try {
    return (await request.json()) as T;
  } catch (cause) {
    throw new AddonProtocolError(
      `Request body is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`
    );
  }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Creates a Web-standard request handler for Bun, Node 22, serverless functions,
 * or any framework that can adapt Request/Response.
 */
export function createAddonHandler(addon: TomeAddon) {
  return async (request: Request): Promise<Response> => {
    try {
      const context: AddonRequestContext = {
        request,
        configuration: readAddonConfiguration(request),
      };
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '') || '/';
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, X-Tomeio-Config',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          },
        });
      }
      if (
        request.method === 'GET' &&
        (path === '/manifest.json' ||
          path === '/tomeio-addon.json' ||
          path === '/tomeio-extension.json')
      ) {
        return json(addon.manifest);
      }

      let match = path.match(/^\/catalog\/book\/([^/]+)\.json$/);
      if (request.method === 'GET' && match) {
        if (!addon.catalog) throw new AddonProtocolError('Catalog resource is unavailable.', 404);
        return json(
          await addon.catalog({
            ...queryFromUrl(url),
            catalogId: decodeURIComponent(match[1] ?? ''),
          }, context)
        );
      }
      if (request.method === 'GET' && path === '/search/book.json') {
        if (!addon.search) throw new AddonProtocolError('Search resource is unavailable.', 404);
        return json(await addon.search(queryFromUrl(url), context));
      }
      match = path.match(/^\/meta\/book\/([^/]+)\.json$/);
      if (request.method === 'GET' && match) {
        if (!addon.meta) throw new AddonProtocolError('Metadata resource is unavailable.', 404);
        return json(await addon.meta(decodeURIComponent(match[1] ?? ''), context));
      }
      match = path.match(/^\/acquisition\/book\/([^/]+)\.json$/);
      if (request.method === 'GET' && match) {
        if (!addon.acquisition) {
          throw new AddonProtocolError('Acquisition resource is unavailable.', 404);
        }
        return json(await addon.acquisition(decodeURIComponent(match[1] ?? ''), context));
      }
      if (request.method === 'POST' && path === '/resolve/book.json') {
        if (!addon.resolve) throw new AddonProtocolError('Resolve resource is unavailable.', 404);
        return json(
          await addon.resolve(await jsonBody<ExtensionResolveQuery>(request), context)
        );
      }
      if (request.method === 'POST' && path === '/reviews/book.json') {
        if (!addon.reviews) throw new AddonProtocolError('Reviews resource is unavailable.', 404);
        return json(
          await addon.reviews(await jsonBody<ExtensionReviewsQuery>(request), context)
        );
      }
      if (request.method === 'POST' && path === '/action/library.json') {
        if (!addon.libraryAction) {
          throw new AddonProtocolError('Library action resource is unavailable.', 404);
        }
        return json(
          await addon.libraryAction(
            await jsonBody<ExtensionLibraryActionRequest>(request),
            context
          )
        );
      }
      if (request.method === 'POST' && path === '/reader/sync.json') {
        if (!addon.readerSync) {
          throw new AddonProtocolError('Reader resource is unavailable.', 404);
        }
        return json(
          await addon.readerSync(
            await jsonBody<ExtensionReaderSyncRequest>(request),
            context
          )
        );
      }
      throw new AddonProtocolError('Resource not found.', 404);
    } catch (cause) {
      const status = cause instanceof AddonProtocolError ? cause.status : 500;
      return json(
        {
          error: {
            code: status === 404 ? 'resource_not_found' : 'addon_error',
            message: cause instanceof Error ? cause.message : String(cause),
          },
        },
        status
      );
    }
  };
}
