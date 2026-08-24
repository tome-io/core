import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import type {
  BookExtension,
  ExtensionManifest,
  ExtensionQuery,
} from '@readoi/extension-protocol';
import type { ScriptExtensionExecutor } from '@readoi/extension-runtime';

import { readExtensionConfiguration } from './extension-configuration';
import { secureDelete, secureGet, secureSet } from './secure';

const MAX_BUNDLE_BYTES = 1_000_000;
const MAX_RESPONSE_BYTES = 5_000_000;
const CALL_TIMEOUT_MS = 30_000;
const BUNDLE_CACHE_PREFIX = 'extension_bundle_v1';
const EXTENSION_STORE_PREFIX = 'extension_store_v1';
const EXTENSION_SECURE_PREFIX = 'extension_secure_v1';
const EXTENSION_SECURE_INDEX_PREFIX = 'extension_secure_index_v1';

interface SandboxMessage {
  type: 'ready' | 'result' | 'host-call' | 'boot-error';
  requestId?: string;
  method?: string;
  args?: unknown[];
  value?: unknown;
  error?: string;
}

interface PendingCall {
  message: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface SandboxSession {
  manifest: ExtensionManifest;
  bundle: string;
  send?: (message: string) => void;
  ready: boolean;
  pending: Map<string, PendingCall>;
}

function json(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function allowedOrigin(manifest: ExtensionManifest, url: URL): boolean {
  return (manifest.permissions?.hosts ?? []).some(
    (allowed) => new URL(allowed).origin === url.origin
  );
}

function scopedKey(prefix: string, extensionId: string, key: string): string {
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(key)) {
    throw new Error('Extension storage keys may contain only letters, numbers, dots, dashes, and underscores.');
  }
  return `${prefix}:${extensionId}:${key}`;
}

export function createSandboxHtml(
  manifest: ExtensionManifest,
  bundle: string,
  bridge: 'native' | 'web' = 'native'
): string {
  const entrypoint = manifest.transport.kind === 'script'
    ? manifest.transport.entrypoint ?? 'readoExtension'
    : 'readoExtension';
  const nonce = manifest.transport.kind === 'script' ? manifest.transport.sha256.slice(0, 24) : '';
  const postMessage = (expression: string) =>
    bridge === 'web'
      ? `window.parent.postMessage(JSON.stringify(${expression}), '*')`
      : `window.ReactNativeWebView.postMessage(JSON.stringify(${expression}))`;
  const bootstrap = `
    (() => {
      const pending = new Map();
      let nextRequestId = 1;
      const send = (message) => ${postMessage('message')};
      const hostCall = (method, ...args) => new Promise((resolve, reject) => {
        const requestId = 'host-' + nextRequestId++;
        pending.set(requestId, { resolve, reject });
        send({ type: 'host-call', requestId, method, args });
      });
      Object.defineProperty(globalThis, 'reado', {
        configurable: false,
        writable: false,
        value: Object.freeze({
          fetch: (url, options) => hostCall('fetch', url, options),
          config: Object.freeze({ get: (key) => hostCall('config.get', key) }),
          store: Object.freeze({
            get: (key) => hostCall('store.get', key),
            set: (key, value) => hostCall('store.set', key, value),
            remove: (key) => hostCall('store.remove', key),
          }),
          secureStore: Object.freeze({
            get: (key) => hostCall('secure.get', key),
            set: (key, value) => hostCall('secure.set', key, value),
            remove: (key) => hostCall('secure.remove', key),
          }),
        }),
      });
      globalThis.__readoReceive = async (message) => {
        if (message.type === 'host-result') {
          const request = pending.get(message.requestId);
          if (!request) return;
          pending.delete(message.requestId);
          if (message.error) request.reject(new Error(message.error));
          else request.resolve(message.value);
          return;
        }
        if (message.type !== 'call') return;
        try {
          const extension = globalThis[${json(entrypoint)}];
          const operation = extension && extension[message.method];
          if (typeof operation !== 'function') throw new Error('Extension does not implement ' + message.method + '.');
          const value = await operation(...(message.args || []));
          send({ type: 'result', requestId: message.requestId, value });
        } catch (error) {
          send({ type: 'result', requestId: message.requestId, error: error instanceof Error ? error.message : String(error) });
        }
      };
      ${bridge === 'web' ? "window.addEventListener('message', (event) => globalThis.__readoReceive(event.data));" : ''}
    })();
  `;
  const ready = `
    try {
      if (!globalThis[${json(entrypoint)}] || typeof globalThis[${json(entrypoint)}] !== 'object') {
        throw new Error('Extension bundle did not register globalThis.${entrypoint}.');
      }
      ${postMessage("{ type: 'ready' }")};
    } catch (error) {
      ${postMessage("{ type: 'boot-error', error: error instanceof Error ? error.message : String(error) }")};
    }
  `;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; img-src 'none'; style-src 'none'; script-src 'nonce-${nonce}'"></head><body><script nonce="${nonce}">${bootstrap}</script><script nonce="${nonce}">${bundle.replaceAll('</script', '<\\/script')}</script><script nonce="${nonce}">${ready}</script></body></html>`;
}

export class MobileScriptExtensionExecutor implements ScriptExtensionExecutor {
  private readonly sessions = new Map<string, SandboxSession>();
  private readonly listeners = new Set<() => void>();
  private requestSequence = 1;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): SandboxSession[] {
    return [...this.sessions.values()];
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  private async downloadBundle(manifest: ExtensionManifest): Promise<string> {
    if (manifest.transport.kind !== 'script') {
      throw new Error(`Extension "${manifest.id}" is not a script extension.`);
    }
    const cacheKey = `${BUNDLE_CACHE_PREFIX}:${manifest.id}:${manifest.transport.sha256}`;
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      const cachedDigest = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        cached
      );
      if (cachedDigest.toLowerCase() === manifest.transport.sha256) return cached;
      await AsyncStorage.removeItem(cacheKey);
    }

    const response = await fetch(manifest.transport.bundleUrl, {
      headers: { Accept: 'application/javascript, text/javascript;q=0.9' },
    });
    if (!response.ok) {
      throw new Error(
        `Extension bundle request failed (${response.status}) for ${manifest.transport.bundleUrl}.`
      );
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BUNDLE_BYTES) {
      throw new Error(`Extension bundle exceeds the ${MAX_BUNDLE_BYTES} byte limit.`);
    }
    const bundle = await response.text();
    if (new TextEncoder().encode(bundle).byteLength > MAX_BUNDLE_BYTES) {
      throw new Error(`Extension bundle exceeds the ${MAX_BUNDLE_BYTES} byte limit.`);
    }
    const digest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      bundle
    );
    if (digest.toLowerCase() !== manifest.transport.sha256) {
      throw new Error(
        `Extension bundle integrity check failed for "${manifest.name}". Expected ${manifest.transport.sha256}, received ${digest.toLowerCase()}.`
      );
    }
    await AsyncStorage.setItem(cacheKey, bundle);
    return bundle;
  }

  async load(manifest: ExtensionManifest): Promise<BookExtension> {
    if (manifest.transport.kind !== 'script') {
      throw new Error(`Extension "${manifest.id}" does not use a script transport.`);
    }
    const current = this.sessions.get(manifest.id);
    if (!current || current.manifest.transport.kind !== 'script' || current.manifest.transport.sha256 !== manifest.transport.sha256) {
      const bundle = await this.downloadBundle(manifest);
      this.sessions.set(manifest.id, {
        manifest,
        bundle,
        ready: false,
        pending: new Map(),
      });
      this.changed();
    }

    const invoke = <T>(method: string, args: unknown[]) => this.call<T>(manifest.id, method, args);
    const has = (name: 'catalog' | 'search' | 'meta' | 'acquisition') =>
      manifest.resources.some((resource) => resource.name === name);
    return {
      manifest,
      ...(has('catalog') ? { catalog: (query: ExtensionQuery) => invoke('catalog', [query]) } : {}),
      ...(has('search') ? { search: (query: ExtensionQuery) => invoke('search', [query]) } : {}),
      ...(has('meta') ? { meta: (id: string) => invoke('meta', [id]) } : {}),
      ...(has('acquisition')
        ? { acquisition: (id: string) => invoke('acquisition', [id]) }
        : {}),
    };
  }

  attach(id: string, send: (message: string) => void): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.send = send;
    if (session.ready) this.flush(session);
  }

  detach(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.send = undefined;
    session.ready = false;
  }

  async receive(id: string, serialized: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    let message: SandboxMessage;
    try {
      message = JSON.parse(serialized) as SandboxMessage;
    } catch {
      return;
    }
    if (message.type === 'ready') {
      session.ready = true;
      this.flush(session);
      return;
    }
    if (message.type === 'boot-error') {
      this.rejectPending(session, new Error(message.error || 'Extension failed to start.'));
      return;
    }
    if (message.type === 'result' && message.requestId) {
      const pending = session.pending.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      session.pending.delete(message.requestId);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.value);
      return;
    }
    if (message.type === 'host-call' && message.requestId && message.method) {
      try {
        const value = await this.hostCall(session.manifest, message.method, message.args ?? []);
        session.send?.(json({ type: 'host-result', requestId: message.requestId, value }));
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause);
        session.send?.(json({ type: 'host-result', requestId: message.requestId, error }));
      }
    }
  }

  invalidate(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.rejectPending(session, new Error('Extension sandbox was reloaded.'));
    this.sessions.delete(id);
    this.changed();
  }

  async purge(id: string): Promise<void> {
    this.invalidate(id);
    const keys = await AsyncStorage.getAllKeys();
    const insecurePrefixes = [
      `${EXTENSION_STORE_PREFIX}:${id}:`,
      `${BUNDLE_CACHE_PREFIX}:${id}:`,
    ];
    const insecureKeys = keys.filter((key) =>
      insecurePrefixes.some((prefix) => key.startsWith(prefix))
    );
    if (insecureKeys.length) await AsyncStorage.multiRemove(insecureKeys);

    const secureIndexKey = `${EXTENSION_SECURE_INDEX_PREFIX}:${id}`;
    const secureIndex = await AsyncStorage.getItem(secureIndexKey);
    const secureKeys: unknown = secureIndex ? JSON.parse(secureIndex) : [];
    if (Array.isArray(secureKeys)) {
      await Promise.all(
        secureKeys
          .filter((key): key is string => typeof key === 'string')
          .map((key) => secureDelete(scopedKey(EXTENSION_SECURE_PREFIX, id, key)))
      );
    }
    await AsyncStorage.removeItem(secureIndexKey);
  }

  private call<T>(id: string, method: string, args: unknown[]): Promise<T> {
    const session = this.sessions.get(id);
    if (!session) return Promise.reject(new Error(`Extension sandbox "${id}" is not loaded.`));
    const requestId = `call-${this.requestSequence++}`;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        session.pending.delete(requestId);
        reject(new Error(`Extension "${session.manifest.name}" timed out while running ${method}.`));
      }, CALL_TIMEOUT_MS);
      session.pending.set(requestId, {
        message: json({ type: 'call', requestId, method, args }),
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });
      if (session.ready) {
        session.send?.(session.pending.get(requestId)?.message ?? '');
      }
    });
  }

  private flush(session: SandboxSession): void {
    for (const pending of session.pending.values()) {
      session.send?.(pending.message);
    }
  }

  private rejectPending(session: SandboxSession, error: Error): void {
    for (const pending of session.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    session.pending.clear();
  }

  private async hostCall(
    manifest: ExtensionManifest,
    method: string,
    args: unknown[]
  ): Promise<unknown> {
    if (method === 'config.get') {
      const key = String(args[0] ?? '');
      const field = manifest.config?.find((candidate) => candidate.key === key);
      if (!field) throw new Error(`Extension requested undeclared config field "${key}".`);
      const configuration = await readExtensionConfiguration(manifest);
      return configuration[key] ?? null;
    }
    if (method === 'fetch') {
      const url = new URL(String(args[0] ?? ''));
      if (url.protocol !== 'https:' || !allowedOrigin(manifest, url)) {
        throw new Error(`Extension is not permitted to access ${url.origin}.`);
      }
      const options = (args[1] ?? {}) as RequestInit;
      const headers = new Headers(options.headers);
      if (Platform.OS === 'web' && headers.has('cookie')) {
        headers.set('x-reado-cookie', headers.get('cookie') ?? '');
        headers.delete('cookie');
      }
      const requestUrl =
        Platform.OS === 'web'
          ? `/reado-proxy/${encodeURIComponent(url.toString())}`
          : url.toString();
      const response = await fetch(requestUrl, {
        method: options.method,
        headers,
        body: typeof options.body === 'string' ? options.body : undefined,
        redirect: 'manual',
      });
      const body = await response.text();
      if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
        throw new Error(`Extension response exceeds the ${MAX_RESPONSE_BYTES} byte limit.`);
      }
      return {
        ok: response.ok,
        status: response.status,
        url: response.url,
        headers: Object.fromEntries(response.headers.entries()),
        body,
      };
    }

    const key = String(args[0] ?? '');
    if (method.startsWith('store.')) {
      const storageKey = scopedKey(EXTENSION_STORE_PREFIX, manifest.id, key);
      if (method === 'store.get') return AsyncStorage.getItem(storageKey);
      if (method === 'store.set') {
        await AsyncStorage.setItem(storageKey, String(args[1] ?? ''));
        return null;
      }
      if (method === 'store.remove') {
        await AsyncStorage.removeItem(storageKey);
        return null;
      }
    }
    if (method.startsWith('secure.')) {
      const storageKey = scopedKey(EXTENSION_SECURE_PREFIX, manifest.id, key);
      const indexKey = `${EXTENSION_SECURE_INDEX_PREFIX}:${manifest.id}`;
      if (method === 'secure.get') return secureGet(storageKey);
      if (method === 'secure.set') {
        await secureSet(storageKey, String(args[1] ?? ''));
        const current: unknown = JSON.parse((await AsyncStorage.getItem(indexKey)) || '[]');
        const keys = Array.isArray(current)
          ? current.filter((candidate): candidate is string => typeof candidate === 'string')
          : [];
        if (!keys.includes(key)) await AsyncStorage.setItem(indexKey, JSON.stringify([...keys, key]));
        return null;
      }
      if (method === 'secure.remove') {
        await secureDelete(storageKey);
        const current: unknown = JSON.parse((await AsyncStorage.getItem(indexKey)) || '[]');
        if (Array.isArray(current)) {
          await AsyncStorage.setItem(
            indexKey,
            JSON.stringify(current.filter((candidate) => candidate !== key))
          );
        }
        return null;
      }
    }
    throw new Error(`Unsupported extension host method "${method}".`);
  }
}

export const mobileScriptExtensionExecutor = new MobileScriptExtensionExecutor();
