import {
  parseBookAcquisition,
  parseBookMetadata,
  parseExtensionPage,
  parseExtensionReviewPage,
  parseExtensionLibraryActionResult,
  type BookExtension,
  type ExtensionConfigValue,
  type ExtensionManifest,
  type ExtensionReaderSyncResult,
  type ExtensionResourceName,
  type ExtensionWorkflowDefinition,
  type ExtensionWorkflowExpression,
  type ExtensionWorkflowRequest,
  type ExtensionWorkflowResource,
} from '@tomeio/extension-protocol';
import { ExtensionSessionManager, type ExtensionSession, type ExtensionSessionAccess } from './sessions';

class SessionRejectedError extends Error {
  constructor() { super('Extension session was rejected (HTTP 401).'); }
}

const MAX_EXPRESSION_DEPTH = 24;
const MAX_EXPRESSION_NODES = 2_000;
const MAX_EVALUATION_NODES = 50_000;
const MAX_MAP_ITEMS = 200;
const MAX_REQUEST_STEPS = 8;
const MAX_REQUEST_URLS = 12;
const MAX_REQUEST_ATTEMPTS = 20;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TRANSIENT_REQUEST_ATTEMPTS = 2;
const MAX_CONCURRENT_REQUESTS_PER_ORIGIN = 1;

type OriginRequestSchedule = {
  active: number;
  waiting: Array<() => void>;
  minimumIntervalMs: number;
  nextStartAt: number;
};

const originRequestSchedules = new Map<string, OriginRequestSchedule>();

async function acquireOriginRequest(origin: string): Promise<() => void> {
  const schedule = originRequestSchedules.get(origin) ?? {
    active: 0,
    waiting: [],
    minimumIntervalMs: 0,
    nextStartAt: 0,
  };
  originRequestSchedules.set(origin, schedule);
  if (schedule.active >= MAX_CONCURRENT_REQUESTS_PER_ORIGIN) {
    await new Promise<void>((resolve) => schedule.waiting.push(resolve));
  } else {
    schedule.active += 1;
  }

  const now = Date.now();
  const startAt = Math.max(now, schedule.nextStartAt);
  schedule.nextStartAt = startAt + schedule.minimumIntervalMs;
  if (startAt > now) await wait(startAt - now);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = schedule.waiting.shift();
    if (next) {
      next();
      return;
    }
    schedule.active -= 1;
  };
}

function responseHeader(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase();
  return Object.entries(headers).find(([key]) => key.toLowerCase() === target)?.[1];
}

function retryAfterMilliseconds(value: string | undefined): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt) ? null : Math.max(0, retryAt - Date.now());
}

function updateOriginRequestPolicy(
  origin: string,
  status: number,
  headers: Record<string, string>
): void {
  const schedule = originRequestSchedules.get(origin);
  if (!schedule) return;

  const policy = responseHeader(headers, 'ratelimit-policy')?.split(',')[0];
  const quota = Number(policy?.match(/(?:^|;)q=(\d+)/i)?.[1]);
  const windowSeconds = Number(policy?.match(/(?:^|;)w=(\d+)/i)?.[1]);
  if (quota > 0 && windowSeconds > 0) {
    schedule.minimumIntervalMs = Math.ceil((windowSeconds * 1_000) / quota);
    schedule.nextStartAt = Math.max(
      schedule.nextStartAt,
      Date.now() + schedule.minimumIntervalMs
    );
  }

  if (status === 429) {
    const retryDelay = retryAfterMilliseconds(responseHeader(headers, 'retry-after'));
    if (retryDelay != null) {
      schedule.nextStartAt = Math.max(schedule.nextStartAt, Date.now() + retryDelay);
    }
  }
}

async function withOriginRequest<T>(origin: string, request: () => Promise<T>): Promise<T> {
  const release = await acquireOriginRequest(origin);
  try {
    return await request();
  } finally {
    release();
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const OPERATIONS = new Set([
  'path',
  'coalesce',
  'concat',
  'lowercase',
  'uppercase',
  'number',
  'string',
  'array',
  'split',
  'join',
  'encode',
  'add',
  'multiply',
  'equals',
  'lessThan',
  'in',
  'and',
  'not',
  'if',
  'length',
  'first',
  'map',
  'filter',
  'find',
  'flatten',
  'slice',
  'sortByOrder',
  'distinct',
  'compact',
  'get',
  'lookup',
  'trim',
  'basename',
  'fileStem',
  'fileExtension',
  'percent',
  'max',
  'endsWith',
  'sizeBytes',
  'absoluteUrl',
]);

type WorkflowContext = Record<string, unknown>;
type EvaluationState = { nodes: number; maxNodes?: number; maxItems?: number };

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeKey(key: string): boolean {
  return key !== '__proto__' && key !== 'prototype' && key !== 'constructor';
}

function pathValue(context: WorkflowContext, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!safeKey(segment)) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      return current[Number(segment)];
    }
    const currentRecord = record(current);
    return currentRecord?.[segment];
  }, context);
}

function nestedPathValue(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!safeKey(segment)) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      return current[Number(segment)];
    }
    return record(current)?.[segment];
  }, value);
}

function basename(value: unknown): string {
  let decoded = String(value ?? '');
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Document-provider paths may contain malformed escapes; the opaque text
    // remains useful for matching its final path segment.
  }
  return decoded.replaceAll('\\', '/').split(/[/?#]/).filter(Boolean).pop()?.trim() ?? '';
}

function expressionValues(
  expression: Record<string, unknown>,
  context: WorkflowContext,
  state: EvaluationState,
  depth: number
): unknown[] {
  if (!Array.isArray(expression.values)) return [];
  return expression.values.map((value) => evaluate(value, context, state, depth + 1));
}

function parseSizeBytes(value: unknown): number | undefined {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const match = String(value ?? '').trim().match(/^([\d.]+)\s*(b|kb|mb|gb)$/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const power = ['b', 'kb', 'mb', 'gb'].indexOf((match[2] ?? '').toLowerCase());
  return Number.isFinite(amount) && power >= 0
    ? Math.round(amount * 1024 ** power)
    : undefined;
}

function evaluate(
  expression: unknown,
  context: WorkflowContext,
  state: EvaluationState = { nodes: 0 },
  depth = 0
): unknown {
  state.nodes += 1;
  if (state.nodes > (state.maxNodes ?? MAX_EVALUATION_NODES) || depth > MAX_EXPRESSION_DEPTH) {
    throw new Error('Declarative workflow expression exceeds its complexity limit.');
  }
  if (
    expression == null ||
    typeof expression === 'string' ||
    typeof expression === 'number' ||
    typeof expression === 'boolean'
  ) {
    return expression;
  }
  if (Array.isArray(expression)) {
    return expression.map((value) => evaluate(value, context, state, depth + 1));
  }
  const value = record(expression);
  if (!value) throw new Error('Declarative workflow expressions must contain JSON values.');
  if (typeof value.$op !== 'string') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        if (!safeKey(key)) throw new Error(`Declarative workflow contains unsafe key "${key}".`);
        return [key, evaluate(entry, context, state, depth + 1)];
      })
    );
  }
  if (!OPERATIONS.has(value.$op)) {
    throw new Error(`Declarative workflow operation "${value.$op}" is not supported.`);
  }

  const nested = (entry: unknown) => evaluate(entry, context, state, depth + 1);
  if (value.$op === 'path') {
    if (typeof value.path !== 'string') throw new Error('Path expressions require a path.');
    const result = pathValue(context, value.path);
    return result === undefined && 'default' in value ? nested(value.default) : result;
  }
  if (value.$op === 'coalesce') {
    return expressionValues(value, context, state, depth).find(
      (entry) => entry !== undefined && entry !== null && entry !== ''
    );
  }
  if (value.$op === 'concat') {
    return expressionValues(value, context, state, depth)
      .filter((entry) => entry !== undefined && entry !== null)
      .map(String)
      .join('');
  }
  if (value.$op === 'lowercase' || value.$op === 'uppercase') {
    const result = nested(value.value);
    if (result == null) return undefined;
    return value.$op === 'lowercase'
      ? String(result).toLowerCase()
      : String(result).toUpperCase();
  }
  if (value.$op === 'number') {
    const result = Number(nested(value.value));
    return Number.isFinite(result) ? result : undefined;
  }
  if (value.$op === 'string') {
    const result = nested(value.value);
    return result == null ? undefined : String(result);
  }
  if (value.$op === 'array') {
    const result = nested(value.value);
    return result == null ? [] : Array.isArray(result) ? result : [result];
  }
  if (value.$op === 'split') {
    const result = nested(value.value);
    const separator = typeof value.separator === 'string' ? value.separator : '';
    const parts = String(result ?? '').split(separator);
    return typeof value.index === 'number' ? parts.at(value.index) : parts;
  }
  if (value.$op === 'join') {
    const result = nested(value.value);
    const separator = typeof value.separator === 'string' ? value.separator : '';
    return Array.isArray(result) ? result.join(separator) : '';
  }
  if (value.$op === 'encode') {
    return encodeURIComponent(String(nested(value.value) ?? ''));
  }
  if (value.$op === 'add') {
    return expressionValues(value, context, state, depth).reduce<number>(
      (total, entry) => total + (Number(entry) || 0),
      0
    );
  }
  if (value.$op === 'multiply') {
    const values = expressionValues(value, context, state, depth);
    const numbers = values.map(Number);
    return values.some((entry) => entry == null || entry === '') ||
      numbers.some((entry) => !Number.isFinite(entry))
      ? undefined
      : numbers.reduce((total, entry) => total * entry, 1);
  }
  if (value.$op === 'equals') {
    const values = expressionValues(value, context, state, depth);
    return values.length >= 2 && values.every((entry) => entry === values[0]);
  }
  if (value.$op === 'lessThan') {
    const values = expressionValues(value, context, state, depth);
    return values.length >= 2 && Number(values[0]) < Number(values[1]);
  }
  if (value.$op === 'in') {
    const values = expressionValues(value, context, state, depth);
    return values.length >= 2 && Array.isArray(values[1]) && values[1].includes(values[0]);
  }
  if (value.$op === 'and') {
    return expressionValues(value, context, state, depth).every(Boolean);
  }
  if (value.$op === 'not') return !nested(value.value);
  if (value.$op === 'if') {
    const values = value.values;
    if (!Array.isArray(values) || values.length < 2) {
      throw new Error('If expressions require a condition and result.');
    }
    return Boolean(nested(values[0]))
      ? nested(values[1])
      : values.length > 2
        ? nested(values[2])
        : undefined;
  }
  if (value.$op === 'length') {
    const result = nested(value.value);
    return Array.isArray(result) || typeof result === 'string' ? result.length : 0;
  }
  if (value.$op === 'first') {
    const result = nested(value.value);
    return Array.isArray(result) ? result[0] : undefined;
  }
  if (value.$op === 'map') {
    const result = nested(value.value);
    if (!Array.isArray(result)) return [];
    const maxItems = state.maxItems ?? MAX_MAP_ITEMS;
    if (result.length > maxItems) {
      throw new Error(`Declarative workflow cannot map more than ${maxItems} items.`);
    }
    const alias = typeof value.as === 'string' && value.as ? value.as : 'item';
    if (!safeKey(alias)) throw new Error(`Declarative workflow alias "${alias}" is unsafe.`);
    const mapper = Array.isArray(value.values) ? value.values[0] : undefined;
    return result.map((item, index) =>
      evaluate(mapper, { ...context, [alias]: item, index }, state, depth + 1)
    );
  }
  if (value.$op === 'filter' || value.$op === 'find') {
    const result = nested(value.value);
    if (!Array.isArray(result)) return value.$op === 'filter' ? [] : undefined;
    const maxItems = state.maxItems ?? MAX_MAP_ITEMS;
    if (result.length > maxItems) {
      throw new Error(`Declarative workflow cannot inspect more than ${maxItems} items.`);
    }
    const alias = typeof value.as === 'string' && value.as ? value.as : 'item';
    if (!safeKey(alias)) throw new Error(`Declarative workflow alias "${alias}" is unsafe.`);
    const predicate = Array.isArray(value.values) ? value.values[0] : undefined;
    if (value.$op === 'find') {
      return result.find((item, index) =>
        Boolean(evaluate(predicate, { ...context, [alias]: item, index }, state, depth + 1))
      );
    }
    return result.filter((item, index) =>
      Boolean(evaluate(predicate, { ...context, [alias]: item, index }, state, depth + 1))
    );
  }
  if (value.$op === 'flatten') {
    const result = nested(value.value);
    return Array.isArray(result) ? result.flat(1) : [];
  }
  if (value.$op === 'slice') {
    const result = nested(value.value);
    if (!Array.isArray(result) && typeof result !== 'string') return [];
    const values = expressionValues(value, context, state, depth);
    const start = Number(values[0] ?? 0);
    const end = values[1] == null ? undefined : Number(values[1]);
    return result.slice(
      Number.isFinite(start) ? Math.max(0, Math.trunc(start)) : 0,
      end == null || !Number.isFinite(end) ? undefined : Math.max(0, Math.trunc(end))
    );
  }
  if (value.$op === 'sortByOrder') {
    const result = nested(value.value);
    const order = expressionValues(value, context, state, depth)[0];
    if (!Array.isArray(result) || !Array.isArray(order)) return [];
    const maxItems = state.maxItems ?? MAX_MAP_ITEMS;
    if (result.length > maxItems || order.length > maxItems) {
      throw new Error(`Declarative workflow cannot sort more than ${maxItems} items.`);
    }
    const alias = typeof value.as === 'string' && value.as ? value.as : 'item';
    if (!safeKey(alias)) throw new Error(`Declarative workflow alias "${alias}" is unsafe.`);
    const positions = new Map(order.map((entry, index) => [String(entry), index]));
    return result
      .map((item, index) => ({
        item,
        index,
        position: positions.get(
          String(evaluate(value.by, { ...context, [alias]: item, index }, state, depth + 1))
        ),
      }))
      .sort(
        (left, right) =>
          (left.position ?? Number.MAX_SAFE_INTEGER) -
            (right.position ?? Number.MAX_SAFE_INTEGER) || left.index - right.index
      )
      .map(({ item }) => item);
  }
  if (value.$op === 'distinct') {
    const result = nested(value.value);
    if (!Array.isArray(result)) return [];
    const maxItems = state.maxItems ?? MAX_MAP_ITEMS;
    if (result.length > maxItems) {
      throw new Error(`Declarative workflow cannot inspect more than ${maxItems} items.`);
    }
    const alias = typeof value.as === 'string' && value.as ? value.as : 'item';
    if (!safeKey(alias)) throw new Error(`Declarative workflow alias "${alias}" is unsafe.`);
    const seen = new Set<unknown>();
    return result.filter((item, index) => {
      const key = value.by === undefined
        ? item
        : evaluate(value.by, { ...context, [alias]: item, index }, state, depth + 1);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (value.$op === 'compact') {
    const result = nested(value.value);
    if (Array.isArray(result)) {
      return result.filter((entry) => entry !== undefined && entry !== null && entry !== '');
    }
    const resultRecord = record(result);
    return resultRecord
      ? Object.fromEntries(
          Object.entries(resultRecord).filter(
            ([, entry]) => entry !== undefined && entry !== null && entry !== ''
          )
        )
      : result;
  }
  if (value.$op === 'get') {
    if (typeof value.path !== 'string') throw new Error('Get expressions require a path.');
    const result = nestedPathValue(nested(value.value), value.path);
    return result === undefined && 'default' in value ? nested(value.default) : result;
  }
  if (value.$op === 'lookup') {
    const source = record(nested(value.value));
    const key = nested(value.by);
    if (!source || typeof key !== 'string' || !safeKey(key)) return undefined;
    const result = source[key];
    return result === undefined && 'default' in value ? nested(value.default) : result;
  }
  if (value.$op === 'trim') {
    const result = nested(value.value);
    return result == null ? undefined : String(result).trim();
  }
  if (value.$op === 'basename') return basename(nested(value.value));
  if (value.$op === 'fileStem') {
    const name = basename(nested(value.value));
    return name.replace(/\.[a-z0-9]{1,8}$/i, '').replaceAll('_', ' ').trim();
  }
  if (value.$op === 'fileExtension') {
    const match = basename(nested(value.value)).match(/\.([a-z0-9]{1,8})$/i);
    return match?.[1]?.toLowerCase();
  }
  if (value.$op === 'percent') {
    const matches = [...String(nested(value.value) ?? '').matchAll(/(-?\d+(?:\.\d+)?)%/g)];
    const raw = matches.at(-1)?.[1];
    return raw == null ? undefined : Math.max(0, Math.min(100, Number(raw)));
  }
  if (value.$op === 'max') {
    const result = nested(value.value);
    const values = Array.isArray(result) ? result : [result];
    const numbers = values.map(Number).filter(Number.isFinite);
    return numbers.length ? Math.max(...numbers) : undefined;
  }
  if (value.$op === 'endsWith') {
    const values = expressionValues(value, context, state, depth);
    return values.length >= 2 && String(values[0] ?? '').endsWith(String(values[1] ?? ''));
  }
  if (value.$op === 'sizeBytes') return parseSizeBytes(nested(value.value));
  if (value.$op === 'absoluteUrl') {
    const result = nested(value.value);
    const base = nested(value.base);
    if (!result || !base) return undefined;
    const url = new URL(String(result), String(base));
    if (url.protocol !== 'https:') throw new Error('Workflow URLs must use HTTPS.');
    return url.toString();
  }
  throw new Error(`Declarative workflow operation "${value.$op}" is not supported.`);
}

function validateExpression(
  expression: unknown,
  state = { nodes: 0 },
  depth = 0
): void {
  state.nodes += 1;
  if (state.nodes > MAX_EXPRESSION_NODES || depth > MAX_EXPRESSION_DEPTH) {
    throw new Error('Declarative workflow expression exceeds its complexity limit.');
  }
  if (
    expression == null ||
    typeof expression === 'string' ||
    typeof expression === 'number' ||
    typeof expression === 'boolean'
  ) return;
  if (Array.isArray(expression)) {
    expression.forEach((entry) => validateExpression(entry, state, depth + 1));
    return;
  }
  const value = record(expression);
  if (!value) throw new Error('Declarative workflow expressions must contain JSON values.');
  if (typeof value.$op === 'string' && !OPERATIONS.has(value.$op)) {
    throw new Error(`Declarative workflow operation "${value.$op}" is not supported.`);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!safeKey(key)) throw new Error(`Declarative workflow contains unsafe key "${key}".`);
    validateExpression(entry, state, depth + 1);
  }
}

export function evaluateWorkflowExpression(
  expression: ExtensionWorkflowExpression,
  context: Record<string, unknown>,
  limits?: { maxNodes?: number; maxItems?: number }
): unknown {
  return evaluate(expression, context, { nodes: 0, ...limits });
}

export function validateWorkflowExpression(expression: ExtensionWorkflowExpression): void {
  validateExpression(expression);
}

function validateRequest(request: unknown, label: string): ExtensionWorkflowRequest {
  const value = record(request);
  if (!value || value.urls === undefined) {
    throw new Error(`${label} must declare request URLs.`);
  }
  validateExpression(value.urls);
  for (const key of ['headers', 'query', 'form'] as const) {
    const entries = value[key];
    if (entries == null) continue;
    const entriesRecord = record(entries);
    if (!entriesRecord) throw new Error(`${label}.${key} must be an object.`);
    Object.values(entriesRecord).forEach((entry) => validateExpression(entry));
  }
  if (value.json !== undefined) validateExpression(value.json);
  if (value.form != null && value.json != null) {
    throw new Error(`${label} cannot declare both form and JSON bodies.`);
  }
  if (value.method != null && !['GET', 'POST', 'HEAD'].includes(String(value.method))) {
    throw new Error(`${label} declares an unsupported HTTP method.`);
  }
  if (value.response != null && value.response !== 'json' && value.response !== 'text') {
    throw new Error(`${label} declares an unsupported response type.`);
  }
  if (
    value.timeoutMs != null &&
    (typeof value.timeoutMs !== 'number' || value.timeoutMs < 250 || value.timeoutMs > 20_000)
  ) {
    throw new Error(`${label}.timeoutMs must be between 250 and 20000.`);
  }
  return value as unknown as ExtensionWorkflowRequest;
}

function validateResource(value: unknown, name: string): ExtensionWorkflowResource {
  const resource = record(value);
  if (!resource || !Array.isArray(resource.steps) || !resource.steps.length) {
    throw new Error(`Declarative ${name} workflow must declare request steps.`);
  }
  if (resource.steps.length > MAX_REQUEST_STEPS) {
    throw new Error(`Declarative ${name} workflow exceeds the request step limit.`);
  }
  const ids = new Set<string>();
  const steps = resource.steps.map((candidate, index) => {
    const step = record(candidate);
    if (!step || typeof step.id !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(step.id)) {
      throw new Error(`Declarative ${name} step ${index} has an invalid id.`);
    }
    if (ids.has(step.id)) throw new Error(`Declarative ${name} step id "${step.id}" is duplicated.`);
    ids.add(step.id);
    const request = validateRequest(step.request, `Declarative ${name} step "${step.id}"`);
    if (step.when !== undefined) validateExpression(step.when);
    if (step.accept !== undefined) validateExpression(step.accept);
    if (step.authenticated != null && typeof step.authenticated !== 'boolean') {
      throw new Error(`Declarative ${name} step authentication flag must be boolean.`);
    }
    if (step.authenticated && !['GET', 'HEAD'].includes(request.method ?? 'GET')) {
      throw new Error('Session renewal can only replay GET and HEAD requests.');
    }
    return {
      id: step.id,
      request,
      ...(step.authenticated ? { authenticated: true } : {}),
      ...(step.when !== undefined
        ? { when: step.when as ExtensionWorkflowExpression }
        : {}),
      ...(step.accept !== undefined
        ? { accept: step.accept as ExtensionWorkflowExpression }
        : {}),
    };
  });
  if (resource.output === undefined) {
    throw new Error(`Declarative ${name} workflow must declare output.`);
  }
  validateExpression(resource.output);
  let session: ExtensionWorkflowResource['session'];
  if (resource.session != null) {
    const value = record(resource.session);
    if (!value || !Array.isArray(value.steps) || !value.steps.length ||
        value.steps.some((id) => typeof id !== 'string' || !ids.has(id)) ||
        new Set(value.steps).size !== value.steps.length) {
      throw new Error('Session must reference existing login steps.');
    }
    const loginIds = value.steps as string[];
    const start = steps.findIndex((step) => step.id === loginIds[0]);
    if (loginIds.some((id, index) => steps[start + index]?.id !== id) ||
        steps.slice(start, start + loginIds.length).some((step) => step.authenticated)) {
      throw new Error('Session login steps must be contiguous and cannot use an existing session.');
    }
    if (steps.slice(0, start + loginIds.length).some((step) => step.authenticated)) {
      throw new Error('Authenticated reads must follow the session login steps.');
    }
    const validateSessionPaths = (expression: unknown): void => {
      if (Array.isArray(expression)) { expression.forEach(validateSessionPaths); return; }
      const node = record(expression);
      if (!node) return;
      if (node.$op === 'path' && typeof node.path === 'string') {
        const [root, step] = node.path.split('.');
        if (root !== 'config' && !(root === 'steps' && loginIds.includes(step))) {
          throw new Error('Session login requests may only read configuration and login step results.');
        }
      }
      Object.values(node).forEach(validateSessionPaths);
    };
    steps.slice(start, start + loginIds.length).forEach((step) => validateSessionPaths(step.request));
    if (value.output === undefined) throw new Error('Session must declare saved step output.');
    validateExpression(value.output);
    validateSessionPaths(value.output);
    if (value.expiresAt !== undefined) validateExpression(value.expiresAt);
    if (value.expiresAt !== undefined) validateSessionPaths(value.expiresAt);
    if (value.expiresIn !== undefined) {
      if (value.expiresAt !== undefined) throw new Error('Session must use either expiresAt or expiresIn.');
      validateExpression(value.expiresIn);
      validateSessionPaths(value.expiresIn);
    }
    let validate: NonNullable<typeof session>['validate'];
    if (value.validate != null) {
      const check = record(value.validate);
      if (!check || check.accept === undefined || check.invalidWhen === undefined) {
        throw new Error('Session validation must declare accept and invalidWhen expressions.');
      }
      const request = validateRequest(check.request, 'Session validation');
      if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) throw new Error('Session validation must be read-only.');
      validateExpression(check.accept);
      validateExpression(check.invalidWhen);
      validate = { request, accept: check.accept as ExtensionWorkflowExpression, invalidWhen: check.invalidWhen as ExtensionWorkflowExpression };
    }
    session = {
      steps: value.steps as string[], output: value.output as ExtensionWorkflowExpression,
      ...(value.expiresAt !== undefined ? { expiresAt: value.expiresAt as ExtensionWorkflowExpression } : {}),
      ...(value.expiresIn !== undefined ? { expiresIn: value.expiresIn as ExtensionWorkflowExpression } : {}),
      ...(validate ? { validate } : {}),
    };
  }
  if (!session && steps.some((step) => step.authenticated)) throw new Error('Authenticated steps require a session declaration.');
  return { steps, output: resource.output as ExtensionWorkflowExpression, ...(session ? { session } : {}) };
}

export function parseWorkflowDefinition(
  input: unknown,
  manifest: ExtensionManifest
): ExtensionWorkflowDefinition {
  const value = record(input);
  if (!value || value.workflowVersion !== 1) {
    throw new Error('Declarative workflow must use workflowVersion 1.');
  }
  const resources = record(value.resources);
  if (!resources) throw new Error('Declarative workflow must declare resources.');
  const parsed: ExtensionWorkflowDefinition['resources'] = {};
  for (const resource of manifest.resources) {
    const workflow = resources[resource.name];
    if (!workflow) {
      throw new Error(`Declarative workflow does not implement ${resource.name}.`);
    }
    parsed[resource.name] = validateResource(workflow, resource.name);
  }
  return { workflowVersion: 1, resources: parsed };
}

export async function fetchWorkflowDefinition(
  manifest: ExtensionManifest,
  fetchFn: typeof fetch
): Promise<ExtensionWorkflowDefinition> {
  if (
    manifest.transport.kind !== 'declarative' ||
    !('definitionUrl' in manifest.transport)
  ) {
    throw new Error(`Extension "${manifest.id}" has no declarative workflow URL.`);
  }
  const url = new URL(manifest.transport.definitionUrl);
  if (!allowedOrigin(manifest, url)) {
    throw new Error(`Declarative workflow definition uses undeclared origin ${url.origin}.`);
  }
  const response = await fetchFn(url.toString(), {
    headers: { Accept: 'application/json' },
    redirect: 'error',
  });
  if (!response.ok) {
    throw new Error(`Declarative workflow request failed (${response.status}) for ${url}.`);
  }
  const value = await readResponse(response, 'json');
  return parseWorkflowDefinition(value, manifest);
}

function allowedOrigin(manifest: ExtensionManifest, url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    !!manifest.permissions?.hosts?.some((host) => new URL(host).origin === url.origin)
  );
}

function evaluatedRecord(
  input: Record<string, ExtensionWorkflowExpression> | undefined,
  context: WorkflowContext
): Record<string, string> {
  if (!input) return {};
  return Object.fromEntries(
    Object.entries(input).flatMap(([key, expression]) => {
      if (!safeKey(key)) throw new Error(`Declarative request contains unsafe key "${key}".`);
      const value = evaluate(expression, context);
      return value === undefined || value === null ? [] : [[key, String(value)]];
    })
  );
}

function requestUrls(expression: ExtensionWorkflowExpression, context: WorkflowContext): string[] {
  const evaluated = evaluate(expression, context);
  const values = Array.isArray(evaluated) ? evaluated : [evaluated];
  const urls = values.filter((value): value is string => typeof value === 'string' && !!value);
  if (!urls.length) throw new Error('Declarative request did not produce an HTTPS URL.');
  if (urls.length > MAX_REQUEST_URLS) {
    throw new Error(`Declarative request cannot try more than ${MAX_REQUEST_URLS} URLs.`);
  }
  return urls;
}

async function readResponse(response: Response, type: 'json' | 'text'): Promise<unknown> {
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error('Declarative response exceeds the 5 MB limit.');
  }
  if (type === 'text') return text;
  try {
    return JSON.parse(text.replace(/^\uFEFF/, '')) as unknown;
  } catch (cause) {
    throw new Error(
      `Declarative response is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`
    );
  }
}

function rejectedResponseMessage(result: Record<string, unknown>): string {
  const status = Number(result.status);
  const responseBody = record(result.body);
  const providerError = responseBody?.error;
  const graphQLError = Array.isArray(responseBody?.errors)
    ? record(responseBody.errors[0])?.message
    : undefined;
  const operationError =
    nestedPathValue(responseBody, 'data.search.error') ??
    nestedPathValue(responseBody, 'data.books_trending.error');
  const providerMessage =
    typeof providerError === 'string'
      ? providerError.trim()
      : typeof record(providerError)?.message === 'string'
        ? String(record(providerError)?.message).trim()
        : typeof graphQLError === 'string'
          ? graphQLError.trim()
          : typeof operationError === 'string'
            ? operationError.trim()
            : '';
  return providerMessage
    ? `HTTP ${status}: ${providerMessage.slice(0, 300)}`
    : `HTTP ${status} did not satisfy the workflow`;
}

async function executeRequest(
  request: ExtensionWorkflowRequest,
  accept: ExtensionWorkflowExpression | undefined,
  context: WorkflowContext,
  manifest: ExtensionManifest,
  fetchFn: typeof fetch,
  attempts: { count: number },
  authenticated = false,
): Promise<Record<string, unknown>> {
  const failures: string[] = [];
  for (const candidate of requestUrls(request.urls, context)) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      failures.push(`${candidate}: invalid URL`);
      continue;
    }
    if (!allowedOrigin(manifest, url)) {
      throw new Error(`Declarative workflow attempted undeclared origin ${url.origin}.`);
    }
    const query = evaluatedRecord(request.query, context);
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
    const headers = evaluatedRecord(request.headers, context);
    for (const name of Object.keys(headers)) {
      if (['host', 'origin', 'content-length', 'x-tomeio-config'].includes(name.toLowerCase())) {
        throw new Error(`Declarative workflows cannot set the ${name} header.`);
      }
    }
    let body: string | undefined;
    let evaluatedJson: unknown;
    if (request.form) {
      body = new URLSearchParams(evaluatedRecord(request.form, context)).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    } else if (request.json !== undefined) {
      evaluatedJson = evaluate(request.json, context);
      body = JSON.stringify(evaluatedJson);
      headers['Content-Type'] = 'application/json';
    }
    const method = request.method ?? 'GET';
    const graphqlOperation = record(evaluatedJson)?.query;
    const retryableGraphqlQuery =
      method === 'POST' &&
      typeof graphqlOperation === 'string' &&
      /^\s*(?:query\b|\{)/i.test(graphqlOperation);
    const requestAttempts = method === 'GET' || method === 'HEAD' || retryableGraphqlQuery
      ? MAX_TRANSIENT_REQUEST_ATTEMPTS
      : 1;
    for (let attempt = 0; attempt < requestAttempts; attempt += 1) {
      attempts.count += 1;
      if (attempts.count > MAX_REQUEST_ATTEMPTS) {
        throw new Error('Declarative workflow exceeded its request attempt limit.');
      }
      try {
        const result = await withOriginRequest(url.origin, async () => {
          const controller = new AbortController();
          const timeout = setTimeout(
            () => controller.abort(),
            request.timeoutMs ?? DEFAULT_TIMEOUT_MS
          );
          try {
            const response = await fetchFn(url.toString(), {
              method,
              headers,
              ...(body !== undefined ? { body } : {}),
              redirect: 'error',
              signal: controller.signal,
            });
            const responseHeaders = Object.fromEntries(response.headers.entries());
            updateOriginRequestPolicy(url.origin, response.status, responseHeaders);
            if (authenticated && response.status === 401) throw new SessionRejectedError();
            return {
              status: response.status,
              ok: response.ok,
              url: url.toString(),
              origin: url.origin,
              headers: responseHeaders,
              body: await readResponse(response, request.response ?? 'json'),
            };
          } finally {
            clearTimeout(timeout);
          }
        });
        const accepted = accept
          ? Boolean(evaluate(accept, { ...context, response: result }))
          : result.ok;
        if (accepted) return result;
        const transient = result.status === 429 || (result.status >= 500 && result.status <= 599);
        if (transient && attempt + 1 < requestAttempts) {
          await wait(250 * (attempt + 1));
          continue;
        }
        failures.push(`${url.origin}: ${rejectedResponseMessage(result)}`);
        break;
      } catch (cause) {
        if (cause instanceof SessionRejectedError) throw cause;
        if (attempt + 1 < requestAttempts) {
          await wait(250 * (attempt + 1));
          continue;
        }
        failures.push(`${url.origin}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
  }
  throw new Error(`Every declarative request candidate failed. ${failures.slice(0, 3).join(' | ')}`);
}

async function executeResource(
  resource: ExtensionWorkflowResource,
  input: unknown,
  configuration: Record<string, ExtensionConfigValue>,
  manifest: ExtensionManifest,
  fetchFn: typeof fetch,
  sessions: ExtensionSessionManager,
): Promise<unknown> {
  let context: WorkflowContext = { input, config: configuration, steps: {} };
  const attempts = { count: 0 };
  const sessionDefinition = resource.session;
  let session: ExtensionSession | undefined;
  let access: ExtensionSessionAccess | undefined;
  const loginSteps = sessionDefinition
    ? resource.steps.filter((step) => sessionDefinition.steps.includes(step.id)) : [];
  const createSession = async (): Promise<ExtensionSession> => {
    let loginContext = { ...context, steps: { ...(record(context.steps) ?? {}) } };
    for (const step of loginSteps) delete loginContext.steps[step.id];
    for (const step of loginSteps) {
      if (step.when !== undefined && !evaluate(step.when, loginContext)) throw new Error('Required session login step was skipped.');
      loginContext.steps[step.id] = await executeRequest(step.request, step.accept, loginContext, manifest, fetchFn, attempts);
    }
    const saved = record(evaluate(sessionDefinition!.output, loginContext));
    if (!saved || !Object.keys(saved).length || Object.keys(saved).some((id) => !sessionDefinition!.steps.includes(id))) {
      throw new Error('Session output must contain only declared login step results.');
    }
    const expiresAt = sessionDefinition!.expiresAt !== undefined
      ? Number(evaluate(sessionDefinition!.expiresAt, loginContext))
      : sessionDefinition!.expiresIn !== undefined
        ? Date.now() + Number(evaluate(sessionDefinition!.expiresIn, loginContext)) * 1000
        : undefined;
    return { steps: saved, ...(expiresAt !== undefined ? { expiresAt } : {}) };
  };
  const validateSession = sessionDefinition?.validate ? async (saved: ExtensionSession): Promise<boolean> => {
    const check = sessionDefinition.validate!;
    const checkContext = { ...context, steps: { ...(record(context.steps) ?? {}), ...saved.steps } };
    // The validation expression distinguishes expired sessions from service errors.
    const response = await executeRequest(check.request, true, checkContext, manifest, fetchFn, attempts);
    if (evaluate(check.accept, { ...checkContext, response })) return true;
    if (evaluate(check.invalidWhen, { ...checkContext, response })) return false;
    throw new Error(`Session validation failed (HTTP ${response.status}).`);
  } : undefined;
  let renewed = false;
  for (let index = 0; index < resource.steps.length; index++) {
    const step = resource.steps[index];
    if (step.when !== undefined && !Boolean(evaluate(step.when, context))) {
      context = {
        ...context,
        steps: {
          ...(record(context.steps) ?? {}),
          [step.id]: { skipped: true },
        },
      };
      continue;
    }
    if (sessionDefinition && step.id === sessionDefinition.steps[0]) {
      // Do not include per-resource login guards in the shared account scope.
      const scope = JSON.stringify([manifest, configuration, loginSteps.map(({ id, request, accept }) => ({ id, request, accept })), sessionDefinition]);
      access = sessions.bind(manifest.id, scope);
      session = await access.get(createSession, validateSession);
      context = { ...context, steps: { ...(record(context.steps) ?? {}), ...session.steps } };
      index += loginSteps.length - 1;
      continue;
    }
    let result: Record<string, unknown>;
    if (step.authenticated && (!session || !access)) throw new Error('Authenticated read requires an active session.');
    try {
      result = await executeRequest(step.request, step.accept, context, manifest, fetchFn, attempts, step.authenticated);
    } catch (cause) {
      if (!(cause instanceof SessionRejectedError) || !access || !session) throw cause;
      await access.invalidate(session);
      if (renewed) throw cause;
      renewed = true;
      session = await access.get(createSession, validateSession);
      context = { ...context, steps: { ...(record(context.steps) ?? {}), ...session.steps } };
      try {
        result = await executeRequest(step.request, step.accept, context, manifest, fetchFn, attempts, true);
      } catch (retryCause) {
        if (retryCause instanceof SessionRejectedError) await access.invalidate(session);
        throw retryCause;
      }
    }
    context = {
      ...context,
      steps: { ...(record(context.steps) ?? {}), [step.id]: result },
    };
  }
  return evaluate(resource.output, context);
}

export function createDeclarativeWorkflowExtension(
  manifest: ExtensionManifest,
  definition: ExtensionWorkflowDefinition,
  fetchFn: typeof fetch,
  configuration: Record<string, ExtensionConfigValue>,
  sessions = new ExtensionSessionManager(),
): BookExtension {
  const run = (resource: ExtensionResourceName, input: unknown) => {
    const workflow = definition.resources[resource];
    if (!workflow) throw new Error(`Declarative workflow does not implement ${resource}.`);
    return executeResource(workflow, input, configuration, manifest, fetchFn, sessions);
  };
  const has = (resource: ExtensionResourceName) =>
    manifest.resources.some((candidate) => candidate.name === resource);
  return {
    manifest,
    ...(has('catalog')
      ? { catalog: (query) => run('catalog', query).then(parseExtensionPage) }
      : {}),
    ...(has('search')
      ? { search: (query) => run('search', query).then(parseExtensionPage) }
      : {}),
    ...(has('meta')
      ? {
          meta: (id: string) =>
            run('meta', { id }).then((value) =>
              value == null ? null : parseBookMetadata(value)
            ),
        }
      : {}),
    ...(has('resolve')
      ? { resolve: (query) => run('resolve', query).then(parseExtensionPage) }
      : {}),
    ...(has('reviews')
      ? { reviews: (query) => run('reviews', query).then(parseExtensionReviewPage) }
      : {}),
    ...(has('acquisition')
      ? {
          acquisition: (id: string) =>
            run('acquisition', { id }).then((value) => {
              if (!Array.isArray(value)) throw new Error('Acquisition output must be an array.');
              return value.map(parseBookAcquisition);
            }),
        }
      : {}),
    ...(has('libraryAction')
      ? {
          libraryAction: (request) =>
            run('libraryAction', request).then(parseExtensionLibraryActionResult),
        }
      : {}),
    ...(has('reader')
      ? {
          readerSync: (request) =>
            run('reader', request).then((value) => value as ExtensionReaderSyncResult),
        }
      : {}),
  };
}
