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
} from "./library-db";
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
}

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
    this.name = "HostedSyncError";
  }
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
  return {
    cursor: value.cursor ?? null,
    acknowledgements: value.acknowledgements,
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
      identifiers: document.identifiers,
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
    const remoteFingerprint = record.identity.match(
      /^fingerprint:koreader-partial-md5-v1:([a-f0-9]{32})$/u,
    )?.[1];
    const identifiers =
      local ??
      (remoteFingerprint == null
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
    addedAt: record.addedAt,
    sortAt: record.sortAt,
    updatedAt: record.updatedAt,
    ...(record.removedAt == null ? {} : { removedAt: record.removedAt }),
  };
}

async function performHostedCollectionSync(
  accountId: string,
  collection: SyncedCollection,
  localIdentifiers: Map<string, HostedDocumentIds | null>,
  notify: (progress: HostedSyncProgress) => void,
): Promise<{ imported: number; pushed: number; serverTime: number }> {
  const stream = `collection:${collection}`;
  const checkpoint = await loadCheckpoint(accountId, stream);
  notify({
    phase:
      collection === "library" ? "pulling-library" : "pulling-reading-list",
    message:
      collection === "library"
        ? "Checking library changes…"
        : "Checking reading-list changes…",
  });
  const localBeforePull = await loadCollectionSyncRecords(collection);
  const identifiersBeforePull = await documentIds(
    localBeforePull,
    localIdentifiers,
  );
  const remote = await authenticatedRequest<{
    records: HostedCollectionRecord[];
    serverTime: number;
  }>(incrementalPath(`/v1/collections/${collection}`, checkpoint.cursor));
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
  const checkpoint = await loadCheckpoint(accountId, "progress");
  notify({ phase: "pulling-progress", message: "Checking reading progress…" });
  const localIdentifiers = await localDocumentIdentifiers();
  const localBeforePull = await loadProgressSyncRecords();
  const identifiersBeforePull = await documentIds(
    localBeforePull,
    localIdentifiers,
  );
  const remote = await authenticatedRequest<{
    records: HostedProgressRecord[];
    serverTime: number;
  }>(incrementalPath("/v1/progress", checkpoint.cursor));
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
        updatedAt: record.serverUpdatedAt,
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
  await saveCheckpoint(accountId, "progress", checkpoint);
  // Progress from legacy KOReader/Moon+ accounts can be the first observation of
  // a book. Reconcile collections afterwards so that observation becomes a logical
  // library item during the same sync pass.
  const library = await performHostedCollectionSync(
    accountId,
    "library",
    localIdentifiers,
    notify,
  );
  const readingList = await performHostedCollectionSync(
    accountId,
    "reading-list",
    localIdentifiers,
    notify,
  );
  return {
    importedRecords: importedRecords + library.imported + readingList.imported,
    pushedRecords: recordsToPush.length + library.pushed + readingList.pushed,
    unmatchedRecords: unmatched.length,
    syncedAt: Math.max(remote.serverTime, library.serverTime, readingList.serverTime),
  };
}

let pendingHostedSync: Promise<HostedSyncResult> | null = null;
const hostedSyncObservers = new Set<
  NonNullable<HostedSyncOptions["onProgress"]>
>();

function notifyHostedSync(progress: HostedSyncProgress): void {
  for (const observer of hostedSyncObservers) observer(progress);
}

export function synchronizeHostedProgress(
  options: HostedSyncOptions = {},
): Promise<HostedSyncResult> {
  const observer = options.onProgress;
  if (observer) hostedSyncObservers.add(observer);
  if (pendingHostedSync != null) {
    return pendingHostedSync.finally(() => {
      if (observer) hostedSyncObservers.delete(observer);
    });
  }
  const operation = (async () => {
    const account = await getHostedSyncAccount();
    if (account == null)
      throw new Error("Sign in to Tomeio Sync before synchronizing.");
    return performHostedProgressSync(account.id, notifyHostedSync);
  })().finally(() => {
    if (pendingHostedSync === operation) pendingHostedSync = null;
  });
  pendingHostedSync = operation;
  return operation.finally(() => {
    if (observer) hostedSyncObservers.delete(observer);
  });
}

export async function synchronizeHostedProgressIfEnabled(
  options: HostedSyncOptions = {},
): Promise<HostedSyncResult | null> {
  return (await getHostedSyncAccount()) == null
    ? null
    : synchronizeHostedProgress(options);
}
