import {
  type BookExtension,
  type ExtensionConfigValue,
  type ExtensionDeviceCapability,
  type ExtensionDeviceOperation,
  type ExtensionDeviceWorkflowDefinition,
  type ExtensionDeviceWorkflowResource,
  type ExtensionLibraryActionResult,
  type ExtensionManifest,
  type ExtensionReaderBook,
  type ExtensionReaderSyncResult,
  type ExtensionWorkflowExpression,
} from '@tomeio/extension-protocol';

import {
  evaluateWorkflowExpression,
  validateWorkflowExpression,
} from './declarative';

const MAX_DEVICE_STEPS = 16;
const MAX_READER_BOOKS = 5_000;

const OPERATION_CAPABILITIES: Record<ExtensionDeviceOperation['kind'], ExtensionDeviceCapability> = {
  'directory.scan': 'directory.read',
  'file.read': 'file.read',
  'archive.read': 'archive.read',
  'sqlite.query': 'sqlite.read',
  'android.preferences.parse': 'android.preferences.read',
  'android.open-file': 'android.open-file',
};

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function strings(value: unknown, label: string, maximum = 32): string[] | undefined {
  if (value == null) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    value.some((entry) => typeof entry !== 'string' || !entry)
  ) {
    throw new Error(`${label} must be an array of at most ${maximum} non-empty strings.`);
  }
  return [...value];
}

function validateOperation(
  input: unknown,
  manifest: ExtensionManifest,
  label: string
): ExtensionDeviceOperation {
  const operation = record(input);
  if (!operation || typeof operation.kind !== 'string') {
    throw new Error(`${label} must declare an operation kind.`);
  }
  const capability = OPERATION_CAPABILITIES[operation.kind as ExtensionDeviceOperation['kind']];
  if (!capability) throw new Error(`${label} uses an unsupported device operation.`);
  if (!manifest.permissions?.device?.includes(capability)) {
    throw new Error(`${label} requires undeclared device capability "${capability}".`);
  }

  if (operation.kind === 'directory.scan') {
    if (operation.directory === undefined) throw new Error(`${label} requires a directory.`);
    validateWorkflowExpression(operation.directory as ExtensionWorkflowExpression);
    const maxDepth = operation.maxDepth ?? 4;
    const limit = operation.limit ?? 20;
    if (!Number.isInteger(maxDepth) || Number(maxDepth) < 0 || Number(maxDepth) > 8) {
      throw new Error(`${label}.maxDepth must be between 0 and 8.`);
    }
    if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 2_000) {
      throw new Error(`${label}.limit must be between 1 and 2000.`);
    }
    if (operation.order != null && !['modified-desc', 'name-asc'].includes(String(operation.order))) {
      throw new Error(`${label}.order is unsupported.`);
    }
    return {
      kind: 'directory.scan',
      directory: operation.directory as ExtensionWorkflowExpression,
      ...(strings(operation.filenames, `${label}.filenames`) ? { filenames: strings(operation.filenames, `${label}.filenames`) } : {}),
      ...(strings(operation.extensions, `${label}.extensions`) ? { extensions: strings(operation.extensions, `${label}.extensions`) } : {}),
      maxDepth: Number(maxDepth),
      limit: Number(limit),
      ...(operation.order ? { order: operation.order as 'modified-desc' | 'name-asc' } : {}),
    };
  }

  if (operation.kind === 'archive.read') {
    if (operation.archive === undefined) throw new Error(`${label} requires an archive.`);
    validateWorkflowExpression(operation.archive as ExtensionWorkflowExpression);
    const entry = record(operation.entry);
    if (!entry) throw new Error(`${label} requires an archive entry selector.`);
    let parsedEntry: Extract<ExtensionDeviceOperation, { kind: 'archive.read' }>['entry'];
    if (typeof entry.suffix === 'string' && entry.suffix) {
      parsedEntry = { suffix: entry.suffix };
    } else {
      if (entry.indexed === undefined || typeof entry.targetSuffix !== 'string' || !entry.targetSuffix) {
        throw new Error(`${label} has an invalid indexed archive entry selector.`);
      }
      validateWorkflowExpression(entry.indexed as ExtensionWorkflowExpression);
      parsedEntry = {
        indexed: entry.indexed as ExtensionWorkflowExpression,
        targetSuffix: entry.targetSuffix,
        ...(typeof entry.entryExtension === 'string'
          ? { entryExtension: entry.entryExtension }
          : {}),
      };
    }
    if (operation.response !== 'text' && operation.response !== 'bytes') {
      throw new Error(`${label}.response must be text or bytes.`);
    }
    return {
      kind: 'archive.read',
      archive: operation.archive as ExtensionWorkflowExpression,
      entry: parsedEntry,
      response: operation.response,
    };
  }

  if (operation.kind === 'file.read') {
    if (operation.file === undefined) throw new Error(`${label} requires a file.`);
    validateWorkflowExpression(operation.file as ExtensionWorkflowExpression);
    if (!['text', 'json', 'bytes'].includes(String(operation.response))) {
      throw new Error(`${label}.response must be text, JSON, or bytes.`);
    }
    return {
      kind: 'file.read',
      file: operation.file as ExtensionWorkflowExpression,
      response: operation.response as 'text' | 'json' | 'bytes',
    };
  }

  if (operation.kind === 'sqlite.query') {
    if (operation.database === undefined) throw new Error(`${label} requires a database.`);
    validateWorkflowExpression(operation.database as ExtensionWorkflowExpression);
    const queries = record(operation.queries);
    if (!queries || !Object.keys(queries).length || Object.keys(queries).length > 8) {
      throw new Error(`${label}.queries must contain between 1 and 8 queries.`);
    }
    const parsedQueries = Object.fromEntries(
      Object.entries(queries).map(([id, query]) => {
        if (!/^[a-z][a-z0-9_-]*$/.test(id) || typeof query !== 'string' || !query.trim()) {
          throw new Error(`${label} contains an invalid SQLite query.`);
        }
        return [id, query];
      })
    );
    return {
      kind: 'sqlite.query',
      database: operation.database as ExtensionWorkflowExpression,
      queries: parsedQueries,
    };
  }

  if (operation.kind === 'android.preferences.parse') {
    if (operation.text === undefined) throw new Error(`${label} requires preference XML text.`);
    validateWorkflowExpression(operation.text as ExtensionWorkflowExpression);
    return {
      kind: 'android.preferences.parse',
      text: operation.text as ExtensionWorkflowExpression,
    };
  }

  if (operation.kind === 'android.open-file') {
    if (operation.uri === undefined) throw new Error(`${label} requires a file URI.`);
    validateWorkflowExpression(operation.uri as ExtensionWorkflowExpression);
    if (operation.format !== undefined) {
      validateWorkflowExpression(operation.format as ExtensionWorkflowExpression);
    }
    const packages = strings(operation.packages, `${label}.packages`, 12) ?? [];
    if (!packages.length) throw new Error(`${label} requires at least one Android package.`);
    const allowedPackages = new Set(manifest.permissions?.androidPackages ?? []);
    if (packages.some((packageName) => !allowedPackages.has(packageName))) {
      throw new Error(`${label} uses an undeclared Android package.`);
    }
    const mimeTypes = record(operation.mimeTypes);
    if (mimeTypes && Object.values(mimeTypes).some((entry) => typeof entry !== 'string')) {
      throw new Error(`${label}.mimeTypes must map formats to MIME type strings.`);
    }
    return {
      kind: 'android.open-file',
      uri: operation.uri as ExtensionWorkflowExpression,
      ...(operation.format !== undefined
        ? { format: operation.format as ExtensionWorkflowExpression }
        : {}),
      packages,
      ...(typeof operation.activitySuffix === 'string'
        ? { activitySuffix: operation.activitySuffix }
        : {}),
      ...(mimeTypes ? { mimeTypes: mimeTypes as Record<string, string> } : {}),
    };
  }

  throw new Error(`${label} uses an unsupported device operation.`);
}

function validateResource(
  input: unknown,
  manifest: ExtensionManifest,
  name: 'reader' | 'libraryAction'
): ExtensionDeviceWorkflowResource {
  const resource = record(input);
  if (!resource || !Array.isArray(resource.steps) || !resource.steps.length) {
    throw new Error(`Device ${name} workflow must declare operation steps.`);
  }
  if (resource.steps.length > MAX_DEVICE_STEPS) {
    throw new Error(`Device ${name} workflow exceeds the ${MAX_DEVICE_STEPS}-step limit.`);
  }
  const ids = new Set<string>();
  const steps = resource.steps.map((inputStep, index) => {
    const step = record(inputStep);
    if (!step || typeof step.id !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(step.id)) {
      throw new Error(`Device ${name} step ${index} has an invalid id.`);
    }
    if (ids.has(step.id)) throw new Error(`Device ${name} step "${step.id}" is duplicated.`);
    ids.add(step.id);
    if (step.when !== undefined) {
      validateWorkflowExpression(step.when as ExtensionWorkflowExpression);
    }
    return {
      id: step.id,
      ...(step.when !== undefined
        ? { when: step.when as ExtensionWorkflowExpression }
        : {}),
      ...(typeof step.optional === 'boolean' ? { optional: step.optional } : {}),
      operation: validateOperation(step.operation, manifest, `Device ${name} step "${step.id}"`),
    };
  });
  if (resource.output === undefined) {
    throw new Error(`Device ${name} workflow must declare output.`);
  }
  validateWorkflowExpression(resource.output as ExtensionWorkflowExpression);
  return { steps, output: resource.output as ExtensionWorkflowExpression };
}

export function parseDeviceWorkflowDefinition(
  input: unknown,
  manifest: ExtensionManifest
): ExtensionDeviceWorkflowDefinition {
  if (manifest.transport.kind !== 'device') {
    throw new Error(`Extension "${manifest.id}" does not use a device transport.`);
  }
  const value = record(input);
  if (!value || value.deviceWorkflowVersion !== 1) {
    throw new Error('Device workflow must use deviceWorkflowVersion 1.');
  }
  const resources = record(value.resources);
  if (!resources) throw new Error('Device workflow must declare resources.');
  const parsed: ExtensionDeviceWorkflowDefinition['resources'] = {};
  for (const resource of manifest.resources) {
    if (resource.name !== 'reader' && resource.name !== 'libraryAction') {
      throw new Error(`Device workflows cannot implement ${resource.name}.`);
    }
    const workflow = resources[resource.name];
    if (!workflow) throw new Error(`Device workflow does not implement ${resource.name}.`);
    parsed[resource.name] = validateResource(workflow, manifest, resource.name);
  }
  return { deviceWorkflowVersion: 1, resources: parsed };
}

function allowedOrigin(manifest: ExtensionManifest, url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    !!manifest.permissions?.hosts?.some((host) => new URL(host).origin === url.origin)
  );
}

export async function fetchDeviceWorkflowDefinition(
  manifest: ExtensionManifest,
  fetchFn: typeof fetch
): Promise<ExtensionDeviceWorkflowDefinition> {
  if (manifest.transport.kind !== 'device') {
    throw new Error(`Extension "${manifest.id}" has no device workflow URL.`);
  }
  const url = new URL(manifest.transport.definitionUrl);
  if (!allowedOrigin(manifest, url)) {
    throw new Error(`Device workflow definition uses undeclared origin ${url.origin}.`);
  }
  const response = await fetchFn(url.toString(), {
    headers: { Accept: 'application/json' },
    redirect: 'error',
  });
  if (!response.ok) {
    throw new Error(`Device workflow request failed (${response.status}) for ${url}.`);
  }
  return parseDeviceWorkflowDefinition(await response.json(), manifest);
}

export interface ExtensionDeviceExecutionContext {
  manifest: ExtensionManifest;
  configuration: Record<string, ExtensionConfigValue>;
  /** Current input and completed step results, used by the host to verify URI provenance. */
  workflow: Readonly<Record<string, unknown>>;
  evaluate(expression: ExtensionWorkflowExpression): unknown;
}

export interface ExtensionDeviceHost {
  execute(
    operation: ExtensionDeviceOperation,
    context: ExtensionDeviceExecutionContext
  ): Promise<unknown>;
}

async function executeResource(
  resource: ExtensionDeviceWorkflowResource,
  input: unknown,
  configuration: Record<string, ExtensionConfigValue>,
  manifest: ExtensionManifest,
  host: ExtensionDeviceHost
): Promise<unknown> {
  let workflowContext: Record<string, unknown> = { input, config: configuration, steps: {} };
  for (const step of resource.steps) {
    const evaluate = (expression: ExtensionWorkflowExpression) =>
      evaluateWorkflowExpression(expression, workflowContext, {
        maxNodes: 1_000_000,
        maxItems: MAX_READER_BOOKS,
      });
    if (step.when !== undefined && !Boolean(evaluate(step.when))) {
      workflowContext = {
        ...workflowContext,
        steps: { ...(record(workflowContext.steps) ?? {}), [step.id]: { skipped: true } },
      };
      continue;
    }
    let result: unknown;
    try {
      result = await host.execute(step.operation, {
        manifest,
        configuration,
        workflow: workflowContext,
        evaluate,
      });
    } catch (cause) {
      if (!step.optional) throw cause;
      result = { error: cause instanceof Error ? cause.message : String(cause) };
    }
    workflowContext = {
      ...workflowContext,
      steps: { ...(record(workflowContext.steps) ?? {}), [step.id]: result },
    };
  }
  return evaluateWorkflowExpression(resource.output, workflowContext, {
    maxNodes: 1_000_000,
    maxItems: MAX_READER_BOOKS,
  });
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value;
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value == null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number.`);
  return number;
}

function parseReaderBook(input: unknown, index: number): ExtensionReaderBook {
  const value = record(input);
  if (!value) throw new Error(`Reader book ${index} must be an object.`);
  const authors = Array.isArray(value.authors)
    ? value.authors.filter((author): author is string => typeof author === 'string')
    : [];
  const identifiers = record(value.identifiers);
  const parsedIdentifiers = identifiers
    ? Object.fromEntries(
        Object.entries(identifiers).flatMap(([key, identifier]) =>
          typeof identifier === 'string' ? [[key, identifier]] : []
        )
      )
    : {};
  const progress = optionalNumber(value.progress, `Reader book ${index}.progress`);
  const publishedYear = optionalNumber(value.publishedYear, `Reader book ${index}.publishedYear`);
  const addedAt = optionalNumber(value.addedAt, `Reader book ${index}.addedAt`);
  const readingTimeMs = optionalNumber(
    value.readingTimeMs,
    `Reader book ${index}.readingTimeMs`
  );
  const wordsRead = optionalNumber(value.wordsRead, `Reader book ${index}.wordsRead`);
  const lastReadAt = optionalNumber(value.lastReadAt, `Reader book ${index}.lastReadAt`);
  if (progress != null && (progress < 0 || progress > 100)) {
    throw new Error(`Reader book ${index}.progress must be between 0 and 100.`);
  }
  return {
    sourceId: requiredString(value.sourceId, `Reader book ${index}.sourceId`),
    ...(typeof value.id === 'string' ? { id: value.id } : {}),
    title: requiredString(value.title, `Reader book ${index}.title`),
    authors,
    ...(publishedYear != null ? { publishedYear } : {}),
    identifiers: parsedIdentifiers,
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(Array.isArray(value.subjects)
      ? { subjects: value.subjects.filter((subject): subject is string => typeof subject === 'string') }
      : {}),
    ...(typeof value.format === 'string' ? { format: value.format } : {}),
    ...(typeof value.sourceFilename === 'string' ? { sourceFilename: value.sourceFilename } : {}),
    ...(typeof value.sourcePath === 'string' ? { sourcePath: value.sourcePath } : {}),
    ...(addedAt != null ? { addedAt } : {}),
    ...(progress != null ? { progress } : {}),
    ...(typeof value.isRead === 'boolean' ? { isRead: value.isRead } : {}),
    ...(readingTimeMs != null ? { readingTimeMs } : {}),
    ...(wordsRead != null ? { wordsRead } : {}),
    ...(lastReadAt != null ? { lastReadAt } : {}),
  };
}

function parseReaderResult(input: unknown): ExtensionReaderSyncResult {
  const value = record(input);
  if (!value || !Array.isArray(value.books)) {
    throw new Error('Device reader output must contain a books array.');
  }
  if (value.books.length > MAX_READER_BOOKS) {
    throw new Error(`Device reader output exceeds the ${MAX_READER_BOOKS}-book limit.`);
  }
  const books = value.books.map(parseReaderBook);
  return {
    books,
    progress: books.flatMap((book) =>
      typeof book.progress === 'number'
        ? [{
            book: {
              ...(book.id ? { id: book.id } : {}),
              title: book.title,
              authors: book.authors,
              ...(book.publishedYear != null ? { publishedYear: book.publishedYear } : {}),
              identifiers: book.identifiers,
            },
            progress: book.progress,
            isRead: book.isRead ?? book.progress >= 99.5,
            ...(book.readingTimeMs != null ? { readingTimeMs: book.readingTimeMs } : {}),
            ...(book.wordsRead != null ? { wordsRead: book.wordsRead } : {}),
            ...(book.lastReadAt != null ? { lastReadAt: book.lastReadAt } : {}),
          }]
        : []
    ),
    ...(Array.isArray(value.warnings)
      ? { warnings: value.warnings.filter((warning): warning is string => typeof warning === 'string') }
      : {}),
  };
}

export function createDeviceWorkflowExtension(
  manifest: ExtensionManifest,
  definition: ExtensionDeviceWorkflowDefinition,
  host: ExtensionDeviceHost,
  configuration: Record<string, ExtensionConfigValue>
): BookExtension {
  const run = (resource: 'reader' | 'libraryAction', input: unknown) => {
    const workflow = definition.resources[resource];
    if (!workflow) throw new Error(`Device workflow does not implement ${resource}.`);
    return executeResource(workflow, input, configuration, manifest, host);
  };
  const has = (resource: 'reader' | 'libraryAction') =>
    manifest.resources.some((candidate) => candidate.name === resource);
  return {
    manifest,
    ...(has('reader')
      ? { readerSync: (request) => run('reader', request).then(parseReaderResult) }
      : {}),
    ...(has('libraryAction')
      ? {
          libraryAction: (request) =>
            run('libraryAction', request).then((input): ExtensionLibraryActionResult => {
              const value = record(input);
              if (value?.kind === 'handled') return { kind: 'handled' };
              throw new Error('Device library action output must be handled by the host.');
            }),
        }
      : {}),
  };
}
