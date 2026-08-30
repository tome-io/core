import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { deserializeDatabaseAsync } from 'expo-sqlite';
import JSZip from 'jszip';
import { Platform } from 'react-native';

import type {
  ExtensionDeviceExecutionContext,
  ExtensionDeviceHost,
} from '@tomeio/extension-runtime';
import type { ExtensionDeviceOperation } from '@tomeio/extension-protocol';

import { listNativeDirectoryEntries } from '../../modules/expo-progress-folder/src';

const INSPECTION_BATCH_SIZE = 24;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_TEXT_BYTES = 10 * 1024 * 1024;
const MAX_SQLITE_ROWS = 20_000;
const MAX_PROVENANCE_NODES = 25_000;
const BOOK_MIME_TYPES: Record<string, string> = {
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
};

interface DeviceFile {
  uri: string;
  filename: string;
  size: number;
  modificationTime: number;
}

export async function openLocalFileInAndroidPackage(
  localFile: { uri?: string; format: string },
  packageName: string
): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('Opening a local book in a specific app is available only on Android.');
  }
  if (!localFile.uri) throw new Error('The local book URI is unavailable.');
  const contentUri = localFile.uri.startsWith('content:')
    ? localFile.uri
    : await FileSystem.getContentUriAsync(localFile.uri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    packageName,
    data: contentUri,
    type: BOOK_MIME_TYPES[localFile.format.toLowerCase()] ?? 'application/octet-stream',
    category: 'android.intent.category.DEFAULT',
    flags: 1,
  });
}

function finiteNumber(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function filenameFromUri(uri: string): string {
  let decoded = uri;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    // SAF document IDs can contain malformed escapes; keep the opaque URI.
  }
  return decoded.replaceAll('\\', '/').split(/[/?#]/).filter(Boolean).pop() ?? '';
}

function configuredDirectories(context: ExtensionDeviceExecutionContext): Set<string> {
  return new Set(
    (context.manifest.config ?? []).flatMap((field) => {
      const value = context.configuration[field.key];
      return field.type === 'directory' && typeof value === 'string' && value ? [value] : [];
    })
  );
}

function approvedLocalUris(context: ExtensionDeviceExecutionContext): Set<string> {
  const uris = new Set<string>();
  const queue: unknown[] = [context.workflow];
  let inspected = 0;
  while (queue.length) {
    const value = queue.shift();
    inspected += 1;
    if (inspected > MAX_PROVENANCE_NODES) {
      throw new Error('Device workflow URI provenance exceeds its complexity limit.');
    }
    if (Array.isArray(value)) {
      queue.push(...value);
      continue;
    }
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) continue;
    if (!value || typeof value !== 'object') continue;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (
        (key === 'uri' || key === 'sourceUri') &&
        typeof entry === 'string' &&
        (entry.startsWith('content:') || entry.startsWith('file:'))
      ) {
        uris.add(entry);
      } else {
        queue.push(entry);
      }
    }
  }
  return uris;
}

function approvedLocalUri(
  value: unknown,
  context: ExtensionDeviceExecutionContext,
  label: string
): string {
  const uri = requiredString(value, label);
  if (!approvedLocalUris(context).has(uri)) {
    throw new Error(`${label} was not supplied by Tomeio or an approved directory scan.`);
  }
  return uri;
}

async function inspectUris(uris: string[]) {
  const entries: { uri: string; info: Awaited<ReturnType<typeof FileSystem.getInfoAsync>> }[] = [];
  for (let offset = 0; offset < uris.length; offset += INSPECTION_BATCH_SIZE) {
    const batch = uris.slice(offset, offset + INSPECTION_BATCH_SIZE);
    entries.push(
      ...(await Promise.all(
        batch.map(async (uri) => ({ uri, info: await FileSystem.getInfoAsync(uri) }))
      ))
    );
  }
  return entries;
}

function matchesFile(
  filename: string,
  filenames: readonly string[],
  extensions: readonly string[]
): boolean {
  const normalized = filename.toLowerCase();
  return (
    (!filenames.length && !extensions.length) ||
    filenames.some((candidate) => candidate.toLowerCase() === normalized) ||
    extensions.some((candidate) =>
      normalized.endsWith(`.${candidate.toLowerCase().replace(/^\./, '')}`)
    )
  );
}

async function scanDirectory(
  directory: string,
  depth: number,
  maxDepth: number,
  filenames: readonly string[],
  extensions: readonly string[],
  visited: Set<string>,
  output: DeviceFile[]
): Promise<void> {
  if (visited.has(directory) || depth > maxDepth) return;
  visited.add(directory);
  const contentUris = directory.startsWith('content:');
  if (contentUris) {
    const entries = await listNativeDirectoryEntries(directory);
    for (const entry of entries) {
      if (entry.isDirectory) {
        await scanDirectory(
          entry.uri,
          depth + 1,
          maxDepth,
          filenames,
          extensions,
          visited,
          output
        );
        continue;
      }
      if (!matchesFile(entry.name, filenames, extensions)) continue;
      output.push({
        uri: entry.uri,
        filename: entry.name,
        size: finiteNumber(entry.size),
        modificationTime: finiteNumber(entry.modifiedAt),
      });
    }
    return;
  }
  const children = (await FileSystem.readDirectoryAsync(directory)).map(
    (name) => `${directory.replace(/\/$/, '')}/${name}`
  );
  for (const { uri, info } of await inspectUris(children)) {
    if (!info.exists) continue;
    if (info.isDirectory) {
      await scanDirectory(
        uri,
        depth + 1,
        maxDepth,
        filenames,
        extensions,
        visited,
        output
      );
      continue;
    }
    const filename = filenameFromUri(uri);
    if (!matchesFile(filename, filenames, extensions)) continue;
    output.push({
      uri,
      filename,
      size: finiteNumber(info.size),
      modificationTime: finiteNumber(info.modificationTime) * 1_000,
    });
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} did not resolve to a string.`);
  return value;
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function parseAndroidPreferences(text: string): {
  entries: { key: string; value: unknown }[];
  byBasename: Record<string, unknown>;
} {
  if (text.length > MAX_TEXT_BYTES) throw new Error('Android preferences XML exceeds 10 MB.');
  const entries: { key: string; value: unknown }[] = [];
  for (const match of text.matchAll(/<string\s+name="([^"]+)">([\s\S]*?)<\/string>/gi)) {
    entries.push({ key: decodeXml(match[1] ?? ''), value: decodeXml(match[2] ?? '') });
  }
  for (const match of text.matchAll(
    /<(int|long|float|boolean)\s+name="([^"]+)"\s+value="([^"]*)"\s*\/?\s*>/gi
  )) {
    const type = (match[1] ?? '').toLowerCase();
    const raw = decodeXml(match[3] ?? '');
    entries.push({
      key: decodeXml(match[2] ?? ''),
      value: type === 'boolean' ? raw.toLowerCase() === 'true' : Number(raw),
    });
  }
  const byBasename = Object.fromEntries(
    entries.map((entry) => [
      entry.key.replaceAll('\\', '/').split('/').filter(Boolean).at(-1)?.toLowerCase() ?? '',
      entry.value,
    ]).filter(([key]) => !!key)
  );
  return { entries, byBasename };
}

function assertReadOnlyQuery(query: string): void {
  const normalized = query.trim();
  if (
    !/^select\b/i.test(normalized) ||
    normalized.includes(';') ||
    /--|\/\*|\*\//.test(normalized) ||
    /\b(?:attach|detach|pragma|insert|update|delete|replace|create|drop|alter|vacuum)\b/i.test(
      normalized
    )
  ) {
    throw new Error('Device workflows may execute only one read-only SELECT query at a time.');
  }
}

export function createMobileDeviceExtensionHost(): ExtensionDeviceHost {
  const archiveCache = new Map<string, Promise<JSZip>>();

  const archive = async (uri: string): Promise<JSZip> => {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists || info.isDirectory) throw new Error('The selected archive does not exist.');
    if (finiteNumber(info.size) > MAX_ARCHIVE_BYTES) {
      throw new Error('The selected archive exceeds the 64 MB device-workflow limit.');
    }
    const cacheKey = `${uri}:${finiteNumber(info.size)}:${finiteNumber(info.modificationTime)}`;
    const existing = archiveCache.get(cacheKey);
    if (existing) return existing;
    const pending = (async () => {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return JSZip.loadAsync(base64, { base64: true });
    })().catch((cause) => {
      archiveCache.delete(cacheKey);
      throw cause;
    });
    archiveCache.set(cacheKey, pending);
    while (archiveCache.size > 4) {
      const oldest = archiveCache.keys().next().value;
      if (typeof oldest === 'string') archiveCache.delete(oldest);
      else break;
    }
    return pending;
  };

  return {
    async execute(operation: ExtensionDeviceOperation, context: ExtensionDeviceExecutionContext) {
      if (operation.kind === 'directory.scan') {
        const directory = requiredString(context.evaluate(operation.directory), 'Directory scan');
        if (!configuredDirectories(context).has(directory)) {
          throw new Error('Device workflows may scan only a user-selected directory setting.');
        }
        const files: DeviceFile[] = [];
        await scanDirectory(
          directory,
          0,
          operation.maxDepth ?? 4,
          operation.filenames ?? [],
          operation.extensions ?? [],
          new Set(),
          files
        );
        files.sort(
          operation.order === 'name-asc'
            ? (left, right) => left.filename.localeCompare(right.filename)
            : (left, right) =>
                right.modificationTime - left.modificationTime ||
                right.filename.localeCompare(left.filename)
        );
        return { files: files.slice(0, operation.limit ?? 20) };
      }

      if (operation.kind === 'archive.read') {
        const uri = approvedLocalUri(
          context.evaluate(operation.archive),
          context,
          'Archive path'
        );
        const zip = await archive(uri);
        const names = Object.keys(zip.files);
        let entryPath: string | undefined;
        const selector = operation.entry;
        if ('suffix' in selector) {
          entryPath = names.find((name) =>
            name.toLowerCase().endsWith(selector.suffix.toLowerCase())
          );
        } else {
          const indexed = context.evaluate(selector.indexed) as
            | { path?: unknown; text?: unknown }
            | null;
          const indexPath = requiredString(indexed?.path, 'Archive index path');
          const indexText = requiredString(indexed?.text, 'Archive index text');
          const entries = indexText.split(/\r?\n/).filter(Boolean);
          const index = entries.findIndex((name) =>
            name.toLowerCase().endsWith(selector.targetSuffix.toLowerCase())
          );
          if (index >= 0) {
            const parent = indexPath.split('/').slice(0, -1).join('/');
            entryPath = `${parent ? `${parent}/` : ''}${index + 1}${selector.entryExtension ?? '.tag'}`;
          }
        }
        if (!entryPath) throw new Error('The requested archive entry was not found.');
        const entry = zip.file(entryPath);
        if (!entry) throw new Error(`Archive entry "${entryPath}" was not found.`);
        const bytes = await entry.async('uint8array');
        if (bytes.byteLength > MAX_ARCHIVE_ENTRY_BYTES) {
          throw new Error('The requested archive entry exceeds 32 MB.');
        }
        if (operation.response === 'bytes') return { path: entryPath, bytes };
        const text = new TextDecoder().decode(bytes);
        if (text.length > MAX_TEXT_BYTES) throw new Error('The requested text entry exceeds 10 MB.');
        return { path: entryPath, text };
      }

      if (operation.kind === 'file.read') {
        const uri = approvedLocalUri(context.evaluate(operation.file), context, 'File path');
        const info = await FileSystem.getInfoAsync(uri);
        if (!info.exists || info.isDirectory) throw new Error('The selected file does not exist.');
        if (finiteNumber(info.size) > MAX_ARCHIVE_ENTRY_BYTES) {
          throw new Error('The selected file exceeds the 32 MB device-workflow limit.');
        }
        if (operation.response === 'bytes') {
          const base64 = await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
          return { path: uri, bytes };
        }
        const text = await FileSystem.readAsStringAsync(uri);
        if (text.length > MAX_TEXT_BYTES) throw new Error('The selected text file exceeds 10 MB.');
        if (operation.response === 'text') return { path: uri, text };
        try {
          return { path: uri, json: JSON.parse(text.replace(/^\uFEFF/, '')) as unknown };
        } catch (cause) {
          throw new Error(
            `The selected file is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`
          );
        }
      }

      if (operation.kind === 'sqlite.query') {
        const resolved = context.evaluate(operation.database) as { bytes?: unknown } | null;
        if (!(resolved?.bytes instanceof Uint8Array)) {
          throw new Error('SQLite query input is not a binary database entry.');
        }
        const database = await deserializeDatabaseAsync(resolved.bytes, { useNewConnection: true });
        try {
          const results: Record<string, unknown[]> = {};
          let rows = 0;
          for (const [id, query] of Object.entries(operation.queries)) {
            assertReadOnlyQuery(query);
            const result = await database.getAllAsync<Record<string, unknown>>(query);
            rows += result.length;
            if (rows > MAX_SQLITE_ROWS) {
              throw new Error(`Device workflow SQLite output exceeds ${MAX_SQLITE_ROWS} rows.`);
            }
            results[id] = result;
          }
          return results;
        } finally {
          await database.closeAsync();
        }
      }

      if (operation.kind === 'android.preferences.parse') {
        const resolved = context.evaluate(operation.text) as { text?: unknown } | null;
        return parseAndroidPreferences(requiredString(resolved?.text, 'Android preferences'));
      }

      if (operation.kind === 'android.open-file') {
        if (Platform.OS !== 'android') {
          throw new Error('This device workflow action is available only on Android.');
        }
        const sourceUri = approvedLocalUri(
          context.evaluate(operation.uri),
          context,
          'Local book URI'
        );
        const contentUri = sourceUri.startsWith('content:')
          ? sourceUri
          : await FileSystem.getContentUriAsync(sourceUri);
        const format = operation.format
          ? String(context.evaluate(operation.format) ?? '').toLowerCase()
          : '';
        const type = operation.mimeTypes?.[format] ?? 'application/octet-stream';
        const failures: string[] = [];
        for (const packageName of operation.packages) {
          try {
            await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
              packageName,
              ...(operation.activitySuffix
                ? {
                    className: `${packageName}${
                      operation.activitySuffix.startsWith('.') ? '' : '.'
                    }${operation.activitySuffix}`,
                  }
                : {}),
              data: contentUri,
              type,
              category: 'android.intent.category.DEFAULT',
              flags: 1,
            });
            return { kind: 'handled' };
          } catch (cause) {
            failures.push(cause instanceof Error ? cause.message : String(cause));
          }
        }
        throw new Error(`No declared Android package could open this file. ${failures.at(-1) ?? ''}`);
      }

      throw new Error('Unsupported mobile device workflow operation.');
    },
  };
}
