import * as Device from 'expo-device';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  applyProgressSyncRecords,
  loadProgressSyncLocalDocuments,
  loadProgressSyncRecords,
} from './library-db';
import { koreaderPartialMd5 } from './koreader-document';
import {
  isProgressSyncRecord,
  mergeProgressRecords,
  type ProgressSyncRecord,
} from './progress-sync-model';
import { getProgressSyncDeviceId } from './progress-sync';

const SESSION_KEY = 'tomeio.hosted-sync.session.v1';
const SERVICE_ORIGIN = (
  process.env.EXPO_PUBLIC_SYNC_URL ?? 'https://sync.tomeio.app'
).replace(/\/$/u, '');

export interface HostedSyncAccount {
  id: string;
  email: string;
}

interface HostedSyncSession {
  account: HostedSyncAccount;
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
  refreshTokenExpiresAt: number;
}

interface HostedProgressRecord {
  document: string;
  percentage: number;
  metadata: Record<string, unknown> | null;
  source: 'tomeio' | 'koreader';
  updatedAt: number;
  serverUpdatedAt: number;
  removedAt: number | null;
}

export interface HostedSyncResult {
  importedRecords: number;
  pushedRecords: number;
  unmatchedRecords: number;
  syncedAt: number;
}

export class HostedSyncError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'HostedSyncError';
  }
}

async function ensureSecureStorage(): Promise<void> {
  if (!(await SecureStore.isAvailableAsync())) {
    throw new Error('Hosted sync requires secure credential storage on Android or iOS.');
  }
}

function validSession(value: unknown): value is HostedSyncSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<HostedSyncSession>;
  return (
    typeof session.account?.id === 'string' &&
    typeof session.account.email === 'string' &&
    typeof session.accessToken === 'string' &&
    typeof session.accessTokenExpiresAt === 'number' &&
    typeof session.refreshToken === 'string' &&
    typeof session.refreshTokenExpiresAt === 'number'
  );
}

async function loadSession(): Promise<HostedSyncSession | null> {
  await ensureSecureStorage();
  const stored = await SecureStore.getItemAsync(SESSION_KEY);
  if (stored == null) return null;
  const parsed: unknown = JSON.parse(stored);
  if (!validSession(parsed)) throw new Error('The stored hosted sync session is invalid.');
  return parsed;
}

async function saveSession(session: HostedSyncSession): Promise<void> {
  await ensureSecureStorage();
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
}

async function errorFromResponse(response: Response): Promise<HostedSyncError> {
  let code = 'request_failed';
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown };
    if (typeof body.error === 'string') code = body.error;
    else if (typeof body.message === 'string') code = body.message;
  } catch {
    // A non-JSON error remains an observable request failure.
  }
  return new HostedSyncError(`Hosted sync request failed (${code}).`, response.status, code);
}

async function jsonRequest<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${SERVICE_ORIGIN}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  if (!response.ok) throw await errorFromResponse(response);
  return response.json() as Promise<T>;
}

async function refreshSession(session: HostedSyncSession): Promise<HostedSyncSession> {
  try {
    const refreshed = await jsonRequest<HostedSyncSession>('/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    await saveSession(refreshed);
    return refreshed;
  } catch (error) {
    if (error instanceof HostedSyncError && error.status === 401) {
      await SecureStore.deleteItemAsync(SESSION_KEY);
    }
    throw error;
  }
}

async function authenticatedRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const stored = await loadSession();
  if (stored == null) throw new Error('Sign in to Tomeio Sync before synchronizing.');
  const session =
    stored.accessTokenExpiresAt <= Math.floor(Date.now() / 1_000) + 30
      ? await refreshSession(stored)
      : stored;
  try {
    return await jsonRequest<T>(path, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${session.accessToken}` },
    });
  } catch (error) {
    if (!(error instanceof HostedSyncError) || error.status !== 401) throw error;
    const refreshed = await refreshSession(session);
    return jsonRequest<T>(path, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${refreshed.accessToken}` },
    });
  }
}

function deviceName(): string {
  return Device.deviceName ?? Device.modelName ?? `Tomeio ${Platform.OS}`;
}

async function authenticate(
  route: 'login' | 'register',
  email: string,
  password: string,
): Promise<HostedSyncAccount> {
  const session = await jsonRequest<HostedSyncSession>(`/v1/auth/${route}`, {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      deviceId: await getProgressSyncDeviceId(),
      deviceName: deviceName(),
    }),
  });
  if (!validSession(session)) throw new Error('The sync service returned an invalid session.');
  await saveSession(session);
  return session.account;
}

export function registerHostedSync(email: string, password: string): Promise<HostedSyncAccount> {
  return authenticate('register', email, password);
}

export function loginHostedSync(email: string, password: string): Promise<HostedSyncAccount> {
  return authenticate('login', email, password);
}

export async function getHostedSyncAccount(): Promise<HostedSyncAccount | null> {
  if (Platform.OS === 'web') return null;
  return (await loadSession())?.account ?? null;
}

export async function logoutHostedSync(): Promise<void> {
  const session = await loadSession();
  if (session == null) return;
  await authenticatedRequest('/v1/auth/logout', { method: 'POST' });
  await SecureStore.deleteItemAsync(SESSION_KEY);
}

async function md5(value: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.MD5, value);
}

async function documentIds(records: ProgressSyncRecord[]) {
  const localDocuments = await loadProgressSyncLocalDocuments();
  const identifiersByAlias = new Map<
    string,
    { primary: string; aliases: string[] } | null
  >();
  for (const local of localDocuments) {
    const logical = await md5(local.identity);
    const partial = await koreaderPartialMd5(local.uri);
    const identifiers = { primary: partial, aliases: [logical] };
    for (const alias of [...local.aliases, local.identity]) {
      const existing = identifiersByAlias.get(alias);
      if (existing != null && existing.primary !== partial) {
        identifiersByAlias.set(alias, null);
        continue;
      }
      if (existing === undefined) identifiersByAlias.set(alias, identifiers);
    }
  }
  const byRecord = new Map<ProgressSyncRecord, { primary: string; aliases: string[] }>();
  const recordsByDocument = new Map<string, ProgressSyncRecord>();
  for (const record of records) {
    const logical = await md5(record.identity);
    const matches = [...record.aliases, record.identity]
      .map((alias) => identifiersByAlias.get(alias))
      .filter((value): value is { primary: string; aliases: string[] } => value != null);
    const localIds = new Set(matches.map((match) => match.primary));
    if (localIds.size > 1) {
      throw new Error(`Multiple local files match the sync record ${record.identity}.`);
    }
    const local = matches[0];
    const identifiers = local ?? { primary: logical, aliases: [] };
    byRecord.set(record, identifiers);
    for (const identifier of [identifiers.primary, ...identifiers.aliases, logical]) {
      recordsByDocument.set(identifier, record);
    }
  }
  return { byRecord, recordsByDocument };
}

function embeddedProgressRecord(record: HostedProgressRecord): ProgressSyncRecord | null {
  const embedded = record.metadata?.progressRecord;
  return isProgressSyncRecord(embedded) ? embedded : null;
}

export async function synchronizeHostedProgress(): Promise<HostedSyncResult> {
  const localBeforePull = await loadProgressSyncRecords();
  const identifiersBeforePull = await documentIds(localBeforePull);
  const remote = await authenticatedRequest<{
    records: HostedProgressRecord[];
    serverTime: number;
  }>('/v1/progress');
  const unmatched: HostedProgressRecord[] = [];
  const remoteRecords = remote.records.flatMap((record) => {
    const embedded = embeddedProgressRecord(record);
    const local = identifiersBeforePull.recordsByDocument.get(record.document);
    const base = embedded ?? local;
    if (base == null) {
      unmatched.push(record);
      return [];
    }
    return [{
      ...base,
      progress: Math.max(0, Math.min(100, record.percentage * 100)),
      isRead: record.percentage >= 1 || base.isRead,
      updatedAt: record.serverUpdatedAt,
      ...(record.removedAt == null ? {} : { removedAt: record.removedAt }),
    }];
  });
  const mergedBeforeImport = mergeProgressRecords(localBeforePull, remoteRecords);
  const importedRecords = await applyProgressSyncRecords(mergedBeforeImport);
  const merged = mergeProgressRecords(remoteRecords, await loadProgressSyncRecords());
  const identifiers = await documentIds(merged);
  const deviceId = await getProgressSyncDeviceId();
  for (const record of merged) {
    const document = identifiers.byRecord.get(record);
    if (document == null) throw new Error(`No hosted sync identifier for ${record.identity}.`);
    await authenticatedRequest(`/v1/progress/${encodeURIComponent(document.primary)}`, {
      method: 'PUT',
      body: JSON.stringify({
        percentage: record.isRead ? 1 : Math.max(0, Math.min(1, record.progress / 100)),
        aliases: document.aliases,
        metadata: { progressRecord: record },
        deviceId,
        deviceName: deviceName(),
        updatedAt: record.updatedAt,
        removedAt: record.removedAt,
      }),
    });
  }
  return {
    importedRecords,
    pushedRecords: merged.length,
    unmatchedRecords: unmatched.length,
    syncedAt: remote.serverTime,
  };
}
