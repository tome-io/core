import * as Device from "expo-device";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import {
  applyCollectionSyncRecords,
  applyProgressSyncRecords,
  getSyncFingerprint,
  loadCollectionSyncRecords,
  loadHostedSyncLocalDocuments,
  loadProgressSyncRecords,
  setSyncFingerprint,
  syncAliases,
} from "./library-db";
import type { LibraryBook } from "./library";
import { koreaderPartialMd5 } from "./koreader-document";
import { bookIdentity } from "./book-metadata";
import { materializeNativeFolderFile } from "./native-folder-file";
import {
  mergeProgressRecords,
  type ProgressSyncRecord,
} from "./progress-sync-model";
import { getSyncDeviceId } from "./sync-device";
import {
  mergeCollectionSyncRecords,
  type CollectionSyncRecord,
  type SyncedCollection,
} from "./library-sync-model";
import {
  hostedAccountMetadata,
  matchingSyncRecord,
  progressRecordFromHosted,
  sameCollectionSyncContent,
  sameProgressSyncContent,
  type HostedProgressRecord,
} from "./hosted-sync-record";

const SESSION_KEY = "tomeio.hosted-sync.session.v1";
const KOBO_ENDPOINT_KEY_PREFIX = "tomeio.hosted-sync.kobo-endpoint.v1";
const SERVICE_ORIGIN = (
  process.env.EXPO_PUBLIC_SYNC_URL ?? "https://sync.tomeio.app"
).replace(/\/$/u, "");
const UPLOAD_CONCURRENCY = 4;

export type HostedSyncPhase =
  | "pulling-progress"
  | "applying-progress"
  | "uploading-progress"
  | "pulling-library"
  | "uploading-library"
  | "pulling-reading-list"
  | "uploading-reading-list";

export interface HostedSyncProgress {
  phase: HostedSyncPhase;
  message: string;
  completed?: number;
  total?: number;
}

export interface HostedSyncOptions {
  onProgress?: (progress: HostedSyncProgress) => void;
  queueAfterCurrent?: boolean;
}

export type HostedSyncBookStream =
  | "progress"
  | "library"
  | "reading-list";

export interface HostedSyncBookChange {
  book: LibraryBook;
  streams: HostedSyncBookStream[];
  documentAlias?: string;
}

export interface HostedSyncAccount {
  id: string;
  email: string;
}

export interface HostedKoboConnection {
  connected: boolean;
  endpoint?: string;
  createdAt?: number;
  lastUsedAt?: number;
}

interface HostedSyncSession {
  account: HostedSyncAccount;
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
  refreshTokenExpiresAt: number;
}

export type HostedSyncVerificationAction = "confirm" | "recovery";

export interface HostedSyncVerificationChallenge {
  email: string;
  state: "pending" | "verified";
  delivery?: "sent" | "logged";
  debugCode?: string;
}

export interface HostedSyncRecoveryChallenge {
  recoveryToken: string;
  expiresAt: number;
}

interface HostedDocumentIds {
  primary: string;
  aliases: string[];
  fingerprintKind: "koreader-partial-md5-v1" | "tomeio-logical-md5-v1";
  filename: string | null;
  identifiers: Record<string, string>;
}

interface SyncIdentityRecord {
  identity: string;
  aliases: string[];
}

interface HostedCollectionRecord {
  document: string;
  fingerprintKind:
    | "koreader-partial-md5-v1"
    | "koreader-filename-md5-v1"
    | "tomeio-logical-md5-v1";
  documentMetadata: HostedProgressRecord["documentMetadata"];
  addedAt: number;
  sortAt: number;
  updatedAt: number;
  serverUpdatedAt: number;
  removedAt: number | null;
}

interface SyncCheckpoint {
  cursor: number | null;
  acknowledgements: Record<string, string>;
  localRevision?: string;
  remoteWindowRevision?: string;
  remoteVersion?: number;
}

interface HostedSyncStatus {
  versions: {
    progress: number;
    library: number;
    readingList: number;
  };
  serverTime: number;
}

const HOSTED_DOCUMENT_ALIAS_PREFIX =
  "hosted-document:koreader-partial-md5-v1:";
const SOURCE_URL_IDENTIFIER = "tomeio:source-url";

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
    this.name = "HostedSyncError";
  }
}

function koboEndpointKey(accountId: string): string {
  return `${KOBO_ENDPOINT_KEY_PREFIX}.${accountId}`;
}

async function ensureSecureStorage(): Promise<void> {
  if (!(await SecureStore.isAvailableAsync())) {
    throw new Error(
      "Hosted sync requires secure credential storage on Android or iOS.",
    );
  }
}

function validSession(value: unknown): value is HostedSyncSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<HostedSyncSession>;
  return (
    typeof session.account?.id === "string" &&
    typeof session.account.email === "string" &&
    typeof session.accessToken === "string" &&
    typeof session.accessTokenExpiresAt === "number" &&
    typeof session.refreshToken === "string" &&
    typeof session.refreshTokenExpiresAt === "number"
  );
}

async function loadSession(): Promise<HostedSyncSession | null> {
  await ensureSecureStorage();
  const stored = await SecureStore.getItemAsync(SESSION_KEY);
  if (stored == null) return null;
  const parsed: unknown = JSON.parse(stored);
  if (!validSession(parsed))
    throw new Error("The stored hosted sync session is invalid.");
  return parsed;
}

async function saveSession(session: HostedSyncSession): Promise<void> {
  await ensureSecureStorage();
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
}

async function errorFromResponse(response: Response): Promise<HostedSyncError> {
  let code = "request_failed";
  try {
    const body = (await response.json()) as {
      error?: unknown;
      message?: unknown;
    };
    if (typeof body.error === "string") code = body.error;
    else if (typeof body.message === "string") code = body.message;
  } catch {
    // A non-JSON error remains an observable request failure.
  }
  const messages: Record<string, string> = {
    account_exists: "An account already exists for this email address.",
    email_unverified: "Confirm your email address before signing in.",
    invalid_code: "That code is incorrect or has expired.",
    invalid_credentials: "The email address or password is incorrect.",
    invalid_request: "The verification request is invalid.",
    invalid_reset_token: "This password reset has expired. Request a new code.",
    rate_limited: "Too many attempts. Wait a minute and try again.",
    registration_disabled:
      "New sync-account registration is temporarily unavailable.",
  };
  return new HostedSyncError(
    messages[code] ?? `Hosted sync request failed (${code}).`,
    response.status,
    code,
  );
}

async function jsonRequest<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${SERVICE_ORIGIN}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) throw await errorFromResponse(response);
  return response.json() as Promise<T>;
}

async function refreshSession(
  session: HostedSyncSession,
): Promise<HostedSyncSession> {
  try {
    const refreshed = await jsonRequest<HostedSyncSession>("/v1/auth/refresh", {
      method: "POST",
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

async function authenticatedRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const stored = await loadSession();
  if (stored == null)
    throw new Error("Sign in to Tomeio Sync before synchronizing.");
  const session =
    stored.accessTokenExpiresAt <= Math.floor(Date.now() / 1_000) + 30
      ? await refreshSession(stored)
      : stored;
  try {
    return await jsonRequest<T>(path, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${session.accessToken}`,
      },
    });
  } catch (error) {
    if (!(error instanceof HostedSyncError) || error.status !== 401)
      throw error;
    const refreshed = await refreshSession(session);
    return jsonRequest<T>(path, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${refreshed.accessToken}`,
      },
    });
  }
}

function deviceName(): string {
  return Device.deviceName ?? Device.modelName ?? `Tomeio ${Platform.OS}`;
}

async function uploadConcurrently<T>(
  records: T[],
  upload: (record: T) => Promise<void>,
): Promise<void> {
  for (let offset = 0; offset < records.length; offset += UPLOAD_CONCURRENCY) {
    await Promise.all(
      records.slice(offset, offset + UPLOAD_CONCURRENCY).map(upload),
    );
  }
}

async function saveAuthenticatedResponse(
  value: unknown,
): Promise<HostedSyncAccount> {
  if (!validSession(value))
    throw new Error("The sync service returned an invalid session.");
  await saveSession(value);
  return value.account;
}

export async function loginHostedSync(
  email: string,
  password: string,
): Promise<HostedSyncAccount> {
  const session = await jsonRequest<HostedSyncSession>("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      deviceId: await getSyncDeviceId(),
      deviceName: deviceName(),
    }),
  });
  return saveAuthenticatedResponse(session);
}

export async function registerHostedSync(
  email: string,
  password: string,
): Promise<HostedSyncVerificationChallenge> {
  const response = await jsonRequest<{
    verification?: { state?: unknown; delivery?: unknown };
    debugCode?: unknown;
  }>("/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (response.verification?.state !== "pending") {
    throw new Error(
      "The sync service returned an invalid verification challenge.",
    );
  }
  return {
    email,
    state: "pending",
    ...(response.verification.delivery === "sent" ||
    response.verification.delivery === "logged"
      ? { delivery: response.verification.delivery }
      : {}),
    ...(typeof response.debugCode === "string"
      ? { debugCode: response.debugCode }
      : {}),
  };
}

export async function requestHostedSyncCode(
  email: string,
  action: HostedSyncVerificationAction,
): Promise<HostedSyncVerificationChallenge> {
  const response = await jsonRequest<{
    state?: unknown;
    delivery?: unknown;
    debugCode?: unknown;
  }>("/v1/auth/verify/request", {
    method: "POST",
    body: JSON.stringify({ email, action }),
  });
  const state = response.state === "verified" ? "verified" : "pending";
  return {
    email,
    state,
    ...(response.delivery === "sent" || response.delivery === "logged"
      ? { delivery: response.delivery }
      : {}),
    ...(typeof response.debugCode === "string"
      ? { debugCode: response.debugCode }
      : {}),
  };
}

export async function verifyHostedSyncEmail(
  email: string,
  code: string,
): Promise<HostedSyncAccount> {
  const response = await jsonRequest<HostedSyncSession>(
    "/v1/auth/verify/confirm",
    {
      method: "POST",
      body: JSON.stringify({
        email,
        action: "confirm",
        code,
        deviceId: await getSyncDeviceId(),
        deviceName: deviceName(),
      }),
    },
  );
  return saveAuthenticatedResponse(response);
}

export async function verifyHostedSyncRecoveryCode(
  email: string,
  code: string,
): Promise<HostedSyncRecoveryChallenge> {
  const response = await jsonRequest<{
    recoveryToken?: unknown;
    expiresAt?: unknown;
  }>("/v1/auth/verify/confirm", {
    method: "POST",
    body: JSON.stringify({ email, action: "recovery", code }),
  });
  if (
    typeof response.recoveryToken !== "string" ||
    typeof response.expiresAt !== "number"
  ) {
    throw new Error(
      "The sync service returned an invalid password-reset challenge.",
    );
  }
  return {
    recoveryToken: response.recoveryToken,
    expiresAt: response.expiresAt,
  };
}

export async function resetHostedSyncPassword(
  recoveryToken: string,
  password: string,
): Promise<HostedSyncAccount> {
  const response = await jsonRequest<HostedSyncSession>(
    "/v1/auth/password/reset",
    {
      method: "POST",
      body: JSON.stringify({
        recoveryToken,
        password,
        deviceId: await getSyncDeviceId(),
        deviceName: deviceName(),
      }),
    },
  );
  return saveAuthenticatedResponse(response);
}

export async function getHostedSyncAccount(): Promise<HostedSyncAccount | null> {
  if (Platform.OS === "web") return null;
  return (await loadSession())?.account ?? null;
}

export async function logoutHostedSync(): Promise<void> {
  const session = await loadSession();
  if (session == null) return;
  if (pendingHostedSync != null) {
    try {
      await pendingHostedSync;
    } catch {
      // The logout request below remains authoritative even if an earlier sync failed.
    }
  }
  await authenticatedRequest("/v1/auth/logout", { method: "POST" });
  await SecureStore.deleteItemAsync(SESSION_KEY);
  await SecureStore.deleteItemAsync(koboEndpointKey(session.account.id));
}

function hostedKoboConnection(
  value: unknown,
  endpoint?: string | null,
): HostedKoboConnection {
  if (!value || typeof value !== "object") {
    throw new Error("The sync service returned an invalid Kobo connection.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.connected !== "boolean") {
    throw new Error("The sync service returned an invalid Kobo connection.");
  }
  const createdAt = record.createdAt;
  const lastUsedAt = record.lastUsedAt;
  if (
    (createdAt != null && typeof createdAt !== "number") ||
    (lastUsedAt != null && typeof lastUsedAt !== "number")
  ) {
    throw new Error("The sync service returned invalid Kobo connection dates.");
  }
  return {
    connected: record.connected,
    ...(record.connected && endpoint ? { endpoint } : {}),
    ...(typeof createdAt === "number" ? { createdAt } : {}),
    ...(typeof lastUsedAt === "number" ? { lastUsedAt } : {}),
  };
}

export async function getHostedKoboConnection(): Promise<HostedKoboConnection> {
  const session = await loadSession();
  if (session == null) {
    throw new Error("Sign in to Tomeio Sync before connecting Kobo.");
  }
  const [response, savedEndpoint] = await Promise.all([
    authenticatedRequest<unknown>("/v1/readers/kobo"),
    SecureStore.getItemAsync(koboEndpointKey(session.account.id)),
  ]);
  const connection = hostedKoboConnection(response, savedEndpoint);
  if (!connection.connected && savedEndpoint != null) {
    await SecureStore.deleteItemAsync(koboEndpointKey(session.account.id));
  }
  return connection;
}

export async function connectHostedKobo(): Promise<HostedKoboConnection> {
  const session = await loadSession();
  if (session == null) {
    throw new Error("Sign in to Tomeio Sync before connecting Kobo.");
  }
  const response = await authenticatedRequest<Record<string, unknown>>(
    "/v1/readers/kobo",
    { method: "POST" },
  );
  const endpoint = response.endpoint;
  if (typeof endpoint !== "string") {
    throw new Error("The sync service did not return a Kobo endpoint.");
  }
  const parsed = new URL(endpoint);
  const serviceOrigin = new URL(SERVICE_ORIGIN).origin;
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== serviceOrigin ||
    !/^\/kobo\/[A-Za-z0-9_-]+$/u.test(parsed.pathname)
  ) {
    throw new Error("The sync service returned an invalid Kobo endpoint.");
  }
  await SecureStore.setItemAsync(koboEndpointKey(session.account.id), endpoint, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
  return hostedKoboConnection(response, endpoint);
}

export async function disconnectHostedKobo(): Promise<HostedKoboConnection> {
  const session = await loadSession();
  if (session == null) {
    throw new Error("Sign in to Tomeio Sync before disconnecting Kobo.");
  }
  const response = await authenticatedRequest<unknown>("/v1/readers/kobo", {
    method: "DELETE",
  });
  await SecureStore.deleteItemAsync(koboEndpointKey(session.account.id));
  return hostedKoboConnection(response);
}

async function md5(value: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.MD5, value);
}

function checkpointKey(accountId: string, stream: string): string {
  return `hosted-sync:${accountId}:${stream}:v1`;
}

async function loadCheckpoint(
  accountId: string,
  stream: string,
): Promise<SyncCheckpoint> {
  const stored = await getSyncFingerprint(checkpointKey(accountId, stream));
  if (stored == null) return { cursor: null, acknowledgements: {} };
  const parsed: unknown = JSON.parse(stored);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`The stored ${stream} sync checkpoint is invalid.`);
  }
  const value = parsed as Partial<SyncCheckpoint>;
  if (
    value.cursor !== null &&
    (typeof value.cursor !== "number" || !Number.isFinite(value.cursor))
  ) {
    throw new Error(`The stored ${stream} sync cursor is invalid.`);
  }
  if (!value.acknowledgements || typeof value.acknowledgements !== "object") {
    throw new Error(`The stored ${stream} sync acknowledgements are invalid.`);
  }
  for (const [document, fingerprint] of Object.entries(
    value.acknowledgements,
  )) {
    if (!document || typeof fingerprint !== "string") {
      throw new Error(`The stored ${stream} sync acknowledgements are invalid.`);
    }
  }
  if (
    value.localRevision != null &&
    typeof value.localRevision !== "string"
  ) {
    throw new Error(`The stored ${stream} local revision is invalid.`);
  }
  if (
    value.remoteWindowRevision != null &&
    typeof value.remoteWindowRevision !== "string"
  ) {
    throw new Error(`The stored ${stream} remote revision is invalid.`);
  }
  if (
    value.remoteVersion != null &&
    (!Number.isSafeInteger(value.remoteVersion) || value.remoteVersion < 0)
  ) {
    throw new Error(`The stored ${stream} remote version is invalid.`);
  }
  return {
    cursor: value.cursor ?? null,
    acknowledgements: value.acknowledgements,
    ...(value.localRevision ? { localRevision: value.localRevision } : {}),
    ...(value.remoteWindowRevision
      ? { remoteWindowRevision: value.remoteWindowRevision }
      : {}),
    ...(value.remoteVersion != null
      ? { remoteVersion: value.remoteVersion }
      : {}),
  };
}

function hostedSyncStatus(value: unknown): HostedSyncStatus {
  if (!value || typeof value !== "object") {
    throw new Error("The sync service returned an invalid change status.");
  }
  const record = value as Record<string, unknown>;
  const versions = record.versions;
  if (!versions || typeof versions !== "object") {
    throw new Error("The sync service returned invalid change versions.");
  }
  const values = versions as Record<string, unknown>;
  if (
    !Number.isSafeInteger(values.progress) ||
    (values.progress as number) < 0 ||
    !Number.isSafeInteger(values.library) ||
    (values.library as number) < 0 ||
    !Number.isSafeInteger(values.readingList) ||
    (values.readingList as number) < 0 ||
    !Number.isSafeInteger(record.serverTime) ||
    (record.serverTime as number) < 0
  ) {
    throw new Error("The sync service returned invalid change versions.");
  }
  return {
    versions: {
      progress: values.progress as number,
      library: values.library as number,
      readingList: values.readingList as number,
    },
    serverTime: record.serverTime as number,
  };
}

async function saveCheckpoint(
  accountId: string,
  stream: string,
  checkpoint: SyncCheckpoint,
): Promise<void> {
  await setSyncFingerprint(
    checkpointKey(accountId, stream),
    JSON.stringify(checkpoint),
  );
}

function incrementalPath(path: string, cursor: number | null): string {
  return cursor == null ? path : `${path}?updatedSince=${cursor}`;
}

async function payloadFingerprint(
  document: HostedDocumentIds,
  payload: Record<string, unknown>,
): Promise<string> {
  return md5(
    JSON.stringify({
      document: document.primary,
      aliases: [...document.aliases].sort(),
      fingerprintKind: document.fingerprintKind,
      payload,
    }),
  );
}

async function syncRecordsRevision(records: SyncIdentityRecord[]): Promise<string> {
  return md5(
    JSON.stringify(
      [...records]
        .map((record) => {
          const value = record as SyncIdentityRecord &
            Partial<ProgressSyncRecord & CollectionSyncRecord>;
          return {
            identity: record.identity,
            updatedAt: value.updatedAt,
            removedAt: value.removedAt,
            progress: value.progress,
            isRead: value.isRead,
            readingTimeMs: value.readingTimeMs,
            wordsRead: value.wordsRead,
            lastReadAt: value.lastReadAt,
            addedAt: value.addedAt,
            sortAt: value.sortAt,
            sourceUrl: value.sourceUrl,
          };
        })
        .sort((left, right) => left.identity.localeCompare(right.identity)),
    ),
  );
}

async function remoteWindowRevision(records: unknown[]): Promise<string> {
  return md5(JSON.stringify(records));
}

function collectionPayload(
  record: CollectionSyncRecord,
  document: HostedDocumentIds,
): Record<string, unknown> {
  return {
    aliases: document.aliases,
    fingerprintKind: document.fingerprintKind,
    documentMetadata: {
      title: record.title,
      authors:
        record.author && record.author !== "Unknown" ? [record.author] : [],
      format: record.format,
      identifiers: {
        ...document.identifiers,
        ...(record.sourceUrl
          ? { [SOURCE_URL_IDENTIFIER]: record.sourceUrl }
          : {}),
      },
    },
    filename: document.filename,
    addedAt: record.addedAt,
    sortAt: record.sortAt,
    updatedAt: record.updatedAt,
    removedAt: record.removedAt,
  };
}

function progressPayload(
  record: ProgressSyncRecord,
  document: HostedDocumentIds,
  deviceId: string,
): Record<string, unknown> {
  return {
    percentage: record.isRead
      ? 1
      : Math.max(0, Math.min(1, record.progress / 100)),
    aliases: document.aliases,
    fingerprintKind: document.fingerprintKind,
    documentMetadata: {
      title: record.title,
      authors:
        record.author && record.author !== "Unknown" ? [record.author] : [],
      format: record.format,
      identifiers: document.identifiers,
    },
    filename: document.filename,
    readerAliases: [
      ...new Set([
        ...(document.filename ? [document.filename] : []),
        ...record.aliases.flatMap((alias) =>
          alias.startsWith("filename:")
            ? [alias.slice("filename:".length)]
            : [],
        ),
      ]),
    ].map((externalKey) => ({ reader: "moonreader", externalKey })),
    metadata: hostedAccountMetadata(record),
    deviceId,
    deviceName: deviceName(),
    updatedAt: record.updatedAt,
    removedAt: record.removedAt,
  };
}

async function localDocumentIdentifiers(): Promise<
  Map<string, HostedDocumentIds | null>
> {
  const localDocuments = await loadHostedSyncLocalDocuments();
  const identifiersByAlias = new Map<string, HostedDocumentIds | null>();
  for (const local of localDocuments) {
    const logical = await md5(local.identity);
    let partial: string;
    try {
      const readableUri = await materializeNativeFolderFile(
        local.uri,
        local.filename,
      );
      partial = await koreaderPartialMd5(readableUri);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (
        /(?:FileNotFoundException|Missing file|ENOENT|no such file|does not exist)/iu.test(
          message,
        )
      ) {
        continue;
      }
      throw cause;
    }
    const identifiers = {
      primary: partial,
      aliases: [logical],
      fingerprintKind: "koreader-partial-md5-v1" as const,
      filename: local.filename || null,
      identifiers: local.identifiers,
    };
    for (const alias of [...local.aliases, local.identity]) {
      const existing = identifiersByAlias.get(alias);
      if (existing != null && existing.primary !== partial) {
        identifiersByAlias.set(alias, null);
        continue;
      }
      if (existing === undefined) identifiersByAlias.set(alias, identifiers);
    }
  }
  return identifiersByAlias;
}

async function localDocumentIdentifiersForChanges(
  changes: HostedSyncBookChange[],
): Promise<Map<string, HostedDocumentIds | null>> {
  const identifiersByAlias = new Map<string, HostedDocumentIds | null>();
  for (const change of changes) {
    const { book } = change;
    const uri = book.local?.uri ?? book.fileUri;
    const filename =
      book.local?.filename ?? uri?.split("/").at(-1) ?? "";
    const storedFingerprint = change.documentAlias?.startsWith(
      HOSTED_DOCUMENT_ALIAS_PREFIX,
    )
      ? change.documentAlias.slice(HOSTED_DOCUMENT_ALIAS_PREFIX.length)
      : null;
    if (
      storedFingerprint == null &&
      (!uri || book.availableLocally === false)
    ) {
      continue;
    }
    const partial =
      storedFingerprint ??
      (await koreaderPartialMd5(
        await materializeNativeFolderFile(uri!, filename),
      ));
    const identity = bookIdentity(book.title, book.author);
    const identifiers: HostedDocumentIds = {
      primary: partial,
      aliases: [await md5(identity)],
      fingerprintKind: "koreader-partial-md5-v1",
      filename: filename || null,
      identifiers: book.extension?.book.identifiers ?? {},
    };
    for (const alias of [identity, ...syncAliases(book)]) {
      const existing = identifiersByAlias.get(alias);
      if (existing != null && existing.primary !== partial) {
        identifiersByAlias.set(alias, null);
        continue;
      }
      if (existing === undefined) identifiersByAlias.set(alias, identifiers);
    }
  }
  return identifiersByAlias;
}

export async function hostedDocumentAliasForBook(
  book: LibraryBook,
): Promise<string | null> {
  const uri = book.local?.uri ?? book.fileUri;
  if (!uri || book.availableLocally === false) return null;
  const filename = book.local?.filename ?? uri.split("/").at(-1) ?? "";
  const readableUri = await materializeNativeFolderFile(uri, filename);
  return `${HOSTED_DOCUMENT_ALIAS_PREFIX}${await koreaderPartialMd5(readableUri)}`;
}

async function documentIds<T extends SyncIdentityRecord>(
  records: T[],
  identifiersByAlias: Map<string, HostedDocumentIds | null>,
) {
  const byRecord = new Map<T, HostedDocumentIds>();
  const recordsByDocument = new Map<string, T>();
  for (const record of records) {
    const logical = await md5(record.identity);
    const matches = [...record.aliases, record.identity]
      .map((alias) => identifiersByAlias.get(alias))
      .filter((value): value is HostedDocumentIds => value != null);
    const localIds = new Set(matches.map((match) => match.primary));
    if (localIds.size > 1) {
      throw new Error(
        `Multiple local files match the sync record ${record.identity}.`,
      );
    }
    const local = matches[0];
    const storedFingerprints = [...record.aliases, record.identity].flatMap(
      (alias) => {
        const match = alias.match(
          /^hosted-document:koreader-partial-md5-v1:([a-f0-9]{32})$/u,
        );
        return match ? [match[1]] : [];
      },
    );
    const uniqueStoredFingerprints = [...new Set(storedFingerprints)];
    if (uniqueStoredFingerprints.length > 1) {
      throw new Error(
        `Multiple hosted documents match the sync record ${record.identity}.`,
      );
    }
    const storedFingerprint = uniqueStoredFingerprints[0];
    const remoteFingerprint = record.identity.match(
      /^fingerprint:koreader-partial-md5-v1:([a-f0-9]{32})$/u,
    )?.[1];
    const identifiers =
      local ??
      (storedFingerprint != null
        ? {
            primary: storedFingerprint,
            aliases: [logical],
            fingerprintKind: "koreader-partial-md5-v1" as const,
            filename: null,
            identifiers: {},
          }
        : remoteFingerprint == null
        ? {
            primary: logical,
            aliases: [],
            fingerprintKind: "tomeio-logical-md5-v1" as const,
            filename: null,
            identifiers: {},
          }
        : {
            primary: remoteFingerprint,
            aliases: [logical],
            fingerprintKind: "koreader-partial-md5-v1" as const,
            filename: null,
            identifiers: {},
          });
    byRecord.set(record, identifiers);
    for (const identifier of [
      identifiers.primary,
      ...identifiers.aliases,
      logical,
    ]) {
      recordsByDocument.set(identifier, record);
    }
  }
  return { byRecord, recordsByDocument };
}

function collectionRecordFromHosted(
  record: HostedCollectionRecord,
  local: CollectionSyncRecord | undefined,
): CollectionSyncRecord {
  const metadata = record.documentMetadata;
  if (metadata == null || !metadata.title) {
    throw new Error(
      `Synced library item ${record.document} has no title metadata.`,
    );
  }
  const author = metadata.authors[0] ?? "Unknown";
  const semanticIdentity = bookIdentity(metadata.title, author);
  const identity =
    local?.identity ??
    (record.fingerprintKind === "koreader-partial-md5-v1"
      ? `fingerprint:koreader-partial-md5-v1:${record.document}`
      : semanticIdentity);
  return {
    identity,
    aliases: [
      ...new Set([
        ...(local?.aliases ?? []),
        semanticIdentity,
      ]),
    ],
    title: metadata.title,
    author,
    format: metadata.format ?? "",
    sourceUrl:
      metadata.identifiers?.[SOURCE_URL_IDENTIFIER] ?? local?.sourceUrl,
    addedAt: record.addedAt,
    sortAt: record.sortAt,
    updatedAt: record.updatedAt,
    ...(record.removedAt == null ? {} : { removedAt: record.removedAt }),
  };
}

async function performHostedCollectionSync(
  accountId: string,
  collection: SyncedCollection,
  remoteVersion: number,
  statusServerTime: number,
  getLocalIdentifiers: () => Promise<Map<string, HostedDocumentIds | null>>,
  notify: (progress: HostedSyncProgress) => void,
): Promise<{ imported: number; pushed: number; serverTime: number }> {
  const stream = `collection:${collection}`;
  const checkpoint = await loadCheckpoint(accountId, stream);
  const localBeforePull = await loadCollectionSyncRecords(collection);
  const localRevision = await syncRecordsRevision(localBeforePull);
  if (
    checkpoint.localRevision === localRevision &&
    checkpoint.remoteVersion === remoteVersion
  ) {
    console.info("[hosted-sync] collection version unchanged", { collection });
    return { imported: 0, pushed: 0, serverTime: statusServerTime };
  }
  notify({
    phase:
      collection === "library" ? "pulling-library" : "pulling-reading-list",
    message:
      collection === "library"
        ? "Checking library changes…"
        : "Checking reading-list changes…",
  });
  const remote = await authenticatedRequest<{
    records: HostedCollectionRecord[];
    serverTime: number;
  }>(incrementalPath(`/v1/collections/${collection}`, checkpoint.cursor));
  const windowRevision = await remoteWindowRevision(remote.records);
  const remoteIsUnchanged =
    remote.records.length === 0 ||
    checkpoint.remoteWindowRevision === windowRevision;
  if (checkpoint.localRevision === localRevision && remoteIsUnchanged) {
    console.info("[hosted-sync] collection unchanged", {
      collection,
      remote: remote.records.length,
      local: localBeforePull.length,
    });
    checkpoint.cursor = Math.max(0, remote.serverTime - 1);
    checkpoint.remoteVersion = remoteVersion;
    if (remote.records.length) checkpoint.remoteWindowRevision = windowRevision;
    await saveCheckpoint(accountId, stream, checkpoint);
    return { imported: 0, pushed: 0, serverTime: remote.serverTime };
  }
  const localIdentifiers = await getLocalIdentifiers();
  const identifiersBeforePull = await documentIds(
    localBeforePull,
    localIdentifiers,
  );
  const remoteRecords = remote.records.map((record) =>
    collectionRecordFromHosted(
      record,
      identifiersBeforePull.recordsByDocument.get(record.document),
    ),
  );
  const mergedBeforeImport = mergeCollectionSyncRecords(
    localBeforePull,
    remoteRecords,
  );
  const imported = await applyCollectionSyncRecords(
    collection,
    mergedBeforeImport,
  );
  const merged = mergeCollectionSyncRecords(
    remoteRecords,
    await loadCollectionSyncRecords(collection),
  );
  const identifiers = await documentIds(merged, localIdentifiers);
  const fingerprints = new Map<CollectionSyncRecord, string>();
  for (const record of merged) {
    const document = identifiers.byRecord.get(record);
    if (document == null)
      throw new Error(`No hosted sync identifier for ${record.identity}.`);
    fingerprints.set(
      record,
      await payloadFingerprint(document, collectionPayload(record, document)),
    );
  }
  for (const [index, hosted] of remote.records.entries()) {
    const remoteRecord = remoteRecords[index];
    const mergedRecord = matchingSyncRecord(remoteRecord, merged);
    const document = mergedRecord && identifiers.byRecord.get(mergedRecord);
    const knownHostedRecord =
      identifiersBeforePull.recordsByDocument.get(hosted.document);
    if (
      mergedRecord &&
      document &&
      (document.primary === hosted.document ||
        (knownHostedRecord != null &&
          matchingSyncRecord(knownHostedRecord, [mergedRecord]) != null)) &&
      sameCollectionSyncContent(mergedRecord, remoteRecord)
    ) {
      checkpoint.acknowledgements[document.primary] = fingerprints.get(
        mergedRecord,
      )!;
    }
  }
  const recordsToPush = merged.filter((record) => {
    const document = identifiers.byRecord.get(record)!;
    return (
      checkpoint.acknowledgements[document.primary] !== fingerprints.get(record)
    );
  });
  console.info("[hosted-sync] collection diff", {
    collection,
    remote: remote.records.length,
    local: merged.length,
    pushing: recordsToPush.length,
  });
  const phase =
    collection === "library" ? "uploading-library" : "uploading-reading-list";
  notify({
    phase,
    message:
      recordsToPush.length === 0
        ? collection === "library"
          ? "Library is up to date"
          : "Reading list is up to date"
        : collection === "library"
          ? "Uploading library changes…"
          : "Uploading reading-list changes…",
    completed: 0,
    total: recordsToPush.length,
  });
  let completed = 0;
  await uploadConcurrently(recordsToPush, async (record) => {
    const document = identifiers.byRecord.get(record);
    if (document == null) {
      throw new Error(`No hosted sync identifier for ${record.identity}.`);
    }
    await authenticatedRequest(
      `/v1/collections/${collection}/${encodeURIComponent(document.primary)}`,
      {
        method: "PUT",
        body: JSON.stringify(collectionPayload(record, document)),
      },
    );
    checkpoint.acknowledgements[document.primary] = fingerprints.get(record)!;
    completed += 1;
    notify({
      phase,
      message:
        collection === "library"
          ? "Uploading library changes…"
          : "Uploading reading-list changes…",
      completed,
      total: recordsToPush.length,
    });
  });
  // Keep a one-millisecond overlap so a concurrent write that shares the
  // response timestamp cannot fall between incremental windows.
  checkpoint.cursor = Math.max(0, remote.serverTime - 1);
  checkpoint.remoteVersion = remoteVersion;
  checkpoint.localRevision = await syncRecordsRevision(
    await loadCollectionSyncRecords(collection),
  );
  if (remote.records.length) checkpoint.remoteWindowRevision = windowRevision;
  await saveCheckpoint(accountId, stream, checkpoint);
  return {
    imported,
    pushed: recordsToPush.length,
    serverTime: remote.serverTime,
  };
}

async function performHostedProgressSync(
  accountId: string,
  notify: (progress: HostedSyncProgress) => void,
): Promise<HostedSyncResult> {
  const status = hostedSyncStatus(
    await authenticatedRequest<unknown>("/v1/sync/status"),
  );
  const checkpoint = await loadCheckpoint(accountId, "progress");
  const localBeforePull = await loadProgressSyncRecords();
  const localRevision = await syncRecordsRevision(localBeforePull);
  let localIdentifiersPromise:
    | Promise<Map<string, HostedDocumentIds | null>>
    | undefined;
  const getLocalIdentifiers = () =>
    (localIdentifiersPromise ??= localDocumentIdentifiers());
  if (
    checkpoint.localRevision === localRevision &&
    checkpoint.remoteVersion === status.versions.progress
  ) {
    console.info("[hosted-sync] progress version unchanged");
    const library = await performHostedCollectionSync(
      accountId,
      "library",
      status.versions.library,
      status.serverTime,
      getLocalIdentifiers,
      notify,
    );
    const readingList = await performHostedCollectionSync(
      accountId,
      "reading-list",
      status.versions.readingList,
      status.serverTime,
      getLocalIdentifiers,
      notify,
    );
    return {
      importedRecords: library.imported + readingList.imported,
      pushedRecords: library.pushed + readingList.pushed,
      unmatchedRecords: 0,
      syncedAt: Math.max(status.serverTime, library.serverTime, readingList.serverTime),
    };
  }
  notify({ phase: "pulling-progress", message: "Checking reading progress…" });
  const remote = await authenticatedRequest<{
    records: HostedProgressRecord[];
    serverTime: number;
  }>(incrementalPath("/v1/progress", checkpoint.cursor));
  const windowRevision = await remoteWindowRevision(remote.records);
  const remoteIsUnchanged =
    remote.records.length === 0 ||
    checkpoint.remoteWindowRevision === windowRevision;
  if (checkpoint.localRevision === localRevision && remoteIsUnchanged) {
    console.info("[hosted-sync] progress unchanged", {
      remote: remote.records.length,
      local: localBeforePull.length,
    });
    checkpoint.cursor = Math.max(0, remote.serverTime - 1);
    checkpoint.remoteVersion = status.versions.progress;
    if (remote.records.length) checkpoint.remoteWindowRevision = windowRevision;
    await saveCheckpoint(accountId, "progress", checkpoint);
    const library = await performHostedCollectionSync(
      accountId,
      "library",
      status.versions.library,
      status.serverTime,
      getLocalIdentifiers,
      notify,
    );
    const readingList = await performHostedCollectionSync(
      accountId,
      "reading-list",
      status.versions.readingList,
      status.serverTime,
      getLocalIdentifiers,
      notify,
    );
    return {
      importedRecords: library.imported + readingList.imported,
      pushedRecords: library.pushed + readingList.pushed,
      unmatchedRecords: 0,
      syncedAt: Math.max(remote.serverTime, library.serverTime, readingList.serverTime),
    };
  }
  const localIdentifiers = await getLocalIdentifiers();
  const identifiersBeforePull = await documentIds(
    localBeforePull,
    localIdentifiers,
  );
  const unmatched: HostedProgressRecord[] = [];
  const remoteComparableByDocument = new Map<string, ProgressSyncRecord>();
  const remoteRecords = remote.records.flatMap((record) => {
    const embedded = progressRecordFromHosted(record);
    const local = identifiersBeforePull.recordsByDocument.get(record.document);
    const linked = local ?? embedded;
    if (linked == null) {
      unmatched.push(record);
      return [];
    }
    const remoteBase = embedded ?? linked;
    const remoteComparable: ProgressSyncRecord = {
      ...remoteBase,
      identity: linked.identity,
      aliases: [...new Set([...linked.aliases, ...remoteBase.aliases])].sort(),
      progress: Math.max(0, Math.min(100, record.percentage * 100)),
      isRead: record.percentage >= 1 || remoteBase.isRead,
      updatedAt: record.updatedAt,
      ...(record.removedAt == null ? {} : { removedAt: record.removedAt }),
    };
    remoteComparableByDocument.set(record.document, remoteComparable);
    return [
      {
        ...remoteComparable,
        readingTimeMs: remoteComparable.readingTimeMs ?? local?.readingTimeMs,
        wordsRead: remoteComparable.wordsRead ?? local?.wordsRead,
        lastReadAt: remoteComparable.lastReadAt ?? local?.lastReadAt,
        updatedAt: record.updatedAt,
      },
    ];
  });
  const mergedBeforeImport = mergeProgressRecords(
    localBeforePull,
    remoteRecords,
  );
  notify({
    phase: "applying-progress",
    message: "Updating this device…",
    completed: 0,
    total: remoteRecords.length,
  });
  const importedRecords = await applyProgressSyncRecords(mergedBeforeImport);
  const merged = mergeProgressRecords(
    remoteRecords,
    await loadProgressSyncRecords(),
  );
  const identifiers = await documentIds(merged, localIdentifiers);
  const deviceId = await getSyncDeviceId();
  const fingerprints = new Map<ProgressSyncRecord, string>();
  for (const record of merged) {
    const document = identifiers.byRecord.get(record);
    if (document == null)
      throw new Error(`No hosted sync identifier for ${record.identity}.`);
    fingerprints.set(
      record,
      await payloadFingerprint(
        document,
        progressPayload(record, document, deviceId),
      ),
    );
  }
  for (const hosted of remote.records) {
    const remoteRecord = remoteComparableByDocument.get(hosted.document);
    if (remoteRecord == null) continue;
    const mergedRecord = matchingSyncRecord(remoteRecord, merged);
    const document = mergedRecord && identifiers.byRecord.get(mergedRecord);
    const knownHostedRecord =
      identifiersBeforePull.recordsByDocument.get(hosted.document);
    if (
      mergedRecord &&
      document &&
      (document.primary === hosted.document ||
        (knownHostedRecord != null &&
          matchingSyncRecord(knownHostedRecord, [mergedRecord]) != null)) &&
      sameProgressSyncContent(mergedRecord, remoteRecord)
    ) {
      checkpoint.acknowledgements[document.primary] = fingerprints.get(
        mergedRecord,
      )!;
    }
  }
  const recordsToPush = merged.filter((record) => {
    const document = identifiers.byRecord.get(record)!;
    return (
      checkpoint.acknowledgements[document.primary] !== fingerprints.get(record)
    );
  });
  console.info("[hosted-sync] progress diff", {
    remote: remote.records.length,
    local: merged.length,
    pushing: recordsToPush.length,
  });
  notify({
    phase: "uploading-progress",
    message:
      recordsToPush.length === 0
        ? "Reading progress is up to date"
        : "Uploading reading progress…",
    completed: 0,
    total: recordsToPush.length,
  });
  let completed = 0;
  await uploadConcurrently(recordsToPush, async (record) => {
    const document = identifiers.byRecord.get(record);
    if (document == null)
      throw new Error(`No hosted sync identifier for ${record.identity}.`);
    await authenticatedRequest(
      `/v1/progress/${encodeURIComponent(document.primary)}`,
      {
        method: "PUT",
        body: JSON.stringify(progressPayload(record, document, deviceId)),
      },
    );
    checkpoint.acknowledgements[document.primary] = fingerprints.get(record)!;
    completed += 1;
    notify({
      phase: "uploading-progress",
      message: "Uploading reading progress…",
      completed,
      total: recordsToPush.length,
    });
  });
  checkpoint.cursor = Math.max(0, remote.serverTime - 1);
  checkpoint.remoteVersion = status.versions.progress;
  checkpoint.localRevision = await syncRecordsRevision(
    await loadProgressSyncRecords(),
  );
  if (remote.records.length) checkpoint.remoteWindowRevision = windowRevision;
  await saveCheckpoint(accountId, "progress", checkpoint);
  // Progress from legacy KOReader/Moon+ accounts can be the first observation of
  // a book. Reconcile collections afterwards so that observation becomes a logical
  // library item during the same sync pass.
  const library = await performHostedCollectionSync(
    accountId,
    "library",
    status.versions.library,
    status.serverTime,
    getLocalIdentifiers,
    notify,
  );
  const readingList = await performHostedCollectionSync(
    accountId,
    "reading-list",
    status.versions.readingList,
    status.serverTime,
    getLocalIdentifiers,
    notify,
  );
  return {
    importedRecords: importedRecords + library.imported + readingList.imported,
    pushedRecords: recordsToPush.length + library.pushed + readingList.pushed,
    unmatchedRecords: unmatched.length,
    syncedAt: Math.max(remote.serverTime, library.serverTime, readingList.serverTime),
  };
}

function recordMatchesBook(
  record: SyncIdentityRecord,
  book: LibraryBook,
): boolean {
  const identity = bookIdentity(book.title, book.author);
  return (
    matchingSyncRecord(
      {
        identity,
        aliases: [...new Set([identity, ...syncAliases(book)])],
      },
      [record],
    ) != null
  );
}

async function pushHostedCollectionChanges(
  accountId: string,
  collection: SyncedCollection,
  changes: HostedSyncBookChange[],
  localIdentifiers: Map<string, HostedDocumentIds | null>,
  notify: (progress: HostedSyncProgress) => void,
): Promise<number> {
  const stream = `collection:${collection}`;
  const checkpoint = await loadCheckpoint(accountId, stream);
  const localRecords = await loadCollectionSyncRecords(collection);
  const records = localRecords.filter(
    (record) =>
      changes.some(
        (change) =>
          change.streams.includes(collection) &&
          recordMatchesBook(record, change.book),
      ),
  );
  if (records.length === 0) {
    throw new Error(`The changed book has no ${collection} sync record.`);
  }
  const identifiers = await documentIds(records, localIdentifiers);
  const prepared = await Promise.all(
    records.map(async (record) => {
      const document = identifiers.byRecord.get(record);
      if (document == null)
        throw new Error(`No hosted sync identifier for ${record.identity}.`);
      const payload = collectionPayload(record, document);
      return {
        document,
        payload,
        fingerprint: await payloadFingerprint(document, payload),
      };
    }),
  );
  const recordsToPush = prepared.filter(
    ({ document, fingerprint }) =>
      checkpoint.acknowledgements[document.primary] !== fingerprint,
  );
  const phase =
    collection === "library" ? "uploading-library" : "uploading-reading-list";
  const label = collection === "library" ? "library" : "reading list";
  notify({
    phase,
    message:
      recordsToPush.length === 0
        ? `${label[0].toUpperCase()}${label.slice(1)} is up to date`
        : `Uploading ${label} change${recordsToPush.length === 1 ? "" : "s"}…`,
    completed: 0,
    total: recordsToPush.length,
  });
  let completed = 0;
  await uploadConcurrently(
    recordsToPush,
    async ({ document, payload, fingerprint }) => {
      await authenticatedRequest(
        `/v1/collections/${collection}/${encodeURIComponent(document.primary)}`,
        { method: "PUT", body: JSON.stringify(payload) },
      );
      checkpoint.acknowledgements[document.primary] = fingerprint;
      completed += 1;
      notify({
        phase,
        message: `Uploading ${label} change${recordsToPush.length === 1 ? "" : "s"}…`,
        completed,
        total: recordsToPush.length,
      });
    },
  );
  if (checkpoint.localRevision != null) {
    checkpoint.localRevision = await syncRecordsRevision(localRecords);
  }
  await saveCheckpoint(accountId, stream, checkpoint);
  console.info("[hosted-sync] targeted collection push", {
    collection,
    pushing: recordsToPush.length,
  });
  return recordsToPush.length;
}

async function pushHostedProgressChanges(
  accountId: string,
  changes: HostedSyncBookChange[],
  localIdentifiers: Map<string, HostedDocumentIds | null>,
  notify: (progress: HostedSyncProgress) => void,
): Promise<number> {
  const checkpoint = await loadCheckpoint(accountId, "progress");
  const localRecords = await loadProgressSyncRecords();
  const records = localRecords.filter((record) =>
    changes.some(
      (change) =>
        change.streams.includes("progress") &&
        recordMatchesBook(record, change.book),
    ),
  );
  if (records.length === 0) {
    throw new Error("The changed book has no progress sync record.");
  }
  const identifiers = await documentIds(records, localIdentifiers);
  const deviceId = await getSyncDeviceId();
  const prepared = await Promise.all(
    records.map(async (record) => {
      const document = identifiers.byRecord.get(record);
      if (document == null)
        throw new Error(`No hosted sync identifier for ${record.identity}.`);
      const payload = progressPayload(record, document, deviceId);
      return {
        document,
        payload,
        fingerprint: await payloadFingerprint(document, payload),
      };
    }),
  );
  const recordsToPush = prepared.filter(
    ({ document, fingerprint }) =>
      checkpoint.acknowledgements[document.primary] !== fingerprint,
  );
  notify({
    phase: "uploading-progress",
    message:
      recordsToPush.length === 0
        ? "Reading progress is up to date"
        : `Uploading reading change${recordsToPush.length === 1 ? "" : "s"}…`,
    completed: 0,
    total: recordsToPush.length,
  });
  let completed = 0;
  await uploadConcurrently(
    recordsToPush,
    async ({ document, payload, fingerprint }) => {
      await authenticatedRequest(
        `/v1/progress/${encodeURIComponent(document.primary)}`,
        { method: "PUT", body: JSON.stringify(payload) },
      );
      checkpoint.acknowledgements[document.primary] = fingerprint;
      completed += 1;
      notify({
        phase: "uploading-progress",
        message: `Uploading reading change${recordsToPush.length === 1 ? "" : "s"}…`,
        completed,
        total: recordsToPush.length,
      });
    },
  );
  if (checkpoint.localRevision != null) {
    checkpoint.localRevision = await syncRecordsRevision(localRecords);
  }
  await saveCheckpoint(accountId, "progress", checkpoint);
  console.info("[hosted-sync] targeted progress push", {
    pushing: recordsToPush.length,
  });
  return recordsToPush.length;
}

async function performHostedBookChanges(
  accountId: string,
  changes: HostedSyncBookChange[],
  notify: (progress: HostedSyncProgress) => void,
): Promise<HostedSyncResult> {
  const localIdentifiers = await localDocumentIdentifiersForChanges(changes);
  let pushedRecords = 0;
  if (changes.some((change) => change.streams.includes("progress"))) {
    pushedRecords += await pushHostedProgressChanges(
      accountId,
      changes,
      localIdentifiers,
      notify,
    );
  }
  if (changes.some((change) => change.streams.includes("library"))) {
    pushedRecords += await pushHostedCollectionChanges(
      accountId,
      "library",
      changes,
      localIdentifiers,
      notify,
    );
  }
  if (changes.some((change) => change.streams.includes("reading-list"))) {
    pushedRecords += await pushHostedCollectionChanges(
      accountId,
      "reading-list",
      changes,
      localIdentifiers,
      notify,
    );
  }
  return {
    importedRecords: 0,
    pushedRecords,
    unmatchedRecords: 0,
    syncedAt: Date.now(),
  };
}

let pendingHostedSync: Promise<HostedSyncResult> | null = null;
let queuedHostedSync = false;
let hostedSyncSerial: Promise<void> = Promise.resolve();
const hostedSyncObservers = new Set<
  NonNullable<HostedSyncOptions["onProgress"]>
>();

function notifyHostedSync(progress: HostedSyncProgress): void {
  for (const observer of hostedSyncObservers) observer(progress);
}

function serializeHostedSync<T>(operation: () => Promise<T>): Promise<T> {
  const result = hostedSyncSerial.catch(() => {}).then(operation);
  hostedSyncSerial = result.then(
    () => {},
    () => {},
  );
  return result;
}

export function synchronizeHostedProgress(
  options: HostedSyncOptions = {},
): Promise<HostedSyncResult> {
  const observer = options.onProgress;
  if (observer) hostedSyncObservers.add(observer);
  if (pendingHostedSync != null) {
    if (options.queueAfterCurrent) queuedHostedSync = true;
    return pendingHostedSync.finally(() => {
      if (observer) hostedSyncObservers.delete(observer);
    });
  }
  const operation = serializeHostedSync(async () => {
    const account = await getHostedSyncAccount();
    if (account == null)
      throw new Error("Sign in to Tomeio Sync before synchronizing.");
    let result: HostedSyncResult = {
      importedRecords: 0,
      pushedRecords: 0,
      unmatchedRecords: 0,
      syncedAt: 0,
    };
    do {
      queuedHostedSync = false;
      const next = await performHostedProgressSync(account.id, notifyHostedSync);
      result = {
        importedRecords: result.importedRecords + next.importedRecords,
        pushedRecords: result.pushedRecords + next.pushedRecords,
        unmatchedRecords: result.unmatchedRecords + next.unmatchedRecords,
        syncedAt: Math.max(result.syncedAt, next.syncedAt),
      };
    } while (queuedHostedSync);
    return result;
  }).finally(() => {
    if (pendingHostedSync === operation) pendingHostedSync = null;
  });
  pendingHostedSync = operation;
  return operation.finally(() => {
    if (observer) hostedSyncObservers.delete(observer);
  });
}

export async function synchronizeHostedBookChangesIfEnabled(
  changes: HostedSyncBookChange[],
  options: HostedSyncOptions = {},
): Promise<HostedSyncResult | null> {
  if (changes.length === 0 || (await getHostedSyncAccount()) == null) return null;
  const notify = options.onProgress ?? (() => {});
  return serializeHostedSync(async () => {
    const account = await getHostedSyncAccount();
    if (account == null)
      throw new Error("Sign in to Tomeio Sync before synchronizing.");
    return performHostedBookChanges(account.id, changes, notify);
  });
}

export async function synchronizeHostedProgressIfEnabled(
  options: HostedSyncOptions = {},
): Promise<HostedSyncResult | null> {
  return (await getHostedSyncAccount()) == null
    ? null
    : synchronizeHostedProgress(options);
}
