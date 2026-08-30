import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

import { bookIdentity } from "./book-metadata";
import {
  resolveBookCover,
  type BookCoverPreference,
  type BookCoverSources,
} from "./book-cover";
import type { LibraryBook, LibraryState } from "./library";
import {
  isCollectionRecordRemoved,
  mergeCollectionSyncRecords,
  type CollectionSyncRecord,
  type SyncedCollection,
} from "./library-sync-model";
import {
  isProgressRecordRemoved,
  mergeProgressRecords,
  type ProgressSyncRecord,
} from "./progress-sync-model";

const DATABASE_NAME = "reader-library.db";
const LEGACY_LIBRARY_KEY = "reader_library_v1";
const LEGACY_MIGRATION_KEY = "legacy_library_v1_imported";
const LEGACY_PROGRESS_MIGRATION_KEY = "legacy_library_progress_v2_imported";

export type MetadataSource = "catalog" | "embedded" | "filename" | "moonreader";

interface CatalogRow {
  book_json: string;
}

interface ProgressTombstoneRow {
  record_json: string;
}

interface CollectionSyncRow extends CatalogRow {
  book_key: string;
  sync_identity: string | null;
  sync_record_json: string | null;
  catalog_updated_at: number;
  source_sort_at: number;
}

interface StoredCollectionSyncRow {
  identity: string;
  book_key: string | null;
  record_json: string;
}

interface ProgressCatalogRow extends CatalogRow {
  progress: number | null;
  is_read: number | null;
  reading_time_ms: number | null;
  words_read: number | null;
  last_read_at: number | null;
  progress_synced_at: number | null;
  moonreader_json: string | null;
  override_is_read: number | null;
}

interface LocalCatalogRow extends ProgressCatalogRow {
  uri: string;
  fingerprint: string;
  embedded_json: string | null;
}

interface ProgressSnapshotRow extends ProgressCatalogRow {
  book_key: string;
  sync_identity: string | null;
  override_updated_at: number | null;
}

interface LibraryDatabaseState {
  promise: Promise<SQLiteDatabase> | null;
  writeQueue: Promise<void>;
}

interface LibraryDatabaseGlobal {
  __tomeioLibraryDatabaseState?: LibraryDatabaseState;
}

const databaseState = ((
  globalThis as unknown as LibraryDatabaseGlobal
).__tomeioLibraryDatabaseState ??= {
  promise: null,
  writeQueue: Promise.resolve(),
});

function parseBook(value: string): LibraryBook {
  const parsed = JSON.parse(value);
  if (typeof parsed?.key !== "string" || typeof parsed?.title !== "string") {
    throw new Error("A stored library book is invalid.");
  }
  return parsed as LibraryBook;
}

async function withValidGeneratedCover(
  book: LibraryBook,
): Promise<LibraryBook> {
  const generatedCover = (uri?: string) =>
    !!uri?.startsWith("file:") && uri.includes("/library-covers/");
  const invalidCatalogCover = (uri?: string) =>
    !!uri?.includes("covers.openlibrary.org/b/isbn/");
  let localCover = book.coverSources?.local;
  let missingGeneratedCover = false;
  if (generatedCover(localCover)) {
    const info = await FileSystem.getInfoAsync(localCover!);
    if (!info.exists) {
      localCover = undefined;
      missingGeneratedCover = true;
    }
  }
  let currentCover = book.cover;
  if (generatedCover(currentCover) && currentCover !== localCover) {
    const info = await FileSystem.getInfoAsync(currentCover);
    if (!info.exists) {
      currentCover = "";
      missingGeneratedCover = true;
    }
  }
  const catalogCover = invalidCatalogCover(book.coverSources?.catalog)
    ? undefined
    : book.coverSources?.catalog;
  const invalidLegacyCatalogCover = invalidCatalogCover(currentCover);
  if (
    !missingGeneratedCover &&
    !invalidLegacyCatalogCover &&
    localCover === book.coverSources?.local &&
    catalogCover === book.coverSources?.catalog
  ) {
    return book;
  }
  const coverSources: BookCoverSources = {
    ...(book.coverSources?.providers
      ? { providers: book.coverSources.providers }
      : {}),
    ...(localCover ? { local: localCover } : {}),
    ...(catalogCover ? { catalog: catalogCover } : {}),
  };
  const resolved = resolveBookCover(coverSources, book.coverPreference, [
    book.fallbackCover,
    book.moonReader?.detailCoverUri,
    book.moonReader?.coverUri,
    invalidLegacyCatalogCover ? undefined : currentCover,
  ]);
  return {
    ...book,
    coverSources,
    cover: resolved.cover,
    fallbackCover: resolved.fallbackCover,
    metadataPending: true,
    metadataUpdatedAt: undefined,
    metadataVersion: undefined,
  };
}

function fingerprint(book: LibraryBook): string {
  return book.local
    ? `${book.local.size || 0}:${book.local.modificationTime || 0}`
    : "";
}

function withoutProgressData(book: LibraryBook): LibraryBook {
  const cleaned = { ...book };
  delete cleaned.progress;
  delete cleaned.isRead;
  delete cleaned.readingTimeMs;
  delete cleaned.wordsRead;
  delete cleaned.lastReadAt;
  return cleaned;
}

function withoutMoonReaderData(book: LibraryBook): LibraryBook {
  const cleaned = withoutProgressData(book);
  delete cleaned.moonReader;
  return cleaned;
}

async function upsertBook(
  database: SQLiteDatabase,
  book: LibraryBook,
): Promise<void> {
  await database.runAsync(
    `INSERT INTO catalog_books (book_key, file_uri, book_json, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(book_key) DO UPDATE SET
       file_uri = excluded.file_uri,
       book_json = excluded.book_json,
       updated_at = excluded.updated_at`,
    book.key,
    book.fileUri ?? null,
    JSON.stringify(book),
    Date.now(),
  );
}

function preserveStoredCoverPreference(
  existing: LibraryBook | undefined,
  incoming: LibraryBook,
): LibraryBook {
  // Metadata enrichment is asynchronous. A picker choice saved while it is in
  // flight must win over the older book snapshot that enrichment later writes.
  if (!existing?.coverPreference) return incoming;
  const existingPreferenceUpdatedAt = existing.coverPreferenceUpdatedAt ?? 0;
  const incomingPreferenceUpdatedAt = incoming.coverPreferenceUpdatedAt ?? 0;
  const shouldPreserve =
    existing.coverPreference !== "auto" ||
    existingPreferenceUpdatedAt > incomingPreferenceUpdatedAt;
  if (!shouldPreserve) return incoming;

  const providers = {
    ...existing.coverSources?.providers,
    ...incoming.coverSources?.providers,
  };
  const coverSources = {
    local: incoming.coverSources?.local ?? existing.coverSources?.local,
    catalog: incoming.coverSources?.catalog ?? existing.coverSources?.catalog,
    ...(Object.keys(providers).length ? { providers } : {}),
  };
  if (existing.coverPreference === "local" && existing.coverSources?.local) {
    coverSources.local = existing.coverSources.local;
  } else if (
    existing.coverPreference === "catalog" &&
    existing.coverSources?.catalog
  ) {
    coverSources.catalog = existing.coverSources.catalog;
  } else if (existing.coverPreference.startsWith("provider:")) {
    const providerId = existing.coverPreference.slice("provider:".length);
    const selectedCover = existing.coverSources?.providers?.[providerId];
    if (selectedCover) {
      coverSources.providers = {
        ...coverSources.providers,
        [providerId]: selectedCover,
      };
    }
  }
  const resolved = resolveBookCover(coverSources, existing.coverPreference, [
    existing.cover,
    existing.fallbackCover,
    incoming.cover,
    incoming.fallbackCover,
  ]);
  return {
    ...incoming,
    cover: resolved.cover,
    fallbackCover: resolved.fallbackCover,
    coverSources,
    coverPreference: existing.coverPreference,
    coverPreferenceUpdatedAt: existing.coverPreferenceUpdatedAt,
  };
}

async function migrateLegacyLibrary(database: SQLiteDatabase): Promise<void> {
  const migrated = await database.getFirstAsync<{ value: string }>(
    "SELECT value FROM library_meta WHERE key = ?",
    LEGACY_MIGRATION_KEY,
  );
  if (migrated) return;

  const raw = await AsyncStorage.getItem(LEGACY_LIBRARY_KEY);
  let legacy: LibraryState | null = null;
  if (raw) {
    const parsed = JSON.parse(raw);
    if (
      !Array.isArray(parsed?.downloaded) ||
      !Array.isArray(parsed?.readingList)
    ) {
      throw new Error(
        "Legacy library data is invalid and could not be imported.",
      );
    }
    legacy = parsed as LibraryState;
  }

  await database.withExclusiveTransactionAsync(async (transaction) => {
    if (legacy) {
      const canonicalBooks = new Map<string, LibraryBook>();
      for (const book of [...legacy.readingList, ...legacy.downloaded]) {
        const existing = canonicalBooks.get(book.key);
        canonicalBooks.set(
          book.key,
          existing ? { ...existing, ...book } : book,
        );
      }
      for (const book of canonicalBooks.values())
        await upsertBook(transaction, book);

      for (const [collection, books] of [
        ["downloaded", legacy.downloaded],
        ["reading_list", legacy.readingList],
      ] as const) {
        for (const book of books) {
          await transaction.runAsync(
            `INSERT OR REPLACE INTO collections (collection, book_key, sort_at)
             VALUES (?, ?, ?)`,
            collection,
            book.key,
            collection === "downloaded"
              ? (book.downloadedAt ?? book.addedAt ?? Date.now())
              : (book.addedAt ?? Date.now()),
          );
        }
      }
    }
    await transaction.runAsync(
      "INSERT INTO library_meta (key, value) VALUES (?, ?)",
      LEGACY_MIGRATION_KEY,
      String(Date.now()),
    );
  });
}

async function migrateLegacyProgress(database: SQLiteDatabase): Promise<void> {
  const migrated = await database.getFirstAsync<{ value: string }>(
    "SELECT value FROM library_meta WHERE key = ?",
    LEGACY_PROGRESS_MIGRATION_KEY,
  );
  if (migrated) return;

  const rows = await database.getAllAsync<{
    book_key: string;
    book_json: string;
    updated_at: number;
  }>("SELECT book_key, book_json, updated_at FROM catalog_books");

  await database.withExclusiveTransactionAsync(async (transaction) => {
    for (const row of rows) {
      const book = parseBook(row.book_json);
      if (typeof book.progress !== "number" && !book.isRead) continue;
      const syncedAt = Math.max(
        book.lastReadAt ?? 0,
        book.addedAt ?? 0,
        row.updated_at,
      );
      await upsertReadingProgress(transaction, book, "legacy", syncedAt);
      await transaction.runAsync(
        "UPDATE catalog_books SET book_json = ?, updated_at = ? WHERE book_key = ?",
        JSON.stringify(withoutProgressData(book)),
        Date.now(),
        row.book_key,
      );
    }
    await transaction.runAsync(
      "INSERT INTO library_meta (key, value) VALUES (?, ?)",
      LEGACY_PROGRESS_MIGRATION_KEY,
      String(Date.now()),
    );
  });
}

async function initializeDatabase(): Promise<SQLiteDatabase> {
  const database = await openDatabaseAsync(DATABASE_NAME);
  await database.execAsync(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS catalog_books (
      book_key TEXT PRIMARY KEY NOT NULL,
      file_uri TEXT,
      book_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS catalog_books_file_uri ON catalog_books(file_uri);

    CREATE TABLE IF NOT EXISTS collections (
      collection TEXT NOT NULL,
      book_key TEXT NOT NULL REFERENCES catalog_books(book_key) ON DELETE CASCADE,
      sort_at INTEGER NOT NULL,
      PRIMARY KEY (collection, book_key)
    );
    CREATE INDEX IF NOT EXISTS collections_order ON collections(collection, sort_at DESC);

    CREATE TABLE IF NOT EXISTS local_files (
      uri TEXT PRIMARY KEY NOT NULL,
      book_key TEXT NOT NULL UNIQUE REFERENCES catalog_books(book_key) ON DELETE CASCADE,
      directory_key TEXT NOT NULL,
      filename TEXT NOT NULL,
      format TEXT NOT NULL,
      size INTEGER NOT NULL,
      modification_time INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      seen_token TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS local_files_directory ON local_files(directory_key);

    CREATE TABLE IF NOT EXISTS moonreader_items (
      source_key TEXT NOT NULL,
      filename TEXT NOT NULL,
      book_key TEXT NOT NULL REFERENCES catalog_books(book_key) ON DELETE CASCADE,
      sort_at INTEGER NOT NULL,
      PRIMARY KEY (source_key, filename)
    );
    CREATE INDEX IF NOT EXISTS moonreader_items_source ON moonreader_items(source_key, sort_at DESC);

    CREATE TABLE IF NOT EXISTS progress_sync_items (
      identity TEXT PRIMARY KEY NOT NULL,
      book_key TEXT NOT NULL UNIQUE REFERENCES catalog_books(book_key) ON DELETE CASCADE,
      sort_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS progress_sync_items_order ON progress_sync_items(sort_at DESC);

    CREATE TABLE IF NOT EXISTS progress_sync_tombstones (
      identity TEXT PRIMARY KEY NOT NULL,
      record_json TEXT NOT NULL,
      removed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS collection_sync_records (
      collection TEXT NOT NULL CHECK (collection IN ('library', 'reading-list')),
      identity TEXT NOT NULL,
      book_key TEXT REFERENCES catalog_books(book_key) ON DELETE SET NULL,
      record_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      removed_at INTEGER,
      PRIMARY KEY (collection, identity)
    );
    CREATE INDEX IF NOT EXISTS collection_sync_records_book
      ON collection_sync_records(collection, book_key);

    CREATE TABLE IF NOT EXISTS metadata_sources (
      book_key TEXT NOT NULL REFERENCES catalog_books(book_key) ON DELETE CASCADE,
      source TEXT NOT NULL,
      fingerprint TEXT,
      payload_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (book_key, source)
    );

    CREATE TABLE IF NOT EXISTS reading_progress (
      book_key TEXT PRIMARY KEY NOT NULL REFERENCES catalog_books(book_key) ON DELETE CASCADE,
      source TEXT NOT NULL,
      progress REAL NOT NULL,
      is_read INTEGER NOT NULL,
      reading_time_ms INTEGER,
      words_read INTEGER,
      last_read_at INTEGER,
      synced_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reading_overrides (
      book_key TEXT PRIMARY KEY NOT NULL REFERENCES catalog_books(book_key) ON DELETE CASCADE,
      is_read INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      source_key TEXT PRIMARY KEY NOT NULL,
      fingerprint TEXT NOT NULL,
      synced_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_cache (
      cache_key TEXT PRIMARY KEY NOT NULL,
      payload_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS content_cache_expiry ON content_cache(expires_at);

    CREATE TABLE IF NOT EXISTS library_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    PRAGMA user_version = 6;
  `);
  await migrateLegacyLibrary(database);
  await migrateLegacyProgress(database);
  await database.runAsync(
    "DELETE FROM content_cache WHERE expires_at <= ?",
    Date.now(),
  );
  return database;
}

export function getLibraryDatabase(): Promise<SQLiteDatabase> {
  databaseState.promise ??= initializeDatabase().catch((error) => {
    databaseState.promise = null;
    throw error;
  });
  return databaseState.promise;
}

function withDatabaseWrite<T>(
  task: (database: SQLiteDatabase) => Promise<T>,
): Promise<T> {
  const operation = databaseState.writeQueue.then(async () =>
    task(await getLibraryDatabase()),
  );
  databaseState.writeQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

async function loadCollection(collection: string): Promise<LibraryBook[]> {
  const database = await getLibraryDatabase();
  const rows = await database.getAllAsync<ProgressCatalogRow>(
    `SELECT books.book_json,
            progress.progress, progress.is_read, progress.reading_time_ms,
            progress.words_read, progress.last_read_at,
            progress.synced_at AS progress_synced_at,
            NULL AS moonreader_json,
            manual.is_read AS override_is_read
     FROM collections
     JOIN catalog_books AS books ON books.book_key = collections.book_key
     LEFT JOIN reading_progress AS progress ON progress.book_key = books.book_key
     LEFT JOIN reading_overrides AS manual ON manual.book_key = books.book_key
     WHERE collections.collection = ?
     ORDER BY collections.sort_at DESC`,
    collection,
  );
  return Promise.all(
    rows.map((row) => withValidGeneratedCover(withProgress(row))),
  );
}

export async function loadPersistedLibrary(): Promise<LibraryState> {
  const [downloaded, readingList] = await Promise.all([
    loadCollection("downloaded"),
    loadCollection("reading_list"),
  ]);
  return { downloaded, readingList };
}

export async function savePersistedLibrary(state: LibraryState): Promise<void> {
  await withDatabaseWrite(async (database) => {
    const canonicalBooks = new Map<string, LibraryBook>();
    for (const book of [...state.readingList, ...state.downloaded]) {
      const existing = canonicalBooks.get(book.key);
      canonicalBooks.set(book.key, existing ? { ...existing, ...book } : book);
    }
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        "DELETE FROM collections WHERE collection IN ('downloaded', 'reading_list')",
      );
      for (const book of canonicalBooks.values()) {
        const local = await transaction.getFirstAsync<{ present: number }>(
          "SELECT 1 AS present FROM local_files WHERE book_key = ?",
          book.key,
        );
        if (!local) await upsertBook(transaction, withoutProgressData(book));
      }
      for (const [collection, books] of [
        ["downloaded", state.downloaded],
        ["reading_list", state.readingList],
      ] as const) {
        for (const book of books) {
          await transaction.runAsync(
            "INSERT INTO collections (collection, book_key, sort_at) VALUES (?, ?, ?)",
            collection,
            book.key,
            collection === "downloaded"
              ? (book.downloadedAt ?? book.addedAt ?? Date.now())
              : (book.addedAt ?? Date.now()),
          );
        }
      }
      await transaction.runAsync(`
      DELETE FROM catalog_books
      WHERE book_key NOT IN (SELECT book_key FROM collections)
        AND book_key NOT IN (SELECT book_key FROM local_files)
        AND book_key NOT IN (SELECT book_key FROM moonreader_items)
        AND book_key NOT IN (SELECT book_key FROM progress_sync_items)
    `);
    });
  });
}

function withProgress(row: ProgressCatalogRow): LibraryBook {
  const book = withoutMoonReaderData(parseBook(row.book_json));
  const moonReader = row.moonreader_json
    ? (JSON.parse(row.moonreader_json) as LibraryBook["moonReader"])
    : undefined;
  const manuallyRead = row.override_is_read === 1;
  if (row.progress == null) {
    return {
      ...book,
      ...(moonReader ? { moonReader } : {}),
      ...(manuallyRead ? { isRead: true, progress: 100 } : {}),
    };
  }
  return {
    ...book,
    progress: manuallyRead ? 100 : row.progress,
    isRead: manuallyRead || row.is_read === 1,
    readingTimeMs: row.reading_time_ms ?? undefined,
    wordsRead: row.words_read ?? undefined,
    lastReadAt: row.last_read_at ?? undefined,
    moonReader: moonReader ?? {
      syncedAt: row.progress_synced_at ?? Date.now(),
    },
  };
}

function withStoredLocalMetadata(row: LocalCatalogRow): LibraryBook {
  const book = withProgress(row);
  if (!row.embedded_json) return book;
  const embedded = JSON.parse(row.embedded_json) as { cover?: unknown };
  if (typeof embedded.cover !== "string" || !embedded.cover) return book;
  const coverSources = { ...book.coverSources, local: embedded.cover };
  const resolved = resolveBookCover(coverSources, book.coverPreference, [
    book.moonReader?.detailCoverUri,
    book.moonReader?.coverUri,
    book.cover,
    book.fallbackCover,
  ]);
  return {
    ...book,
    coverSources,
    cover: resolved.cover,
    fallbackCover: resolved.fallbackCover,
  };
}

export async function loadLocalCatalog(
  directoryKey: string,
): Promise<LibraryBook[]> {
  const database = await getLibraryDatabase();
  const rows = await database.getAllAsync<LocalCatalogRow>(
    `SELECT files.uri, files.fingerprint, books.book_json,
            progress.progress, progress.is_read, progress.reading_time_ms,
            progress.words_read, progress.last_read_at,
            progress.synced_at AS progress_synced_at,
            moon.payload_json AS moonreader_json,
            embedded.payload_json AS embedded_json,
            manual.is_read AS override_is_read
     FROM local_files AS files
     JOIN catalog_books AS books ON books.book_key = files.book_key
     LEFT JOIN reading_progress AS progress ON progress.book_key = files.book_key
     LEFT JOIN metadata_sources AS moon
       ON moon.book_key = files.book_key AND moon.source = 'moonreader'
     LEFT JOIN metadata_sources AS embedded
       ON embedded.book_key = files.book_key AND embedded.source = 'embedded'
     LEFT JOIN reading_overrides AS manual ON manual.book_key = files.book_key
     WHERE files.directory_key = ?
     ORDER BY files.modification_time DESC`,
    directoryKey,
  );
  return Promise.all(
    rows.map((row) => withValidGeneratedCover(withStoredLocalMetadata(row))),
  );
}

export async function loadMoonReaderCatalog(
  sourceKey: string,
): Promise<LibraryBook[]> {
  const database = await getLibraryDatabase();
  const rows = await database.getAllAsync<ProgressCatalogRow>(
    `SELECT books.book_json,
            progress.progress, progress.is_read, progress.reading_time_ms,
            progress.words_read, progress.last_read_at,
            progress.synced_at AS progress_synced_at,
            source.payload_json AS moonreader_json,
            manual.is_read AS override_is_read
     FROM moonreader_items AS moon
     JOIN catalog_books AS books ON books.book_key = moon.book_key
     LEFT JOIN reading_progress AS progress ON progress.book_key = moon.book_key
     LEFT JOIN metadata_sources AS source
       ON source.book_key = moon.book_key AND source.source = 'moonreader'
     LEFT JOIN reading_overrides AS manual ON manual.book_key = moon.book_key
     WHERE moon.source_key = ?
     ORDER BY moon.sort_at DESC`,
    sourceKey,
  );
  const tombstones = await loadProgressTombstones(database);
  const removedAtByAlias = new Map<string, number>();
  for (const record of tombstones) {
    if (!isProgressRecordRemoved(record)) continue;
    const removedAt = record.removedAt ?? 0;
    for (const alias of [record.identity, ...record.aliases]) {
      removedAtByAlias.set(
        alias,
        Math.max(removedAtByAlias.get(alias) ?? 0, removedAt),
      );
    }
  }
  const books = rows.map(withProgress).filter((book) => {
    const activityAt = Math.max(book.lastReadAt ?? 0, book.addedAt ?? 0);
    return ![bookIdentity(book.title, book.author), ...syncAliases(book)].some(
      (alias) => (removedAtByAlias.get(alias) ?? 0) >= activityAt,
    );
  });
  return Promise.all(books.map(withValidGeneratedCover));
}

export async function loadProgressSyncCatalog(): Promise<LibraryBook[]> {
  const database = await getLibraryDatabase();
  const rows = await database.getAllAsync<ProgressCatalogRow>(
    `SELECT books.book_json,
            progress.progress, progress.is_read, progress.reading_time_ms,
            progress.words_read, progress.last_read_at,
            progress.synced_at AS progress_synced_at,
            NULL AS moonreader_json,
            manual.is_read AS override_is_read
     FROM progress_sync_items AS synced
     JOIN catalog_books AS books ON books.book_key = synced.book_key
     LEFT JOIN reading_progress AS progress ON progress.book_key = synced.book_key
     LEFT JOIN reading_overrides AS manual ON manual.book_key = synced.book_key
     ORDER BY synced.sort_at DESC`,
  );
  return Promise.all(
    rows.map(async (row) => {
      const book = withProgress(row);
      return withValidGeneratedCover({
        ...book,
        moonReader: {
          ...book.moonReader,
          availableLocally: false,
          syncedAt:
            book.moonReader?.syncedAt ?? row.progress_synced_at ?? Date.now(),
        },
      });
    }),
  );
}

export async function loadLocalCatalogBook(
  bookKey: string | null,
  fileUri: string | null,
): Promise<LibraryBook | null> {
  if (!bookKey && !fileUri) return null;
  const database = await getLibraryDatabase();
  const row = await database.getFirstAsync<LocalCatalogRow>(
    `SELECT files.uri, files.fingerprint, books.book_json,
            progress.progress, progress.is_read, progress.reading_time_ms,
            progress.words_read, progress.last_read_at,
            progress.synced_at AS progress_synced_at,
            moon.payload_json AS moonreader_json,
            embedded.payload_json AS embedded_json,
            manual.is_read AS override_is_read
     FROM local_files AS files
     JOIN catalog_books AS books ON books.book_key = files.book_key
     LEFT JOIN reading_progress AS progress ON progress.book_key = files.book_key
     LEFT JOIN metadata_sources AS moon
       ON moon.book_key = files.book_key AND moon.source = 'moonreader'
     LEFT JOIN metadata_sources AS embedded
       ON embedded.book_key = files.book_key AND embedded.source = 'embedded'
     LEFT JOIN reading_overrides AS manual ON manual.book_key = files.book_key
     WHERE books.book_key = ? OR files.uri = ?
     LIMIT 1`,
    bookKey,
    fileUri,
  );
  return row ? withValidGeneratedCover(withStoredLocalMetadata(row)) : null;
}

function mergeScannedBook(
  existing: LibraryBook | undefined,
  scanned: LibraryBook,
): LibraryBook {
  if (!existing) return scanned;
  const catalogBook = withoutMoonReaderData(existing);
  const catalogCoverIsLegacyIsbn = catalogBook.cover?.includes(
    "covers.openlibrary.org/b/isbn/",
  );
  return {
    ...catalogBook,
    key: catalogBook.key,
    id: catalogBook.id,
    fileUri: scanned.fileUri,
    format: scanned.format,
    size: scanned.size,
    downloadedAt: scanned.downloadedAt,
    availableLocally: true,
    local: scanned.local,
    cover: catalogCoverIsLegacyIsbn
      ? scanned.cover
      : catalogBook.cover || scanned.cover,
    fallbackCover: scanned.fallbackCover || catalogBook.fallbackCover,
  };
}

export async function reconcileLocalCatalog(
  directoryKey: string,
  scannedBooks: LibraryBook[],
): Promise<LibraryBook[]> {
  return withDatabaseWrite(async (database) => {
    const existingRows = await database.getAllAsync<{
      uri: string;
      fingerprint: string;
      book_json: string;
    }>(
      `SELECT files.uri, files.fingerprint, books.book_json
     FROM local_files AS files
     JOIN catalog_books AS books ON books.book_key = files.book_key
     WHERE files.directory_key = ?`,
      directoryKey,
    );
    const catalogRows = await database.getAllAsync<{
      file_uri: string;
      book_json: string;
    }>(
      "SELECT file_uri, book_json FROM catalog_books WHERE file_uri IS NOT NULL",
    );
    const existingFiles = new Map<
      string,
      { fingerprint: string; book: LibraryBook }
    >();
    const validatedExistingRows = await Promise.all(
      existingRows.map(async (row) => ({
        row,
        book: await withValidGeneratedCover(parseBook(row.book_json)),
      })),
    );
    for (const { row, book } of validatedExistingRows) {
      existingFiles.set(row.uri, {
        fingerprint: row.fingerprint,
        book,
      });
    }
    const existingByUri = new Map<string, LibraryBook>();
    const validatedCatalogRows = await Promise.all(
      catalogRows.map(async (row) => ({
        row,
        book: await withValidGeneratedCover(parseBook(row.book_json)),
      })),
    );
    for (const { row, book } of validatedCatalogRows) {
      existingByUri.set(row.file_uri, book);
    }
    const scannedByUri = new Map(
      scannedBooks.map((book) => [book.local!.uri, book]),
    );
    const seenToken = `${Date.now()}:${Math.random().toString(36).slice(2)}`;

    const merged = scannedBooks.map((scanned) => {
      const uri = scanned.local!.uri;
      const existingFile = existingFiles.get(uri);
      const existing = existingFile
        ? existingFile.book
        : existingByUri.get(uri);
      const unchanged = existingFile?.fingerprint === fingerprint(scanned);
      if (!existing) return scanned;
      const mergedBook = mergeScannedBook(existing, scanned);
      return unchanged
        ? mergedBook
        : {
            ...mergedBook,
            metadataPending: true,
            metadataUpdatedAt: undefined,
          };
    });

    await database.withExclusiveTransactionAsync(async (transaction) => {
      for (const book of merged) {
        const scanned = scannedByUri.get(book.local!.uri)!;
        await upsertBook(transaction, book);
        await transaction.runAsync(
          `INSERT INTO local_files (
           uri, book_key, directory_key, filename, format, size,
           modification_time, fingerprint, seen_token, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(uri) DO UPDATE SET
           book_key = excluded.book_key,
           directory_key = excluded.directory_key,
           filename = excluded.filename,
           format = excluded.format,
           size = excluded.size,
           modification_time = excluded.modification_time,
           fingerprint = excluded.fingerprint,
           seen_token = excluded.seen_token,
           updated_at = excluded.updated_at`,
          book.local!.uri,
          book.key,
          directoryKey,
          book.local!.filename,
          book.local!.format,
          book.local!.size,
          book.local!.modificationTime || 0,
          fingerprint(book),
          seenToken,
          Date.now(),
        );
        await transaction.runAsync(
          `INSERT INTO metadata_sources (book_key, source, fingerprint, payload_json, updated_at)
         VALUES (?, 'filename', ?, ?, ?)
         ON CONFLICT(book_key, source) DO UPDATE SET
           fingerprint = excluded.fingerprint,
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`,
          book.key,
          fingerprint(book),
          JSON.stringify({
            title: scanned.title,
            author: scanned.author,
            filename: scanned.local!.filename,
          }),
          Date.now(),
        );
      }

      const removed = await transaction.getAllAsync<{ book_key: string }>(
        `SELECT DISTINCT book_key
         FROM local_files
         WHERE directory_key != ? OR seen_token != ?`,
        directoryKey,
        seenToken,
      );
      await transaction.runAsync(
        "DELETE FROM local_files WHERE directory_key != ? OR seen_token != ?",
        directoryKey,
        seenToken,
      );
      for (const { book_key: bookKey } of removed) {
        await transaction.runAsync(
          `DELETE FROM catalog_books
         WHERE book_key = ?
           AND book_key NOT IN (SELECT book_key FROM collections)
           AND book_key NOT IN (SELECT book_key FROM local_files)
           AND book_key NOT IN (SELECT book_key FROM moonreader_items)
           AND book_key NOT IN (SELECT book_key FROM progress_sync_items)`,
          bookKey,
        );
      }
    });

    return merged;
  });
}

async function persistLocalBookRecord(
  database: SQLiteDatabase,
  directoryKey: string,
  book: LibraryBook,
): Promise<LibraryBook> {
  if (!book.local)
    throw new Error("Only local books can be stored in the local catalog.");
  const row = await database.getFirstAsync<CatalogRow>(
    "SELECT book_json FROM catalog_books WHERE book_key = ?",
    book.key,
  );
  const persisted = preserveStoredCoverPreference(
    row ? parseBook(row.book_json) : undefined,
    book,
  );
  await upsertBook(database, persisted);
  await database.runAsync(
    `INSERT INTO local_files (
       uri, book_key, directory_key, filename, format, size,
       modification_time, fingerprint, seen_token, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       book_key = excluded.book_key,
       directory_key = excluded.directory_key,
       filename = excluded.filename,
       format = excluded.format,
       size = excluded.size,
       modification_time = excluded.modification_time,
       fingerprint = excluded.fingerprint,
       updated_at = excluded.updated_at`,
    persisted.local!.uri,
    persisted.key,
    directoryKey,
    persisted.local!.filename,
    persisted.local!.format,
    persisted.local!.size,
    persisted.local!.modificationTime || 0,
    fingerprint(persisted),
    String(Date.now()),
    Date.now(),
  );
  return persisted;
}

async function upsertReadingProgress(
  database: SQLiteDatabase,
  book: LibraryBook,
  source: string,
  syncedAt: number,
): Promise<void> {
  const progress = book.isRead ? 100 : book.progress;
  if (typeof progress === "number") {
    await database.runAsync(
      `INSERT INTO reading_progress (
         book_key, source, progress, is_read, reading_time_ms,
         words_read, last_read_at, synced_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(book_key) DO UPDATE SET
         source = excluded.source,
         progress = MAX(reading_progress.progress, excluded.progress),
         is_read = MAX(reading_progress.is_read, excluded.is_read),
         reading_time_ms = CASE
           WHEN reading_progress.reading_time_ms IS NULL THEN excluded.reading_time_ms
           WHEN excluded.reading_time_ms IS NULL THEN reading_progress.reading_time_ms
           ELSE MAX(reading_progress.reading_time_ms, excluded.reading_time_ms)
         END,
         words_read = CASE
           WHEN reading_progress.words_read IS NULL THEN excluded.words_read
           WHEN excluded.words_read IS NULL THEN reading_progress.words_read
           ELSE MAX(reading_progress.words_read, excluded.words_read)
         END,
         last_read_at = CASE
           WHEN reading_progress.last_read_at IS NULL THEN excluded.last_read_at
           WHEN excluded.last_read_at IS NULL THEN reading_progress.last_read_at
           ELSE MAX(reading_progress.last_read_at, excluded.last_read_at)
         END,
         synced_at = MAX(reading_progress.synced_at, excluded.synced_at)
       WHERE excluded.is_read > reading_progress.is_read
          OR excluded.progress > reading_progress.progress
          OR COALESCE(excluded.reading_time_ms, 0) > COALESCE(reading_progress.reading_time_ms, 0)
          OR COALESCE(excluded.words_read, 0) > COALESCE(reading_progress.words_read, 0)
          OR COALESCE(excluded.last_read_at, 0) > COALESCE(reading_progress.last_read_at, 0)
          OR (
            excluded.progress = reading_progress.progress
            AND excluded.synced_at >= reading_progress.synced_at
          )`,
      book.key,
      source,
      progress,
      book.isRead ? 1 : 0,
      book.readingTimeMs ?? null,
      book.wordsRead ?? null,
      book.lastReadAt ?? null,
      syncedAt,
    );
  } else {
    await database.runAsync(
      "DELETE FROM reading_progress WHERE book_key = ? AND source = ?",
      book.key,
      source,
    );
  }
}

async function persistProgressRecord(
  database: SQLiteDatabase,
  book: LibraryBook,
): Promise<void> {
  return upsertReadingProgress(
    database,
    book,
    "moonreader",
    book.moonReader?.syncedAt ?? Date.now(),
  );
}

async function clearLocalMoonReaderData(
  database: SQLiteDatabase,
): Promise<void> {
  const rows = await database.getAllAsync<{
    book_key: string;
    book_json: string;
  }>(
    `SELECT books.book_key, books.book_json
     FROM catalog_books AS books
     WHERE books.book_key IN (SELECT book_key FROM local_files)`,
  );
  for (const row of rows) {
    const book = parseBook(row.book_json);
    if (!book.moonReader && typeof book.progress !== "number") continue;
    const cleaned = withoutMoonReaderData(book);
    await database.runAsync(
      "UPDATE catalog_books SET book_json = ?, updated_at = ? WHERE book_key = ?",
      JSON.stringify(cleaned),
      Date.now(),
      row.book_key,
    );
  }
}

function preserveCatalogMetadata(
  existing: LibraryBook | undefined,
  incoming: LibraryBook,
): LibraryBook {
  if (!existing) return incoming;
  const hasLocalMetadata =
    !!existing.metadataUpdatedAt ||
    !!existing.discovery ||
    !!existing.coverSources ||
    !!existing.coverPreference;
  if (!hasLocalMetadata) return incoming;
  return {
    ...incoming,
    title: existing.title || incoming.title,
    author: existing.author || incoming.author,
    cover: existing.cover || incoming.cover,
    fallbackCover: existing.fallbackCover || incoming.fallbackCover,
    coverSources: existing.coverSources ?? incoming.coverSources,
    coverPreference: existing.coverPreference ?? incoming.coverPreference,
    coverPreferenceUpdatedAt:
      existing.coverPreferenceUpdatedAt ?? incoming.coverPreferenceUpdatedAt,
    description: existing.description || incoming.description,
    year: existing.year || incoming.year,
    genre:
      existing.genre && existing.genre !== "Other"
        ? existing.genre
        : incoming.genre,
    rating: existing.rating ?? incoming.rating,
    ratingsCount: existing.ratingsCount ?? incoming.ratingsCount,
    seriesPosition: existing.seriesPosition ?? incoming.seriesPosition,
    discovery: existing.discovery ?? incoming.discovery,
    metadataPending: existing.metadataPending,
    metadataUpdatedAt: existing.metadataUpdatedAt,
    metadataVersion: existing.metadataVersion,
    coverLookupKey: existing.coverLookupKey,
    coverSourcesLookupKey: existing.coverSourcesLookupKey,
    coverSourcesUpdatedAt: existing.coverSourcesUpdatedAt,
    coverSourcesRetryAt: existing.coverSourcesRetryAt,
  };
}

export async function persistMoonReaderCatalog(
  sourceKey: string,
  books: LibraryBook[],
): Promise<void> {
  await withDatabaseWrite(async (database) => {
    const existingRows = await database.getAllAsync<{
      book_key: string;
      book_json: string;
    }>("SELECT book_key, book_json FROM catalog_books");
    const existingByKey = new Map(
      existingRows.map((row) => [row.book_key, parseBook(row.book_json)]),
    );
    await database.withExclusiveTransactionAsync(async (transaction) => {
      // The table/source names are retained for on-device schema compatibility,
      // but this catalog may contain records from several reader add-ons.
      await transaction.runAsync("DELETE FROM moonreader_items");
      await transaction.runAsync(
        "DELETE FROM reading_progress WHERE source = 'moonreader'",
      );
      await transaction.runAsync(
        "DELETE FROM metadata_sources WHERE source = 'moonreader'",
      );
      await clearLocalMoonReaderData(transaction);
      for (const book of books) {
        const moonReader = book.moonReader;
        const filename = moonReader?.sourceFilename;
        if (!moonReader || !filename) {
          throw new Error(
            `Reader add-on item ${book.key} has no source filename.`,
          );
        }
        const catalogBook = preserveCatalogMetadata(
          existingByKey.get(book.key),
          book,
        );
        await upsertBook(transaction, withoutMoonReaderData(catalogBook));
        await persistProgressRecord(transaction, book);
        await transaction.runAsync(
          `INSERT INTO moonreader_items (source_key, filename, book_key, sort_at)
         VALUES (?, ?, ?, ?)`,
          sourceKey,
          `${moonReader.extensionId ?? "legacy"}:${filename.toLowerCase()}`,
          book.key,
          book.lastReadAt ?? book.addedAt,
        );
        await transaction.runAsync(
          `INSERT INTO metadata_sources (book_key, source, fingerprint, payload_json, updated_at)
         VALUES (?, 'moonreader', ?, ?, ?)
         ON CONFLICT(book_key, source) DO UPDATE SET
           fingerprint = excluded.fingerprint,
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`,
          book.key,
          String(moonReader.syncedAt),
          JSON.stringify(moonReader),
          Date.now(),
        );
      }
      await transaction.runAsync(`
      DELETE FROM catalog_books
      WHERE book_key NOT IN (SELECT book_key FROM collections)
        AND book_key NOT IN (SELECT book_key FROM local_files)
        AND book_key NOT IN (SELECT book_key FROM moonreader_items)
        AND book_key NOT IN (SELECT book_key FROM progress_sync_items)
    `);
    });
  });
}

export async function clearMoonReaderCatalog(): Promise<void> {
  await withDatabaseWrite((database) =>
    database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync("DELETE FROM moonreader_items");
      await transaction.runAsync(
        "DELETE FROM reading_progress WHERE source = 'moonreader'",
      );
      await transaction.runAsync(
        "DELETE FROM metadata_sources WHERE source = 'moonreader'",
      );
      await clearLocalMoonReaderData(transaction);
      await transaction.runAsync(`
      DELETE FROM catalog_books
      WHERE book_key NOT IN (SELECT book_key FROM collections)
        AND book_key NOT IN (SELECT book_key FROM local_files)
        AND book_key NOT IN (SELECT book_key FROM moonreader_items)
        AND book_key NOT IN (SELECT book_key FROM progress_sync_items)
    `);
    }),
  );
}

export async function persistLocalBook(
  directoryKey: string,
  book: LibraryBook,
): Promise<LibraryBook> {
  return withDatabaseWrite(async (database) => {
    let persisted: LibraryBook | undefined;
    await database.withExclusiveTransactionAsync(async (transaction) => {
      persisted = await persistLocalBookRecord(transaction, directoryKey, book);
    });
    if (!persisted) throw new Error("The local book could not be persisted.");
    return persisted;
  });
}

export async function persistLocalBooks(
  directoryKey: string,
  books: LibraryBook[],
): Promise<void> {
  await withDatabaseWrite((database) =>
    database.withExclusiveTransactionAsync(async (transaction) => {
      for (const book of books) {
        await persistLocalBookRecord(transaction, directoryKey, book);
      }
    }),
  );
}

export async function persistMetadataSource(
  book: LibraryBook,
  source: MetadataSource,
  payload: unknown,
): Promise<void> {
  await withDatabaseWrite((database) =>
    database
      .runAsync(
        `INSERT INTO metadata_sources (book_key, source, fingerprint, payload_json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(book_key, source) DO UPDATE SET
       fingerprint = excluded.fingerprint,
       payload_json = excluded.payload_json,
       updated_at = excluded.updated_at`,
        book.key,
        source,
        fingerprint(book) || null,
        JSON.stringify(payload),
        Date.now(),
      )
      .then(() => undefined),
  );
}

export async function persistCatalogBook(
  book: LibraryBook,
): Promise<LibraryBook> {
  return withDatabaseWrite(async (database) => {
    const incoming = withoutMoonReaderData(book);
    const row = await database.getFirstAsync<CatalogRow>(
      "SELECT book_json FROM catalog_books WHERE book_key = ?",
      incoming.key,
    );
    const persisted = preserveStoredCoverPreference(
      row ? parseBook(row.book_json) : undefined,
      incoming,
    );
    await upsertBook(database, persisted);
    return persisted;
  });
}

export async function setCatalogBookCoverPreference(
  bookKey: string,
  preference: BookCoverPreference,
): Promise<LibraryBook> {
  return withDatabaseWrite(async (database) => {
    const row = await database.getFirstAsync<CatalogRow>(
      "SELECT book_json FROM catalog_books WHERE book_key = ?",
      bookKey,
    );
    if (!row)
      throw new Error("This book is not present in the library catalog.");
    const book = parseBook(row.book_json);
    const requestedCover =
      preference === "local"
        ? book.coverSources?.local
        : preference === "catalog"
          ? book.coverSources?.catalog
          : preference.startsWith("provider:")
            ? book.coverSources?.providers?.[
                preference.slice("provider:".length)
              ]
            : book.coverSources?.local ||
              book.coverSources?.catalog ||
              Object.values(book.coverSources?.providers ?? {})[0];
    if (!requestedCover) {
      throw new Error(
        preference === "local"
          ? "No usable cover was found in the local book file."
          : preference === "catalog"
            ? "No Open Library cover is available for this book."
            : preference.startsWith("provider:")
              ? "This cover provider did not return a usable cover for this book."
              : "No cover source is available for this book.",
      );
    }
    const resolved = resolveBookCover(book.coverSources, preference, [
      book.moonReader?.detailCoverUri,
      book.moonReader?.coverUri,
      book.cover,
      book.fallbackCover,
    ]);
    const updated: LibraryBook = {
      ...book,
      coverPreference: preference,
      coverPreferenceUpdatedAt: Date.now(),
      cover: resolved.cover,
      fallbackCover: resolved.fallbackCover,
    };
    await upsertBook(database, updated);
    return updated;
  });
}

export async function setCatalogBookCoverProviderSource(
  bookKey: string,
  providerId: string,
  uri: string,
): Promise<LibraryBook> {
  return withDatabaseWrite(async (database) => {
    const row = await database.getFirstAsync<CatalogRow>(
      "SELECT book_json FROM catalog_books WHERE book_key = ?",
      bookKey,
    );
    if (!row)
      throw new Error("This book is not present in the library catalog.");
    const book = parseBook(row.book_json);
    const coverSources = {
      ...book.coverSources,
      providers: {
        ...book.coverSources?.providers,
        [providerId]: uri,
      },
    };
    const resolved = resolveBookCover(coverSources, book.coverPreference, [
      book.moonReader?.detailCoverUri,
      book.moonReader?.coverUri,
      book.cover,
      book.fallbackCover,
    ]);
    const updated: LibraryBook = {
      ...book,
      coverSources,
      cover: resolved.cover,
      fallbackCover: resolved.fallbackCover,
    };
    await upsertBook(database, updated);
    return updated;
  });
}

export async function setCatalogBookCoverCatalogSource(
  bookKey: string,
  uri: string,
): Promise<LibraryBook> {
  return withDatabaseWrite(async (database) => {
    const row = await database.getFirstAsync<CatalogRow>(
      "SELECT book_json FROM catalog_books WHERE book_key = ?",
      bookKey,
    );
    if (!row)
      throw new Error("This book is not present in the library catalog.");
    const book = parseBook(row.book_json);
    const updated = {
      ...book,
      coverSources: { ...book.coverSources, catalog: uri },
    };
    await upsertBook(database, updated);
    return updated;
  });
}

export async function setCatalogBookCoverSources(
  bookKey: string,
  sources: {
    catalog?: string;
    providers: Record<string, string>;
    lookupKey: string;
    complete: boolean;
  },
): Promise<LibraryBook> {
  return withDatabaseWrite(async (database) => {
    const row = await database.getFirstAsync<CatalogRow>(
      "SELECT book_json FROM catalog_books WHERE book_key = ?",
      bookKey,
    );
    if (!row)
      throw new Error("This book is not present in the library catalog.");
    const book = parseBook(row.book_json);
    const coverSources = {
      ...book.coverSources,
      ...(sources.catalog ? { catalog: sources.catalog } : {}),
      providers: {
        ...book.coverSources?.providers,
        ...sources.providers,
      },
    };
    const resolved = resolveBookCover(coverSources, book.coverPreference, [
      book.moonReader?.detailCoverUri,
      book.moonReader?.coverUri,
      book.cover,
      book.fallbackCover,
    ]);
    const updated: LibraryBook = {
      ...book,
      coverSources,
      cover: resolved.cover,
      fallbackCover: resolved.fallbackCover,
      coverSourcesLookupKey: sources.lookupKey,
      coverSourcesUpdatedAt: sources.complete ? Date.now() : undefined,
      coverSourcesRetryAt: sources.complete
        ? undefined
        : Date.now() + 5 * 60 * 1000,
    };
    await upsertBook(database, updated);
    return updated;
  });
}

export async function markCatalogBookRead(bookKey: string): Promise<void> {
  await withDatabaseWrite(async (database) => {
    const exists = await database.getFirstAsync<{ present: number }>(
      "SELECT 1 AS present FROM catalog_books WHERE book_key = ?",
      bookKey,
    );
    if (!exists)
      throw new Error("This book is not present in the library catalog.");
    await database.runAsync(
      `INSERT INTO reading_overrides (book_key, is_read, updated_at)
     VALUES (?, 1, ?)
     ON CONFLICT(book_key) DO UPDATE SET
       is_read = 1,
       updated_at = excluded.updated_at`,
      bookKey,
      Date.now(),
    );
  });
}

export function syncAliases(book: LibraryBook): string[] {
  const format = book.format || book.local?.format || "";
  return [
    `key:${book.key}`,
    `identity:${bookIdentity(book.title, book.author, format)}`,
    book.discovery?.id ? `discovery:${book.discovery.id}` : "",
    book.local?.filename ? `filename:${book.local.filename.toLowerCase()}` : "",
    book.moonReader?.sourceFilename
      ? `filename:${book.moonReader.sourceFilename.toLowerCase()}`
      : "",
  ].filter(Boolean);
}

function collectionSyncBook(record: CollectionSyncRecord): LibraryBook {
  const key = `synced:${record.identity}`;
  return {
    key,
    id: key,
    title: record.title,
    author: record.author || "Unknown",
    cover: "",
    description: "",
    year: "",
    genre: "Other",
    format: record.format || undefined,
    sourceUrl: record.sourceUrl,
    addedAt: record.addedAt,
    availableLocally: false,
    metadataPending: true,
  };
}

function collectionRecordFromBook(
  book: LibraryBook,
  identity: string,
  sortAt: number,
  updatedAt: number,
): CollectionSyncRecord {
  const semanticIdentity = bookIdentity(book.title, book.author);
  return {
    identity,
    aliases: [
      ...new Set([
        ...(identity === semanticIdentity ? [] : [semanticIdentity]),
        ...syncAliases(book),
      ]),
    ],
    title: book.title,
    author: book.author,
    format: book.format || book.local?.format || "",
    sourceUrl: book.sourceUrl,
    addedAt: book.addedAt || sortAt,
    sortAt,
    updatedAt,
  };
}

async function collectionSnapshotRows(
  database: SQLiteDatabase,
  collection: SyncedCollection,
): Promise<CollectionSyncRow[]> {
  if (collection === "reading-list") {
    return database.getAllAsync<CollectionSyncRow>(
      `SELECT books.book_key, books.book_json,
              synced.identity AS sync_identity,
              synced.record_json AS sync_record_json,
              books.updated_at AS catalog_updated_at,
              membership.sort_at AS source_sort_at
       FROM collections AS membership
       JOIN catalog_books AS books ON books.book_key = membership.book_key
       LEFT JOIN collection_sync_records AS synced
         ON synced.collection = ? AND synced.book_key = books.book_key
       WHERE membership.collection = 'reading_list'`,
      collection,
    );
  }
  return database.getAllAsync<CollectionSyncRow>(
    `SELECT books.book_key, books.book_json,
            synced.identity AS sync_identity,
            synced.record_json AS sync_record_json,
            books.updated_at AS catalog_updated_at,
            MAX(
              COALESCE((SELECT MAX(sort_at) FROM collections WHERE book_key = books.book_key), 0),
              COALESCE((SELECT MAX(updated_at) FROM local_files WHERE book_key = books.book_key), 0),
              COALESCE((SELECT MAX(sort_at) FROM moonreader_items WHERE book_key = books.book_key), 0),
              COALESCE((SELECT MAX(sort_at) FROM progress_sync_items WHERE book_key = books.book_key), 0),
              books.updated_at
            ) AS source_sort_at
     FROM catalog_books AS books
     LEFT JOIN collection_sync_records AS synced
       ON synced.collection = ? AND synced.book_key = books.book_key
     WHERE EXISTS (
            SELECT 1 FROM collections
            WHERE book_key = books.book_key AND collection = 'downloaded'
          )
        OR EXISTS (SELECT 1 FROM local_files WHERE book_key = books.book_key)
        OR EXISTS (SELECT 1 FROM moonreader_items WHERE book_key = books.book_key)
        OR EXISTS (SELECT 1 FROM progress_sync_items WHERE book_key = books.book_key)`,
    collection,
  );
}

async function storedCollectionRecords(
  database: SQLiteDatabase,
  collection: SyncedCollection,
): Promise<StoredCollectionSyncRow[]> {
  return database.getAllAsync<StoredCollectionSyncRow>(
    `SELECT identity, book_key, record_json
     FROM collection_sync_records WHERE collection = ?`,
    collection,
  );
}

export async function loadCollectionSyncRecords(
  collection: SyncedCollection,
): Promise<CollectionSyncRecord[]> {
  const database = await getLibraryDatabase();
  const [rows, stored] = await Promise.all([
    collectionSnapshotRows(database, collection),
    storedCollectionRecords(database, collection),
  ]);
  const rowsByKey = new Map(rows.map((row) => [row.book_key, row]));
  const mappedBookKeys = new Set(
    stored.flatMap((row) => (row.book_key ? [row.book_key] : [])),
  );
  const records = stored.map((row) => {
    const record = JSON.parse(row.record_json) as CollectionSyncRecord;
    const snapshot = row.book_key ? rowsByKey.get(row.book_key) : undefined;
    if (!snapshot || isCollectionRecordRemoved(record)) return record;
    const book = parseBook(snapshot.book_json);
    return {
      ...record,
      title: book.title,
      author: book.author,
      format: book.format || book.local?.format || record.format,
      aliases: [...new Set([...record.aliases, ...syncAliases(book)])],
    };
  });
  for (const row of rows) {
    if (mappedBookKeys.has(row.book_key)) continue;
    const book = parseBook(row.book_json);
    records.push(
      collectionRecordFromBook(
        book,
        bookIdentity(book.title, book.author),
        row.source_sort_at || book.addedAt,
        Math.max(row.catalog_updated_at, row.source_sort_at, book.addedAt),
      ),
    );
  }
  return mergeCollectionSyncRecords(records);
}

export interface HostedSyncLocalDocument {
  identity: string;
  aliases: string[];
  uri: string;
  filename: string;
  format: string;
  identifiers: Record<string, string>;
}

export async function loadHostedSyncLocalDocuments(): Promise<
  HostedSyncLocalDocument[]
> {
  const database = await getLibraryDatabase();
  const rows = await database.getAllAsync<{
    book_json: string;
    sync_identity: string | null;
  }>(
    `SELECT books.book_json, synced.identity AS sync_identity
     FROM local_files AS files
     JOIN catalog_books AS books ON books.book_key = files.book_key
     LEFT JOIN collection_sync_records AS synced
       ON synced.collection = 'library' AND synced.book_key = books.book_key`,
  );
  return rows.flatMap((row) => {
    const book = parseBook(row.book_json);
    const uri = book.local?.uri ?? book.fileUri;
    if (!uri) return [];
    const identity = row.sync_identity ?? bookIdentity(book.title, book.author);
    return [{
      identity,
      aliases: [identity, bookIdentity(book.title, book.author), ...syncAliases(book)],
      uri,
      filename: book.local?.filename ?? uri.split("/").at(-1) ?? "",
      format: book.local?.format ?? book.format ?? "",
      identifiers: book.extension?.book.identifiers ?? {},
    }];
  });
}

export async function applyCollectionSyncRecords(
  collection: SyncedCollection,
  records: CollectionSyncRecord[],
): Promise<number> {
  return withDatabaseWrite(async (database) => {
    const books = await database.getAllAsync<{ book_key: string; book_json: string }>(
      "SELECT book_key, book_json FROM catalog_books",
    );
    const booksByAlias = new Map<string, { book_key: string; book_json: string }[]>();
    for (const row of books) {
      const book = parseBook(row.book_json);
      for (const alias of [bookIdentity(book.title, book.author), ...syncAliases(book)]) {
        const matches = booksByAlias.get(alias) ?? [];
        matches.push(row);
        booksByAlias.set(alias, matches);
      }
    }

    let updated = 0;
    await database.withExclusiveTransactionAsync(async (transaction) => {
      for (const record of records) {
        const matches = new Map<string, { book_key: string; book_json: string }>();
        for (const alias of [record.identity, ...record.aliases]) {
          for (const row of booksByAlias.get(alias) ?? []) {
            matches.set(row.book_key, row);
          }
        }
        const stored = await transaction.getFirstAsync<StoredCollectionSyncRow>(
          `SELECT identity, book_key, record_json
           FROM collection_sync_records
           WHERE collection = ? AND identity = ?`,
          collection,
          record.identity,
        );
        const storedRecord = stored
          ? (JSON.parse(stored.record_json) as CollectionSyncRecord)
          : null;
        const storedRemovalIsNewer =
          storedRecord != null &&
          isCollectionRecordRemoved(storedRecord) &&
          Math.max(storedRecord.updatedAt, storedRecord.removedAt ?? 0) >=
            Math.max(record.updatedAt, record.removedAt ?? 0);
        if (stored?.book_key) {
          const row = books.find((candidate) => candidate.book_key === stored.book_key);
          if (row) matches.set(row.book_key, row);
        }
        if (storedRemovalIsNewer && !isCollectionRecordRemoved(record)) {
          for (const row of matches.values()) {
            await transaction.runAsync(
              "DELETE FROM collections WHERE collection = ? AND book_key = ?",
              collection === "library" ? "downloaded" : "reading_list",
              row.book_key,
            );
            if (collection === "library") {
              await transaction.runAsync(
                "DELETE FROM collections WHERE collection = 'reading_list' AND book_key = ?",
                row.book_key,
              );
            }
          }
          continue;
        }

        if (!matches.size && !isCollectionRecordRemoved(record)) {
          const book = collectionSyncBook(record);
          await upsertBook(transaction, book);
          const row = { book_key: book.key, book_json: JSON.stringify(book) };
          matches.set(book.key, row);
          books.push(row);
          for (const alias of [record.identity, ...record.aliases]) {
            const aliasRows = booksByAlias.get(alias) ?? [];
            aliasRows.push(row);
            booksByAlias.set(alias, aliasRows);
          }
        }

        const storedBook = stored?.book_key
          ? matches.get(stored.book_key)
          : undefined;
        const matchedBook = (storedBook ?? matches.values().next().value) as
          | { book_key: string; book_json: string }
          | undefined;
        if (matchedBook) {
          await transaction.runAsync(
            `DELETE FROM collection_sync_records
             WHERE collection = ? AND book_key = ? AND identity != ?`,
            collection,
            matchedBook.book_key,
            record.identity,
          );
        }
        await transaction.runAsync(
          `INSERT INTO collection_sync_records (
             collection, identity, book_key, record_json, updated_at, removed_at
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(collection, identity) DO UPDATE SET
             book_key = COALESCE(excluded.book_key, collection_sync_records.book_key),
             record_json = CASE
               WHEN excluded.updated_at >= collection_sync_records.updated_at
                 THEN excluded.record_json
               ELSE collection_sync_records.record_json
             END,
             updated_at = MAX(collection_sync_records.updated_at, excluded.updated_at),
             removed_at = CASE
               WHEN excluded.updated_at >= collection_sync_records.updated_at
                 THEN excluded.removed_at
               ELSE collection_sync_records.removed_at
             END`,
          collection,
          record.identity,
          matchedBook?.book_key ?? stored?.book_key ?? null,
          JSON.stringify(record),
          Math.max(record.updatedAt, record.removedAt ?? 0),
          record.removedAt ?? null,
        );

        if (isCollectionRecordRemoved(record)) {
          for (const row of matches.values()) {
            await transaction.runAsync(
              "DELETE FROM collections WHERE collection = ? AND book_key = ?",
              collection === "library" ? "downloaded" : "reading_list",
              row.book_key,
            );
            if (collection === "library") {
              await transaction.runAsync(
                "DELETE FROM collections WHERE collection = 'reading_list' AND book_key = ?",
                row.book_key,
              );
            }
          }
          updated += 1;
          continue;
        }

        if (!matchedBook) continue;
        const localCollection = collection === "library" ? "downloaded" : "reading_list";
        await transaction.runAsync(
          `INSERT INTO collections (collection, book_key, sort_at) VALUES (?, ?, ?)
           ON CONFLICT(collection, book_key) DO UPDATE SET
             sort_at = MAX(collections.sort_at, excluded.sort_at)`,
          localCollection,
          matchedBook.book_key,
          record.sortAt,
        );
        updated += 1;
      }
    });
    return updated;
  });
}

export async function setCollectionSyncMembership(
  book: LibraryBook,
  collection: SyncedCollection,
  present: boolean,
  syncDocumentAlias?: string,
): Promise<void> {
  await withDatabaseWrite(async (database) => {
    const existing = (await storedCollectionRecords(database, collection))
      .map((row) => ({
        row,
        record: JSON.parse(row.record_json) as CollectionSyncRecord,
      }))
      .find(
        ({ row, record }) =>
          row.book_key === book.key ||
          [record.identity, ...record.aliases].some((alias) =>
            [
              bookIdentity(book.title, book.author),
              ...syncAliases(book),
            ].includes(alias),
          ),
      );
    const now = Date.now();
    const identity = existing?.record.identity ?? bookIdentity(book.title, book.author);
    const base = collectionRecordFromBook(
      book,
      identity,
      present ? now : (existing?.record.sortAt ?? book.addedAt ?? now),
      now,
    );
    base.addedAt = existing?.record.addedAt ?? (present ? now : base.addedAt);
    const record: CollectionSyncRecord = present
      ? {
          ...base,
          aliases: [
            ...new Set([
              ...base.aliases,
              ...(syncDocumentAlias ? [syncDocumentAlias] : []),
            ]),
          ],
        }
      : {
          ...base,
          aliases: [
            ...new Set([
              ...base.aliases,
              ...(existing?.record.aliases ?? []),
              ...(syncDocumentAlias ? [syncDocumentAlias] : []),
            ]),
          ],
          addedAt: existing?.record.addedAt ?? base.addedAt,
          removedAt: Math.max(now, existing?.record.updatedAt ?? 0),
        };
    await database.runAsync(
      `INSERT INTO collection_sync_records (
         collection, identity, book_key, record_json, updated_at, removed_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(collection, identity) DO UPDATE SET
         book_key = COALESCE(excluded.book_key, collection_sync_records.book_key),
         record_json = excluded.record_json,
         updated_at = excluded.updated_at,
         removed_at = excluded.removed_at`,
      collection,
      identity,
      book.key,
      JSON.stringify(record),
      Math.max(record.updatedAt, record.removedAt ?? 0),
      record.removedAt ?? null,
    );
  });
}

export async function removeLibrarySyncBook(
  book: LibraryBook,
  syncDocumentAlias?: string,
): Promise<void> {
  await setCollectionSyncMembership(
    book,
    "reading-list",
    false,
    syncDocumentAlias,
  );
  await setCollectionSyncMembership(
    book,
    "library",
    false,
    syncDocumentAlias,
  );
}

function progressSyncBook(record: ProgressSyncRecord): LibraryBook {
  const key = `progress:${record.identity}`;
  return {
    key,
    id: key,
    title: record.title,
    author: record.author || "Unknown",
    cover: "",
    description: "",
    year: "",
    genre: "Other",
    format: record.format || undefined,
    addedAt: record.updatedAt,
    availableLocally: false,
    metadataPending: true,
  };
}

function rowProgressRecord(
  row: ProgressSnapshotRow,
): ProgressSyncRecord | null {
  const book = parseBook(row.book_json);
  const isRead = row.override_is_read === 1 || row.is_read === 1;
  if (row.progress == null && !isRead) return null;
  const updatedAt = Math.max(
    row.sync_identity ? (row.progress_synced_at ?? 0) : 0,
    row.last_read_at ?? 0,
    row.override_updated_at ?? 0,
  );
  const semanticIdentity = bookIdentity(book.title, book.author);
  return {
    identity: row.sync_identity ?? semanticIdentity,
    aliases: [
      ...new Set([
        ...(row.sync_identity && row.sync_identity !== semanticIdentity
          ? [semanticIdentity]
          : []),
        ...syncAliases(book),
      ]),
    ],
    title: book.title,
    author: book.author,
    format: book.format || book.local?.format || "",
    progress: isRead ? 100 : Math.max(0, Math.min(100, row.progress ?? 0)),
    isRead,
    readingTimeMs: row.reading_time_ms ?? undefined,
    wordsRead: row.words_read ?? undefined,
    lastReadAt: row.last_read_at ?? undefined,
    updatedAt: updatedAt || book.addedAt,
  };
}

async function progressSnapshotRows(
  database: SQLiteDatabase,
): Promise<ProgressSnapshotRow[]> {
  return database.getAllAsync<ProgressSnapshotRow>(
    `SELECT books.book_key, books.book_json,
            progress.progress, progress.is_read, progress.reading_time_ms,
            progress.words_read, progress.last_read_at,
            progress.synced_at AS progress_synced_at,
            manual.is_read AS override_is_read,
            manual.updated_at AS override_updated_at,
            synced.identity AS sync_identity,
            NULL AS moonreader_json
     FROM catalog_books AS books
     LEFT JOIN reading_progress AS progress ON progress.book_key = books.book_key
     LEFT JOIN reading_overrides AS manual ON manual.book_key = books.book_key
     LEFT JOIN progress_sync_items AS synced ON synced.book_key = books.book_key
     WHERE progress.book_key IS NOT NULL
        OR manual.book_key IS NOT NULL
        OR synced.book_key IS NOT NULL`,
  );
}

export async function loadProgressSyncRecords(): Promise<ProgressSyncRecord[]> {
  const database = await getLibraryDatabase();
  const activeRecords = (await progressSnapshotRows(database))
    .map(rowProgressRecord)
    .filter((record): record is ProgressSyncRecord => !!record);
  const tombstones = await loadProgressTombstones(database);
  return mergeProgressRecords(activeRecords, tombstones);
}

export interface ProgressSyncLocalDocument {
  identity: string;
  aliases: string[];
  uri: string;
  filename: string;
  format: string;
  identifiers: Record<string, string>;
}

export async function loadProgressSyncLocalDocuments(): Promise<
  ProgressSyncLocalDocument[]
> {
  const database = await getLibraryDatabase();
  const rows = await progressSnapshotRows(database);
  return rows.flatMap((row) => {
    const record = rowProgressRecord(row);
    if (!record) return [];
    const book = parseBook(row.book_json);
    const uri = book.local?.uri ?? book.fileUri;
    if (!uri) return [];
    return [
      {
        identity: record.identity,
        aliases: record.aliases,
        uri,
        filename: book.local?.filename ?? uri.split("/").at(-1) ?? "",
        format: book.local?.format ?? book.format ?? "",
        identifiers: book.extension?.book.identifiers ?? {},
      },
    ];
  });
}

async function loadProgressTombstones(
  database: SQLiteDatabase,
): Promise<ProgressSyncRecord[]> {
  const rows = await database.getAllAsync<ProgressTombstoneRow>(
    "SELECT record_json FROM progress_sync_tombstones",
  );
  return rows.map((row) => JSON.parse(row.record_json) as ProgressSyncRecord);
}

export async function applyProgressSyncRecords(
  records: ProgressSyncRecord[],
): Promise<number> {
  return withDatabaseWrite(async (database) => {
    const rows = await progressSnapshotRows(database);
    const tombstonesByAlias = new Map<
      string,
      { identity: string; removedAt: number }[]
    >();
    for (const tombstone of await loadProgressTombstones(database)) {
      for (const alias of [tombstone.identity, ...tombstone.aliases]) {
        const matches = tombstonesByAlias.get(alias) ?? [];
        matches.push({
          identity: tombstone.identity,
          removedAt: tombstone.removedAt ?? tombstone.updatedAt,
        });
        tombstonesByAlias.set(alias, matches);
      }
    }
    const rowsByAlias = new Map<string, ProgressSnapshotRow[]>();
    for (const row of rows) {
      const book = parseBook(row.book_json);
      const aliases = [
        row.sync_identity ?? "",
        bookIdentity(book.title, book.author),
        ...syncAliases(book),
      ].filter(Boolean);
      for (const alias of aliases) {
        const matches = rowsByAlias.get(alias) ?? [];
        matches.push(row);
        rowsByAlias.set(alias, matches);
      }
    }

    let updated = 0;
    await database.withExclusiveTransactionAsync(async (transaction) => {
      for (const record of records) {
        const matches = new Map<string, ProgressSnapshotRow>();
        for (const alias of [record.identity, ...record.aliases]) {
          for (const row of rowsByAlias.get(alias) ?? [])
            matches.set(row.book_key, row);
        }
        if (isProgressRecordRemoved(record)) {
          const removedAt = record.removedAt ?? record.updatedAt;
          await transaction.runAsync(
            `INSERT INTO progress_sync_tombstones (identity, record_json, removed_at)
           VALUES (?, ?, ?)
           ON CONFLICT(identity) DO UPDATE SET
             record_json = CASE
               WHEN excluded.removed_at >= progress_sync_tombstones.removed_at
                 THEN excluded.record_json
               ELSE progress_sync_tombstones.record_json
             END,
             removed_at = MAX(progress_sync_tombstones.removed_at, excluded.removed_at)`,
            record.identity,
            JSON.stringify(record),
            removedAt,
          );
          for (const row of matches.values()) {
            await transaction.runAsync(
              "DELETE FROM progress_sync_items WHERE book_key = ?",
              row.book_key,
            );
            await transaction.runAsync(
              "DELETE FROM reading_progress WHERE book_key = ? AND source = 'cloud'",
              row.book_key,
            );
            await transaction.runAsync(
              `DELETE FROM catalog_books
             WHERE book_key = ?
               AND book_key NOT IN (SELECT book_key FROM collections)
               AND book_key NOT IN (SELECT book_key FROM local_files)
               AND book_key NOT IN (SELECT book_key FROM moonreader_items)
               AND book_key NOT IN (SELECT book_key FROM progress_sync_items)`,
              row.book_key,
            );
          }
          updated += 1;
          continue;
        }
        const matchedTombstones = new Map<string, number>();
        for (const alias of [record.identity, ...record.aliases]) {
          for (const tombstone of tombstonesByAlias.get(alias) ?? []) {
            matchedTombstones.set(
              tombstone.identity,
              Math.max(
                matchedTombstones.get(tombstone.identity) ?? 0,
                tombstone.removedAt,
              ),
            );
          }
        }
        if (
          [...matchedTombstones.values()].some(
            (removedAt) => removedAt >= record.updatedAt,
          )
        ) {
          continue;
        }
        for (const [identity, removedAt] of matchedTombstones) {
          if (record.updatedAt <= removedAt) continue;
          await transaction.runAsync(
            "DELETE FROM progress_sync_tombstones WHERE identity = ?",
            identity,
          );
        }
        if (!matches.size) {
          const book = progressSyncBook(record);
          await upsertBook(transaction, book);
          await transaction.runAsync(
            `INSERT INTO progress_sync_items (identity, book_key, sort_at)
           VALUES (?, ?, ?)
           ON CONFLICT(identity) DO UPDATE SET
             book_key = excluded.book_key,
             sort_at = MAX(progress_sync_items.sort_at, excluded.sort_at)`,
            record.identity,
            book.key,
            record.lastReadAt ?? record.updatedAt,
          );
          const row: ProgressSnapshotRow = {
            book_key: book.key,
            book_json: JSON.stringify(book),
            progress: null,
            is_read: null,
            reading_time_ms: null,
            words_read: null,
            last_read_at: null,
            progress_synced_at: null,
            moonreader_json: null,
            override_is_read: null,
            override_updated_at: null,
            sync_identity: record.identity,
          };
          matches.set(book.key, row);
          for (const alias of [record.identity, ...record.aliases]) {
            const aliasRows = rowsByAlias.get(alias) ?? [];
            aliasRows.push(row);
            rowsByAlias.set(alias, aliasRows);
          }
        }
        for (const row of matches.values()) {
          const localRead = row.override_is_read === 1 || row.is_read === 1;
          const localUpdatedAt = Math.max(
            row.progress_synced_at ?? 0,
            row.last_read_at ?? 0,
            row.override_updated_at ?? 0,
          );
          const localProgress = localRead
            ? 100
            : Math.max(0, row.progress ?? 0);
          const remoteProgress = record.isRead
            ? 100
            : Math.max(0, record.progress);
          const remoteHasMoreStats =
            (record.readingTimeMs ?? 0) > (row.reading_time_ms ?? 0) ||
            (record.wordsRead ?? 0) > (row.words_read ?? 0) ||
            (record.lastReadAt ?? 0) > (row.last_read_at ?? 0);
          const remoteWins =
            remoteProgress > localProgress ||
            (remoteProgress === localProgress &&
              (remoteHasMoreStats || record.updatedAt > localUpdatedAt));
          if (!remoteWins) continue;

          await transaction.runAsync(
            `INSERT INTO reading_progress (
             book_key, source, progress, is_read, reading_time_ms,
             words_read, last_read_at, synced_at
           ) VALUES (?, 'cloud', ?, ?, ?, ?, ?, ?)
           ON CONFLICT(book_key) DO UPDATE SET
             source = excluded.source,
             progress = excluded.progress,
             is_read = excluded.is_read,
             reading_time_ms = excluded.reading_time_ms,
             words_read = excluded.words_read,
             last_read_at = excluded.last_read_at,
             synced_at = excluded.synced_at`,
            row.book_key,
            record.isRead ? 100 : record.progress,
            record.isRead ? 1 : 0,
            record.readingTimeMs ?? null,
            record.wordsRead ?? null,
            record.lastReadAt ?? null,
            record.updatedAt,
          );
          if (record.isRead) {
            await transaction.runAsync(
              `INSERT INTO reading_overrides (book_key, is_read, updated_at)
             VALUES (?, 1, ?)
             ON CONFLICT(book_key) DO UPDATE SET
               is_read = 1,
               updated_at = MAX(reading_overrides.updated_at, excluded.updated_at)`,
              row.book_key,
              record.updatedAt,
            );
          }
          updated += 1;
        }
      }
    });
    return updated;
  });
}

export async function removeProgressSyncBook(
  book: LibraryBook,
  syncDocumentAlias?: string,
): Promise<void> {
  await withDatabaseWrite(async (database) => {
    const rows = await progressSnapshotRows(database);
    const identity = bookIdentity(book.title, book.author);
    const aliases = new Set([
      identity,
      ...syncAliases(book),
      ...(syncDocumentAlias ? [syncDocumentAlias] : []),
    ]);
    const matches = rows.filter((row) => {
      if (row.book_key === book.key) return true;
      const rowBook = parseBook(row.book_json);
      const rowRecord = rowProgressRecord(row);
      const rowAliases = [
        row.sync_identity ?? "",
        bookIdentity(rowBook.title, rowBook.author),
        ...syncAliases(rowBook),
        ...(rowRecord?.aliases ?? []),
      ].filter(Boolean);
      return (
        rowRecord?.identity === identity ||
        rowAliases.some((alias) => aliases.has(alias))
      );
    });
    const matchedRecord = matches
      .map(rowProgressRecord)
      .find((record): record is ProgressSyncRecord => !!record);
    const updatedAt =
      matchedRecord?.updatedAt ??
      Math.max(book.lastReadAt ?? 0, book.addedAt ?? 0, 1);
    // A removal is a sync event. It must be at least as new as the record it
    // removes, including when another device's clock is slightly ahead.
    const removedAt = Math.max(Date.now(), updatedAt);
    const tombstone: ProgressSyncRecord = {
      identity: matchedRecord?.identity ?? identity,
      aliases: [
        ...new Set([...(matchedRecord?.aliases ?? []), ...aliases]),
      ].sort(),
      title: matchedRecord?.title ?? book.title,
      author: matchedRecord?.author ?? book.author,
      format: matchedRecord?.format ?? book.format ?? book.local?.format ?? "",
      progress:
        matchedRecord?.progress ??
        Math.max(0, Math.min(100, book.progress ?? 0)),
      isRead: matchedRecord?.isRead ?? !!book.isRead,
      readingTimeMs: matchedRecord?.readingTimeMs ?? book.readingTimeMs,
      wordsRead: matchedRecord?.wordsRead ?? book.wordsRead,
      lastReadAt: matchedRecord?.lastReadAt ?? book.lastReadAt,
      updatedAt,
      removedAt,
    };

    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        `INSERT INTO progress_sync_tombstones (identity, record_json, removed_at)
       VALUES (?, ?, ?)
       ON CONFLICT(identity) DO UPDATE SET
         record_json = CASE
           WHEN excluded.removed_at >= progress_sync_tombstones.removed_at
             THEN excluded.record_json
           ELSE progress_sync_tombstones.record_json
         END,
         removed_at = MAX(progress_sync_tombstones.removed_at, excluded.removed_at)`,
        tombstone.identity,
        JSON.stringify(tombstone),
        removedAt,
      );
      await transaction.runAsync(
        "DELETE FROM progress_sync_items WHERE identity = ?",
        tombstone.identity,
      );
      for (const row of matches) {
        await transaction.runAsync(
          "DELETE FROM progress_sync_items WHERE book_key = ?",
          row.book_key,
        );
        await transaction.runAsync(
          "DELETE FROM reading_progress WHERE book_key = ? AND source = 'cloud'",
          row.book_key,
        );
        await transaction.runAsync(
          `DELETE FROM catalog_books
         WHERE book_key = ?
           AND book_key NOT IN (SELECT book_key FROM collections)
           AND book_key NOT IN (SELECT book_key FROM local_files)
           AND book_key NOT IN (SELECT book_key FROM moonreader_items)
           AND book_key NOT IN (SELECT book_key FROM progress_sync_items)`,
          row.book_key,
        );
      }
    });
  });
}

export async function invalidateCatalogMetadata(
  bookKey: string,
): Promise<void> {
  await withDatabaseWrite(async (database) => {
    const row = await database.getFirstAsync<CatalogRow>(
      "SELECT book_json FROM catalog_books WHERE book_key = ?",
      bookKey,
    );
    if (!row)
      throw new Error("This book is not present in the library catalog.");
    const book = parseBook(row.book_json);
    const invalidRemoteCover =
      !book.local || book.cover?.includes("covers.openlibrary.org/b/isbn/");
    const invalidated = {
      ...book,
      cover: invalidRemoteCover ? "" : book.cover,
      discovery: undefined,
      rating: undefined,
      ratingsCount: undefined,
      metadataPending: true,
      metadataUpdatedAt: undefined,
      metadataVersion: undefined,
    };
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        "UPDATE catalog_books SET book_json = ?, updated_at = ? WHERE book_key = ?",
        JSON.stringify(invalidated),
        Date.now(),
        bookKey,
      );
      await transaction.runAsync(
        "DELETE FROM metadata_sources WHERE book_key = ? AND source = 'catalog'",
        bookKey,
      );
    });
  });
}

export async function deleteLocalCatalogBook(uri: string): Promise<void> {
  await withDatabaseWrite((database) =>
    database.withExclusiveTransactionAsync(async (transaction) => {
      const row = await transaction.getFirstAsync<{ book_key: string }>(
        "SELECT book_key FROM local_files WHERE uri = ?",
        uri,
      );
      if (!row) return;
      await transaction.runAsync("DELETE FROM local_files WHERE uri = ?", uri);
      await transaction.runAsync(
        `DELETE FROM catalog_books
       WHERE book_key = ?
         AND book_key NOT IN (SELECT book_key FROM collections)
         AND book_key NOT IN (SELECT book_key FROM local_files)
         AND book_key NOT IN (SELECT book_key FROM moonreader_items)
         AND book_key NOT IN (SELECT book_key FROM progress_sync_items)`,
        row.book_key,
      );
    }),
  );
}

export async function getSyncFingerprint(
  sourceKey: string,
): Promise<string | null> {
  const database = await getLibraryDatabase();
  const row = await database.getFirstAsync<{ fingerprint: string }>(
    "SELECT fingerprint FROM sync_state WHERE source_key = ?",
    sourceKey,
  );
  return row?.fingerprint ?? null;
}

export async function setSyncFingerprint(
  sourceKey: string,
  value: string,
): Promise<void> {
  await withDatabaseWrite((database) =>
    database
      .runAsync(
        `INSERT INTO sync_state (source_key, fingerprint, synced_at)
     VALUES (?, ?, ?)
     ON CONFLICT(source_key) DO UPDATE SET
       fingerprint = excluded.fingerprint,
       synced_at = excluded.synced_at`,
        sourceKey,
        value,
        Date.now(),
      )
      .then(() => undefined),
  );
}

export async function getCachedContent<T>(
  cacheKey: string,
): Promise<{ value: T; expiresAt: number } | null> {
  const database = await getLibraryDatabase();
  const row = await database.getFirstAsync<{
    payload_json: string;
    expires_at: number;
  }>(
    "SELECT payload_json, expires_at FROM content_cache WHERE cache_key = ?",
    cacheKey,
  );
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    await withDatabaseWrite((writeDatabase) =>
      writeDatabase
        .runAsync("DELETE FROM content_cache WHERE cache_key = ?", cacheKey)
        .then(() => undefined),
    );
    return null;
  }
  return {
    value: JSON.parse(row.payload_json) as T,
    expiresAt: row.expires_at,
  };
}

export async function setCachedContent(
  cacheKey: string,
  value: unknown,
  cacheMs: number,
): Promise<void> {
  const now = Date.now();
  await withDatabaseWrite((database) =>
    database
      .runAsync(
        `INSERT INTO content_cache (cache_key, payload_json, expires_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       payload_json = excluded.payload_json,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at`,
        cacheKey,
        JSON.stringify(value),
        now + cacheMs,
        now,
      )
      .then(() => undefined),
  );
}
