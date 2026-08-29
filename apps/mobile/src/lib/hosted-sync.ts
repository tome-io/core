import * as Device from "expo-device";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import {
  applyProgressSyncRecords,
  loadProgressSyncLocalDocuments,
  loadProgressSyncRecords,
} from "./library-db";
import { koreaderPartialMd5 } from "./koreader-document";
import {
  mergeProgressRecords,
  type ProgressSyncRecord,
} from "./progress-sync-model";
import { getSyncDeviceId } from "./sync-device";
import {
  hostedAccountMetadata,
  progressRecordFromHosted,
  type HostedProgressRecord,
} from "./hosted-sync-record";

const SESSION_KEY = "tomeio.hosted-sync.session.v1";
const SERVICE_ORIGIN = (
  process.env.EXPO_PUBLIC_SYNC_URL ?? "https://sync.tomeio.app"
).replace(/\/$/u, "");

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

async function documentIds(records: ProgressSyncRecord[]) {
  const localDocuments = await loadProgressSyncLocalDocuments();
  const identifiersByAlias = new Map<string, HostedDocumentIds | null>();
  for (const local of localDocuments) {
    const logical = await md5(local.identity);
    const partial = await koreaderPartialMd5(local.uri);
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
  const byRecord = new Map<ProgressSyncRecord, HostedDocumentIds>();
  const recordsByDocument = new Map<string, ProgressSyncRecord>();
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

async function performHostedProgressSync(): Promise<HostedSyncResult> {
  const localBeforePull = await loadProgressSyncRecords();
  const identifiersBeforePull = await documentIds(localBeforePull);
  const remote = await authenticatedRequest<{
    records: HostedProgressRecord[];
    serverTime: number;
  }>("/v1/progress");
  const unmatched: HostedProgressRecord[] = [];
  const remoteRecords = remote.records.flatMap((record) => {
    const embedded = progressRecordFromHosted(record);
    const local = identifiersBeforePull.recordsByDocument.get(record.document);
    const base = local ?? embedded;
    if (base == null) {
      unmatched.push(record);
      return [];
    }
    return [
      {
        ...base,
        progress: Math.max(0, Math.min(100, record.percentage * 100)),
        isRead: record.percentage >= 1 || base.isRead,
        updatedAt: record.serverUpdatedAt,
        ...(record.removedAt == null ? {} : { removedAt: record.removedAt }),
      },
    ];
  });
  const mergedBeforeImport = mergeProgressRecords(
    localBeforePull,
    remoteRecords,
  );
  const importedRecords = await applyProgressSyncRecords(mergedBeforeImport);
  const merged = mergeProgressRecords(
    remoteRecords,
    await loadProgressSyncRecords(),
  );
  const identifiers = await documentIds(merged);
  const deviceId = await getSyncDeviceId();
  for (const record of merged) {
    const document = identifiers.byRecord.get(record);
    if (document == null)
      throw new Error(`No hosted sync identifier for ${record.identity}.`);
    await authenticatedRequest(
      `/v1/progress/${encodeURIComponent(document.primary)}`,
      {
        method: "PUT",
        body: JSON.stringify({
          percentage: record.isRead
            ? 1
            : Math.max(0, Math.min(1, record.progress / 100)),
          aliases: document.aliases,
          fingerprintKind: document.fingerprintKind,
          documentMetadata: {
            title: record.title,
            authors:
              record.author && record.author !== "Unknown"
                ? [record.author]
                : [],
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
        }),
      },
    );
  }
  return {
    importedRecords,
    pushedRecords: merged.length,
    unmatchedRecords: unmatched.length,
    syncedAt: remote.serverTime,
  };
}

let pendingHostedSync: Promise<HostedSyncResult> | null = null;

export function synchronizeHostedProgress(): Promise<HostedSyncResult> {
  if (pendingHostedSync != null) return pendingHostedSync;
  const operation = performHostedProgressSync().finally(() => {
    if (pendingHostedSync === operation) pendingHostedSync = null;
  });
  pendingHostedSync = operation;
  return operation;
}

export async function synchronizeHostedProgressIfEnabled(): Promise<HostedSyncResult | null> {
  return (await getHostedSyncAccount()) == null
    ? null
    : synchronizeHostedProgress();
}
