import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { bookIdentity } from './book-metadata';
import type { LibraryBook, LibraryState } from './library';
import {
  isProgressRecordRemoved,
  mergeProgressRecords,
  type ProgressSyncRecord,
} from './progress-sync-model';

const DATABASE_NAME = 'reader-library.db';
const LEGACY_LIBRARY_KEY = 'reader_library_v1';
const LEGACY_MIGRATION_KEY = 'legacy_library_v1_imported';

export type MetadataSource = 'catalog' | 'embedded' | 'filename' | 'moonreader';

interface CatalogRow {
  book_json: string;
}

interface ProgressTombstoneRow {
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
}

interface ProgressSnapshotRow extends ProgressCatalogRow {
  book_key: string;
  sync_identity: string | null;
  override_updated_at: number | null;
}

let databasePromise: Promise<SQLiteDatabase> | null = null;

function parseBook(value: string): LibraryBook {
  const parsed = JSON.parse(value);
  if (typeof parsed?.key !== 'string' || typeof parsed?.title !== 'string') {
    throw new Error('A stored library book is invalid.');
  }
  return parsed as LibraryBook;
}

async function withValidGeneratedCover(book: LibraryBook): Promise<LibraryBook> {
  if (book.cover?.includes('covers.openlibrary.org/b/isbn/')) {
    return {
      ...book,
      cover:
        book.fallbackCover ||
        book.moonReader?.detailCoverUri ||
        book.moonReader?.coverUri ||
        '',
      metadataPending: true,
      metadataUpdatedAt: undefined,
      metadataVersion: undefined,
    };
  }
  if (!book.cover?.startsWith('file:') || !book.cover.includes('/library-covers/')) return book;
  const info = await FileSystem.getInfoAsync(book.cover);
  if (info.exists) return book;
  return {
    ...book,
    cover: book.moonReader?.coverUri ?? '',
    metadataPending: true,
    metadataUpdatedAt: undefined,
  };
}

function fingerprint(book: LibraryBook): string {
  return book.local ? `${book.local.size || 0}:${book.local.modificationTime || 0}` : '';
}

function withoutMoonReaderData(book: LibraryBook): LibraryBook {
  const cleaned = { ...book };
  delete cleaned.moonReader;
  delete cleaned.progress;
  delete cleaned.isRead;
  delete cleaned.readingTimeMs;
  delete cleaned.wordsRead;
  delete cleaned.lastReadAt;
  return cleaned;
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

    PRAGMA user_version = 5;
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
  return Promise.all(rows.map((row) => withValidGeneratedCover(parseBook(row.book_json))));
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
        AND book_key NOT IN (SELECT book_key FROM moonreader_items)
        AND book_key NOT IN (SELECT book_key FROM progress_sync_items)
    `);
  });
}

function withProgress(row: ProgressCatalogRow): LibraryBook {
  const book = withoutMoonReaderData(parseBook(row.book_json));
  const moonReader = row.moonreader_json
    ? JSON.parse(row.moonreader_json) as LibraryBook['moonReader']
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
    moonReader: moonReader ?? { syncedAt: row.progress_synced_at ?? Date.now() },
  };
}

export async function loadLocalCatalog(directoryKey: string): Promise<LibraryBook[]> {
  const database = await getLibraryDatabase();
  const rows = await database.getAllAsync<LocalCatalogRow>(
    `SELECT files.uri, files.fingerprint, books.book_json,
            progress.progress, progress.is_read, progress.reading_time_ms,
            progress.words_read, progress.last_read_at,
            progress.synced_at AS progress_synced_at,
            moon.payload_json AS moonreader_json,
            manual.is_read AS override_is_read
     FROM local_files AS files
     JOIN catalog_books AS books ON books.book_key = files.book_key
     LEFT JOIN reading_progress AS progress ON progress.book_key = files.book_key
     LEFT JOIN metadata_sources AS moon
       ON moon.book_key = files.book_key AND moon.source = 'moonreader'
     LEFT JOIN reading_overrides AS manual ON manual.book_key = files.book_key
     WHERE files.directory_key = ?
     ORDER BY files.modification_time DESC`,
    directoryKey
  );
  return Promise.all(rows.map((row) => withValidGeneratedCover(withProgress(row))));
}

export async function loadMoonReaderCatalog(sourceKey: string): Promise<LibraryBook[]> {
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
    sourceKey
  );
  const tombstones = await loadProgressTombstones(database);
  const removedAtByAlias = new Map<string, number>();
  for (const record of tombstones) {
    if (!isProgressRecordRemoved(record)) continue;
    const removedAt = record.removedAt ?? 0;
    for (const alias of [record.identity, ...record.aliases]) {
      removedAtByAlias.set(alias, Math.max(removedAtByAlias.get(alias) ?? 0, removedAt));
    }
  }
  const books = rows.map(withProgress).filter((book) => {
    const activityAt = Math.max(book.lastReadAt ?? 0, book.addedAt ?? 0);
    return ![bookIdentity(book.title, book.author), ...syncAliases(book)].some(
      (alias) => (removedAtByAlias.get(alias) ?? 0) >= activityAt
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
     ORDER BY synced.sort_at DESC`
  );
  return Promise.all(
    rows.map(async (row) => {
      const book = withProgress(row);
      return withValidGeneratedCover({
        ...book,
        moonReader: {
          ...book.moonReader,
          availableLocally: false,
          syncedAt: book.moonReader?.syncedAt ?? row.progress_synced_at ?? Date.now(),
        },
      });
    })
  );
}

export async function loadLocalCatalogBook(
  bookKey: string | null,
  fileUri: string | null
): Promise<LibraryBook | null> {
  if (!bookKey && !fileUri) return null;
  const database = await getLibraryDatabase();
  const row = await database.getFirstAsync<LocalCatalogRow>(
    `SELECT files.uri, files.fingerprint, books.book_json,
            progress.progress, progress.is_read, progress.reading_time_ms,
            progress.words_read, progress.last_read_at,
            progress.synced_at AS progress_synced_at,
            moon.payload_json AS moonreader_json,
            manual.is_read AS override_is_read
     FROM local_files AS files
     JOIN catalog_books AS books ON books.book_key = files.book_key
     LEFT JOIN reading_progress AS progress ON progress.book_key = files.book_key
     LEFT JOIN metadata_sources AS moon
       ON moon.book_key = files.book_key AND moon.source = 'moonreader'
     LEFT JOIN reading_overrides AS manual ON manual.book_key = files.book_key
     WHERE books.book_key = ? OR files.uri = ?
     LIMIT 1`,
    bookKey,
    fileUri
  );
  return row ? withValidGeneratedCover(withProgress(row)) : null;
}

function mergeScannedBook(existing: LibraryBook | undefined, scanned: LibraryBook): LibraryBook {
  if (!existing) return scanned;
  const catalogBook = withoutMoonReaderData(existing);
  const catalogCoverIsLegacyIsbn = catalogBook.cover?.includes(
    'covers.openlibrary.org/b/isbn/'
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
    cover: catalogCoverIsLegacyIsbn ? scanned.cover : catalogBook.cover || scanned.cover,
    fallbackCover: scanned.fallbackCover || catalogBook.fallbackCover,
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
  const existingFiles = new Map<string, { fingerprint: string; book: LibraryBook }>();
  const validatedExistingRows = await Promise.all(
    existingRows.map(async (row) => ({
      row,
      book: await withValidGeneratedCover(parseBook(row.book_json)),
    }))
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
    }))
  );
  for (const { row, book } of validatedCatalogRows) {
    existingByUri.set(row.file_uri, book);
  }
  const scannedByUri = new Map(scannedBooks.map((book) => [book.local!.uri, book]));
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
           AND book_key NOT IN (SELECT book_key FROM local_files)
           AND book_key NOT IN (SELECT book_key FROM moonreader_items)
           AND book_key NOT IN (SELECT book_key FROM progress_sync_items)`,
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
}

async function persistProgressRecord(
  database: SQLiteDatabase,
  book: LibraryBook
): Promise<void> {
  if (typeof book.progress === 'number') {
    await database.runAsync(
      `INSERT INTO reading_progress (
         book_key, source, progress, is_read, reading_time_ms,
         words_read, last_read_at, synced_at
       ) VALUES (?, 'moonreader', ?, ?, ?, ?, ?, ?)
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

async function clearLocalMoonReaderData(database: SQLiteDatabase): Promise<void> {
  const rows = await database.getAllAsync<{ book_key: string; book_json: string }>(
    `SELECT books.book_key, books.book_json
     FROM catalog_books AS books
     WHERE books.book_key IN (SELECT book_key FROM local_files)`
  );
  for (const row of rows) {
    const book = parseBook(row.book_json);
    if (!book.moonReader && typeof book.progress !== 'number') continue;
    const cleaned = withoutMoonReaderData(book);
    await database.runAsync(
      'UPDATE catalog_books SET book_json = ?, updated_at = ? WHERE book_key = ?',
      JSON.stringify(cleaned),
      Date.now(),
      row.book_key
    );
  }
}

export async function persistMoonReaderCatalog(
  sourceKey: string,
  books: LibraryBook[]
): Promise<void> {
  const database = await getLibraryDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    // Settings expose one authoritative Moon+ backup source. Replacing that
    // source must not leave a disconnected Moon+ catalog in SQLite.
    await transaction.runAsync('DELETE FROM moonreader_items');
    await transaction.runAsync("DELETE FROM reading_progress WHERE source = 'moonreader'");
    await transaction.runAsync("DELETE FROM metadata_sources WHERE source = 'moonreader'");
    await clearLocalMoonReaderData(transaction);
    for (const book of books) {
      const moonReader = book.moonReader;
      const filename = moonReader?.sourceFilename;
      if (!moonReader || !filename) {
        throw new Error(`Moon+ Reader item ${book.key} has no source filename.`);
      }
      await upsertBook(transaction, withoutMoonReaderData(book));
      await persistProgressRecord(transaction, book);
      await transaction.runAsync(
        `INSERT INTO moonreader_items (source_key, filename, book_key, sort_at)
         VALUES (?, ?, ?, ?)`,
        sourceKey,
        filename.toLowerCase(),
        book.key,
        book.lastReadAt ?? book.addedAt
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
        Date.now()
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
}

export async function clearMoonReaderCatalog(): Promise<void> {
  const database = await getLibraryDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync('DELETE FROM moonreader_items');
    await transaction.runAsync("DELETE FROM reading_progress WHERE source = 'moonreader'");
    await transaction.runAsync("DELETE FROM metadata_sources WHERE source = 'moonreader'");
    await clearLocalMoonReaderData(transaction);
    await transaction.runAsync(`
      DELETE FROM catalog_books
      WHERE book_key NOT IN (SELECT book_key FROM collections)
        AND book_key NOT IN (SELECT book_key FROM local_files)
        AND book_key NOT IN (SELECT book_key FROM moonreader_items)
        AND book_key NOT IN (SELECT book_key FROM progress_sync_items)
    `);
  });
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

export async function persistCatalogBook(book: LibraryBook): Promise<void> {
  const database = await getLibraryDatabase();
  await upsertBook(database, withoutMoonReaderData(book));
}

export async function markCatalogBookRead(bookKey: string): Promise<void> {
  const database = await getLibraryDatabase();
  const exists = await database.getFirstAsync<{ present: number }>(
    'SELECT 1 AS present FROM catalog_books WHERE book_key = ?',
    bookKey
  );
  if (!exists) throw new Error('This book is not present in the library catalog.');
  await database.runAsync(
    `INSERT INTO reading_overrides (book_key, is_read, updated_at)
     VALUES (?, 1, ?)
     ON CONFLICT(book_key) DO UPDATE SET
       is_read = 1,
       updated_at = excluded.updated_at`,
    bookKey,
    Date.now()
  );
}

function syncAliases(book: LibraryBook): string[] {
  const format = book.format || book.local?.format || '';
  return [
    `key:${book.key}`,
    `identity:${bookIdentity(book.title, book.author, format)}`,
    book.discovery?.id ? `discovery:${book.discovery.id}` : '',
    book.local?.filename ? `filename:${book.local.filename.toLowerCase()}` : '',
    book.moonReader?.sourceFilename
      ? `filename:${book.moonReader.sourceFilename.toLowerCase()}`
      : '',
  ].filter(Boolean);
}

function progressSyncBook(record: ProgressSyncRecord): LibraryBook {
  const key = `progress:${record.identity}`;
  return {
    key,
    id: key,
    title: record.title,
    author: record.author || 'Unknown',
    cover: '',
    description: '',
    year: '',
    genre: 'Other',
    format: record.format || undefined,
    addedAt: record.updatedAt,
    metadataPending: true,
  };
}

function rowProgressRecord(row: ProgressSnapshotRow): ProgressSyncRecord | null {
  const book = parseBook(row.book_json);
  const isRead = row.override_is_read === 1 || row.is_read === 1;
  if (row.progress == null && !isRead) return null;
  const updatedAt = Math.max(
    row.sync_identity ? row.progress_synced_at ?? 0 : 0,
    row.last_read_at ?? 0,
    row.override_updated_at ?? 0
  );
  return {
    identity: bookIdentity(book.title, book.author),
    aliases: syncAliases(book),
    title: book.title,
    author: book.author,
    format: book.format || book.local?.format || '',
    progress: isRead ? 100 : Math.max(0, Math.min(100, row.progress ?? 0)),
    isRead,
    readingTimeMs: row.reading_time_ms ?? undefined,
    wordsRead: row.words_read ?? undefined,
    lastReadAt: row.last_read_at ?? undefined,
    updatedAt: updatedAt || book.addedAt,
  };
}

async function progressSnapshotRows(database: SQLiteDatabase): Promise<ProgressSnapshotRow[]> {
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
        OR synced.book_key IS NOT NULL`
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

async function loadProgressTombstones(
  database: SQLiteDatabase
): Promise<ProgressSyncRecord[]> {
  const rows = await database.getAllAsync<ProgressTombstoneRow>(
    'SELECT record_json FROM progress_sync_tombstones'
  );
  return rows.map((row) => JSON.parse(row.record_json) as ProgressSyncRecord);
}

export async function applyProgressSyncRecords(
  records: ProgressSyncRecord[]
): Promise<number> {
  const database = await getLibraryDatabase();
  const rows = await progressSnapshotRows(database);
  const tombstoneIdentitiesByAlias = new Map<string, Set<string>>();
  for (const tombstone of await loadProgressTombstones(database)) {
    for (const alias of [tombstone.identity, ...tombstone.aliases]) {
      const identities = tombstoneIdentitiesByAlias.get(alias) ?? new Set<string>();
      identities.add(tombstone.identity);
      tombstoneIdentitiesByAlias.set(alias, identities);
    }
  }
  const rowsByAlias = new Map<string, ProgressSnapshotRow[]>();
  for (const row of rows) {
    const book = parseBook(row.book_json);
    const aliases = [
      row.sync_identity ?? '',
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
        for (const row of rowsByAlias.get(alias) ?? []) matches.set(row.book_key, row);
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
          removedAt
        );
        for (const row of matches.values()) {
          await transaction.runAsync(
            'DELETE FROM progress_sync_items WHERE book_key = ?',
            row.book_key
          );
          await transaction.runAsync(
            "DELETE FROM reading_progress WHERE book_key = ? AND source = 'cloud'",
            row.book_key
          );
          await transaction.runAsync(
            `DELETE FROM catalog_books
             WHERE book_key = ?
               AND book_key NOT IN (SELECT book_key FROM collections)
               AND book_key NOT IN (SELECT book_key FROM local_files)
               AND book_key NOT IN (SELECT book_key FROM moonreader_items)
               AND book_key NOT IN (SELECT book_key FROM progress_sync_items)`,
            row.book_key
          );
        }
        updated += 1;
        continue;
      }
      const matchedTombstoneIdentities = new Set<string>();
      for (const alias of [record.identity, ...record.aliases]) {
        for (const identity of tombstoneIdentitiesByAlias.get(alias) ?? []) {
          matchedTombstoneIdentities.add(identity);
        }
      }
      for (const identity of matchedTombstoneIdentities) {
        await transaction.runAsync(
          'DELETE FROM progress_sync_tombstones WHERE identity = ?',
          identity
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
          record.lastReadAt ?? record.updatedAt
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
          row.override_updated_at ?? 0
        );
        const localProgress = localRead ? 100 : Math.max(0, row.progress ?? 0);
        const remoteProgress = record.isRead ? 100 : Math.max(0, record.progress);
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
          record.updatedAt
        );
        if (record.isRead) {
          await transaction.runAsync(
            `INSERT INTO reading_overrides (book_key, is_read, updated_at)
             VALUES (?, 1, ?)
             ON CONFLICT(book_key) DO UPDATE SET
               is_read = 1,
               updated_at = MAX(reading_overrides.updated_at, excluded.updated_at)`,
            row.book_key,
            record.updatedAt
          );
        }
        updated += 1;
      }
    }
  });
  return updated;
}

export async function removeProgressSyncBook(book: LibraryBook): Promise<void> {
  const database = await getLibraryDatabase();
  const rows = await progressSnapshotRows(database);
  const identity = bookIdentity(book.title, book.author);
  const aliases = new Set([identity, ...syncAliases(book)]);
  const matches = rows.filter((row) => {
    if (row.book_key === book.key) return true;
    const rowBook = parseBook(row.book_json);
    const rowRecord = rowProgressRecord(row);
    const rowAliases = [
      row.sync_identity ?? '',
      bookIdentity(rowBook.title, rowBook.author),
      ...syncAliases(rowBook),
      ...(rowRecord?.aliases ?? []),
    ].filter(Boolean);
    return rowRecord?.identity === identity || rowAliases.some((alias) => aliases.has(alias));
  });
  const matchedRecord = matches
    .map(rowProgressRecord)
    .find((record): record is ProgressSyncRecord => !!record);
  const updatedAt =
    matchedRecord?.updatedAt ?? Math.max(book.lastReadAt ?? 0, book.addedAt ?? 0, 1);
  // A removal is a sync event. It must be at least as new as the record it
  // removes, including when another device's clock is slightly ahead.
  const removedAt = Math.max(Date.now(), updatedAt);
  const tombstone: ProgressSyncRecord = {
    identity: matchedRecord?.identity ?? identity,
    aliases: [...new Set([...(matchedRecord?.aliases ?? []), ...aliases])].sort(),
    title: matchedRecord?.title ?? book.title,
    author: matchedRecord?.author ?? book.author,
    format: matchedRecord?.format ?? book.format ?? book.local?.format ?? '',
    progress: matchedRecord?.progress ?? Math.max(0, Math.min(100, book.progress ?? 0)),
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
      removedAt
    );
    await transaction.runAsync(
      'DELETE FROM progress_sync_items WHERE identity = ?',
      tombstone.identity
    );
    for (const row of matches) {
      await transaction.runAsync('DELETE FROM progress_sync_items WHERE book_key = ?', row.book_key);
      await transaction.runAsync(
        "DELETE FROM reading_progress WHERE book_key = ? AND source = 'cloud'",
        row.book_key
      );
      await transaction.runAsync(
        `DELETE FROM catalog_books
         WHERE book_key = ?
           AND book_key NOT IN (SELECT book_key FROM collections)
           AND book_key NOT IN (SELECT book_key FROM local_files)
           AND book_key NOT IN (SELECT book_key FROM moonreader_items)
           AND book_key NOT IN (SELECT book_key FROM progress_sync_items)`,
        row.book_key
      );
    }
  });
}

export async function invalidateCatalogMetadata(bookKey: string): Promise<void> {
  const database = await getLibraryDatabase();
  const row = await database.getFirstAsync<CatalogRow>(
    'SELECT book_json FROM catalog_books WHERE book_key = ?',
    bookKey
  );
  if (!row) throw new Error('This book is not present in the library catalog.');
  const book = parseBook(row.book_json);
  const invalidRemoteCover =
    !book.local || book.cover?.includes('covers.openlibrary.org/b/isbn/');
  const invalidated = {
    ...book,
    cover: invalidRemoteCover ? '' : book.cover,
    discovery: undefined,
    rating: undefined,
    ratingsCount: undefined,
    metadataPending: true,
    metadataUpdatedAt: undefined,
    metadataVersion: undefined,
  };
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      'UPDATE catalog_books SET book_json = ?, updated_at = ? WHERE book_key = ?',
      JSON.stringify(invalidated),
      Date.now(),
      bookKey
    );
    await transaction.runAsync(
      "DELETE FROM metadata_sources WHERE book_key = ? AND source = 'catalog'",
      bookKey
    );
  });
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
         AND book_key NOT IN (SELECT book_key FROM local_files)
         AND book_key NOT IN (SELECT book_key FROM moonreader_items)
         AND book_key NOT IN (SELECT book_key FROM progress_sync_items)`,
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
