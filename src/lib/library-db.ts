import AsyncStorage from '@react-native-async-storage/async-storage';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import type { LibraryBook, LibraryState } from './library';

const DATABASE_NAME = 'reader-library.db';
const LEGACY_LIBRARY_KEY = 'reader_library_v1';
const LEGACY_MIGRATION_KEY = 'legacy_library_v1_imported';

export type MetadataSource = 'catalog' | 'embedded' | 'filename' | 'moonreader';

interface CatalogRow {
  book_json: string;
}

interface LocalCatalogRow extends CatalogRow {
  uri: string;
  fingerprint: string;
  progress: number | null;
  is_read: number | null;
  reading_time_ms: number | null;
  words_read: number | null;
  last_read_at: number | null;
  progress_synced_at: number | null;
}

let databasePromise: Promise<SQLiteDatabase> | null = null;

function parseBook(value: string): LibraryBook {
  const parsed = JSON.parse(value);
  if (typeof parsed?.key !== 'string' || typeof parsed?.title !== 'string') {
    throw new Error('A stored library book is invalid.');
  }
  return parsed as LibraryBook;
}

function fingerprint(book: LibraryBook): string {
  return book.local ? `${book.local.size || 0}:${book.local.modificationTime || 0}` : '';
}

async function upsertBook(database: SQLiteDatabase, book: LibraryBook): Promise<void> {
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
    Date.now()
  );
}

async function migrateLegacyLibrary(database: SQLiteDatabase): Promise<void> {
  const migrated = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM library_meta WHERE key = ?',
    LEGACY_MIGRATION_KEY
  );
  if (migrated) return;

  const raw = await AsyncStorage.getItem(LEGACY_LIBRARY_KEY);
  let legacy: LibraryState | null = null;
  if (raw) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.downloaded) || !Array.isArray(parsed?.readingList)) {
      throw new Error('Legacy library data is invalid and could not be imported.');
    }
    legacy = parsed as LibraryState;
  }

  await database.withExclusiveTransactionAsync(async (transaction) => {
    if (legacy) {
      const canonicalBooks = new Map<string, LibraryBook>();
      for (const book of [...legacy.readingList, ...legacy.downloaded]) {
        const existing = canonicalBooks.get(book.key);
        canonicalBooks.set(book.key, existing ? { ...existing, ...book } : book);
      }
      for (const book of canonicalBooks.values()) await upsertBook(transaction, book);

      for (const [collection, books] of [
        ['downloaded', legacy.downloaded],
        ['reading_list', legacy.readingList],
      ] as const) {
        for (const book of books) {
          await transaction.runAsync(
            `INSERT OR REPLACE INTO collections (collection, book_key, sort_at)
             VALUES (?, ?, ?)`,
            collection,
            book.key,
            collection === 'downloaded'
              ? book.downloadedAt ?? book.addedAt ?? Date.now()
              : book.addedAt ?? Date.now()
          );
        }
      }
    }
    await transaction.runAsync(
      'INSERT INTO library_meta (key, value) VALUES (?, ?)',
      LEGACY_MIGRATION_KEY,
      String(Date.now())
    );
  });
}

async function initializeDatabase(): Promise<SQLiteDatabase> {
  const database = await openDatabaseAsync(DATABASE_NAME);
  await database.execAsync(`
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

    PRAGMA user_version = 1;
  `);
  await migrateLegacyLibrary(database);
  await database.runAsync('DELETE FROM content_cache WHERE expires_at <= ?', Date.now());
  return database;
}

export function getLibraryDatabase(): Promise<SQLiteDatabase> {
  databasePromise ??= initializeDatabase().catch((error) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}

async function loadCollection(collection: string): Promise<LibraryBook[]> {
  const database = await getLibraryDatabase();
  const rows = await database.getAllAsync<CatalogRow>(
    `SELECT books.book_json
     FROM collections
     JOIN catalog_books AS books ON books.book_key = collections.book_key
     WHERE collections.collection = ?
     ORDER BY collections.sort_at DESC`,
    collection
  );
  return rows.map((row) => parseBook(row.book_json));
}

export async function loadPersistedLibrary(): Promise<LibraryState> {
  const [downloaded, readingList] = await Promise.all([
    loadCollection('downloaded'),
    loadCollection('reading_list'),
  ]);
  return { downloaded, readingList };
}

export async function savePersistedLibrary(state: LibraryState): Promise<void> {
  const database = await getLibraryDatabase();
  const canonicalBooks = new Map<string, LibraryBook>();
  for (const book of [...state.readingList, ...state.downloaded]) {
    const existing = canonicalBooks.get(book.key);
    canonicalBooks.set(book.key, existing ? { ...existing, ...book } : book);
  }
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      "DELETE FROM collections WHERE collection IN ('downloaded', 'reading_list')"
    );
    for (const book of canonicalBooks.values()) {
      const local = await transaction.getFirstAsync<{ present: number }>(
        'SELECT 1 AS present FROM local_files WHERE book_key = ?',
        book.key
      );
      if (!local) await upsertBook(transaction, book);
    }
    for (const [collection, books] of [
      ['downloaded', state.downloaded],
      ['reading_list', state.readingList],
    ] as const) {
      for (const book of books) {
        await transaction.runAsync(
          'INSERT INTO collections (collection, book_key, sort_at) VALUES (?, ?, ?)',
          collection,
          book.key,
          collection === 'downloaded'
            ? book.downloadedAt ?? book.addedAt ?? Date.now()
            : book.addedAt ?? Date.now()
        );
      }
    }
    await transaction.runAsync(`
      DELETE FROM catalog_books
      WHERE book_key NOT IN (SELECT book_key FROM collections)
        AND book_key NOT IN (SELECT book_key FROM local_files)
    `);
  });
}

function withProgress(row: LocalCatalogRow): LibraryBook {
  const book = parseBook(row.book_json);
  if (row.progress == null) return book;
  return {
    ...book,
    progress: row.progress,
    isRead: row.is_read === 1,
    readingTimeMs: row.reading_time_ms ?? undefined,
    wordsRead: row.words_read ?? undefined,
    lastReadAt: row.last_read_at ?? undefined,
    moonReader: {
      ...book.moonReader,
      syncedAt: row.progress_synced_at ?? book.moonReader?.syncedAt ?? Date.now(),
    },
  };
}

export async function loadLocalCatalog(directoryKey: string): Promise<LibraryBook[]> {
  const database = await getLibraryDatabase();
  const rows = await database.getAllAsync<LocalCatalogRow>(
    `SELECT files.uri, files.fingerprint, books.book_json,
            progress.progress, progress.is_read, progress.reading_time_ms,
            progress.words_read, progress.last_read_at,
            progress.synced_at AS progress_synced_at
     FROM local_files AS files
     JOIN catalog_books AS books ON books.book_key = files.book_key
     LEFT JOIN reading_progress AS progress ON progress.book_key = files.book_key
     WHERE files.directory_key = ?
     ORDER BY files.modification_time DESC`,
    directoryKey
  );
  return rows.map(withProgress);
}

function mergeScannedBook(existing: LibraryBook | undefined, scanned: LibraryBook): LibraryBook {
  if (!existing) return scanned;
  return {
    ...existing,
    key: existing.key,
    id: existing.id,
    fileUri: scanned.fileUri,
    format: scanned.format,
    size: scanned.size,
    downloadedAt: scanned.downloadedAt,
    local: scanned.local,
    cover: scanned.cover || existing.cover,
    moonReader: scanned.moonReader
      ? { ...existing.moonReader, ...scanned.moonReader }
      : existing.moonReader,
  };
}

export async function reconcileLocalCatalog(
  directoryKey: string,
  scannedBooks: LibraryBook[]
): Promise<LibraryBook[]> {
  const database = await getLibraryDatabase();
  const existingRows = await database.getAllAsync<{
    uri: string;
    fingerprint: string;
    book_json: string;
  }>(
    `SELECT files.uri, files.fingerprint, books.book_json
     FROM local_files AS files
     JOIN catalog_books AS books ON books.book_key = files.book_key
     WHERE files.directory_key = ?`,
    directoryKey
  );
  const catalogRows = await database.getAllAsync<{ file_uri: string; book_json: string }>(
    'SELECT file_uri, book_json FROM catalog_books WHERE file_uri IS NOT NULL'
  );
  const existingFiles = new Map(existingRows.map((row) => [row.uri, row]));
  const existingByUri = new Map(catalogRows.map((row) => [row.file_uri, parseBook(row.book_json)]));
  const scannedByUri = new Map(scannedBooks.map((book) => [book.local!.uri, book]));
  const seenToken = `${Date.now()}:${Math.random().toString(36).slice(2)}`;

  const merged = scannedBooks.map((scanned) => {
    const uri = scanned.local!.uri;
    const existingFile = existingFiles.get(uri);
    const existing = existingFile
      ? parseBook(existingFile.book_json)
      : existingByUri.get(uri);
    const unchanged = existingFile?.fingerprint === fingerprint(scanned);
    if (!existing) return scanned;
    const mergedBook = mergeScannedBook(existing, scanned);
    return unchanged
      ? mergedBook
      : { ...mergedBook, metadataPending: true, metadataUpdatedAt: undefined };
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
        Date.now()
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
        Date.now()
      );
    }

    const removed = await transaction.getAllAsync<{ book_key: string }>(
      'SELECT book_key FROM local_files WHERE directory_key = ? AND seen_token != ?',
      directoryKey,
      seenToken
    );
    await transaction.runAsync(
      'DELETE FROM local_files WHERE directory_key = ? AND seen_token != ?',
      directoryKey,
      seenToken
    );
    for (const { book_key: bookKey } of removed) {
      await transaction.runAsync(
        `DELETE FROM catalog_books
         WHERE book_key = ?
           AND book_key NOT IN (SELECT book_key FROM collections)
           AND book_key NOT IN (SELECT book_key FROM local_files)`,
        bookKey
      );
    }
  });

  return merged;
}

async function persistLocalBookRecord(
  database: SQLiteDatabase,
  directoryKey: string,
  book: LibraryBook
): Promise<void> {
  if (!book.local) throw new Error('Only local books can be stored in the local catalog.');
  await upsertBook(database, book);
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
    book.local.uri,
    book.key,
    directoryKey,
    book.local.filename,
    book.local.format,
    book.local.size,
    book.local.modificationTime || 0,
    fingerprint(book),
    String(Date.now()),
    Date.now()
  );
  if (typeof book.progress === 'number') {
    await database.runAsync(
      `INSERT INTO reading_progress (
         book_key, source, progress, is_read, reading_time_ms,
         words_read, last_read_at, synced_at
       ) VALUES (?, 'moonreader', ?, ?, ?, ?, ?, ?)
       ON CONFLICT(book_key) DO UPDATE SET
         source = excluded.source,
         progress = excluded.progress,
         is_read = excluded.is_read,
         reading_time_ms = excluded.reading_time_ms,
         words_read = excluded.words_read,
         last_read_at = excluded.last_read_at,
         synced_at = excluded.synced_at`,
      book.key,
      book.progress,
      book.isRead ? 1 : 0,
      book.readingTimeMs ?? null,
      book.wordsRead ?? null,
      book.lastReadAt ?? null,
      book.moonReader?.syncedAt ?? Date.now()
    );
  } else {
    await database.runAsync('DELETE FROM reading_progress WHERE book_key = ?', book.key);
  }
}

export async function persistLocalBook(
  directoryKey: string,
  book: LibraryBook
): Promise<void> {
  const database = await getLibraryDatabase();
  await database.withExclusiveTransactionAsync((transaction) =>
    persistLocalBookRecord(transaction, directoryKey, book)
  );
}

export async function persistLocalBooks(
  directoryKey: string,
  books: LibraryBook[]
): Promise<void> {
  const database = await getLibraryDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    for (const book of books) {
      await persistLocalBookRecord(transaction, directoryKey, book);
    }
  });
}

export async function persistMetadataSource(
  book: LibraryBook,
  source: MetadataSource,
  payload: unknown
): Promise<void> {
  const database = await getLibraryDatabase();
  await database.runAsync(
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
    Date.now()
  );
}

export async function deleteLocalCatalogBook(uri: string): Promise<void> {
  const database = await getLibraryDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const row = await transaction.getFirstAsync<{ book_key: string }>(
      'SELECT book_key FROM local_files WHERE uri = ?',
      uri
    );
    if (!row) return;
    await transaction.runAsync('DELETE FROM local_files WHERE uri = ?', uri);
    await transaction.runAsync(
      `DELETE FROM catalog_books
       WHERE book_key = ?
         AND book_key NOT IN (SELECT book_key FROM collections)
         AND book_key NOT IN (SELECT book_key FROM local_files)`,
      row.book_key
    );
  });
}

export async function getSyncFingerprint(sourceKey: string): Promise<string | null> {
  const database = await getLibraryDatabase();
  const row = await database.getFirstAsync<{ fingerprint: string }>(
    'SELECT fingerprint FROM sync_state WHERE source_key = ?',
    sourceKey
  );
  return row?.fingerprint ?? null;
}

export async function setSyncFingerprint(sourceKey: string, value: string): Promise<void> {
  const database = await getLibraryDatabase();
  await database.runAsync(
    `INSERT INTO sync_state (source_key, fingerprint, synced_at)
     VALUES (?, ?, ?)
     ON CONFLICT(source_key) DO UPDATE SET
       fingerprint = excluded.fingerprint,
       synced_at = excluded.synced_at`,
    sourceKey,
    value,
    Date.now()
  );
}

export async function getCachedContent<T>(
  cacheKey: string
): Promise<{ value: T; expiresAt: number } | null> {
  const database = await getLibraryDatabase();
  const row = await database.getFirstAsync<{ payload_json: string; expires_at: number }>(
    'SELECT payload_json, expires_at FROM content_cache WHERE cache_key = ?',
    cacheKey
  );
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    await database.runAsync('DELETE FROM content_cache WHERE cache_key = ?', cacheKey);
    return null;
  }
  return { value: JSON.parse(row.payload_json) as T, expiresAt: row.expires_at };
}

export async function setCachedContent(
  cacheKey: string,
  value: unknown,
  cacheMs: number
): Promise<void> {
  const database = await getLibraryDatabase();
  const now = Date.now();
  await database.runAsync(
    `INSERT INTO content_cache (cache_key, payload_json, expires_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       payload_json = excluded.payload_json,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at`,
    cacheKey,
    JSON.stringify(value),
    now + cacheMs,
    now
  );
}
