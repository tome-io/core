export type SqlValue = string | number | null | Uint8Array;

export interface SqlResult<Row> {
  rows: Row[];
  changes: number;
  lastInsertRowId?: number;
}

export interface DatabaseConnection {
  execute<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: readonly SqlValue[]
  ): Promise<SqlResult<Row>>;
}

export interface DatabaseDriver extends DatabaseConnection {
  transaction<T>(operation: (connection: DatabaseConnection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface Migration {
  version: number;
  name: string;
  up: readonly string[];
}

export const CORE_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'shared library foundation',
    up: [
      `CREATE TABLE IF NOT EXISTS books (
        id TEXT PRIMARY KEY NOT NULL,
        canonical_identity TEXT NOT NULL,
        title TEXT NOT NULL,
        authors_json TEXT NOT NULL,
        description TEXT,
        cover_url TEXT,
        published_year INTEGER,
        subjects_json TEXT NOT NULL,
        identifiers_json TEXT NOT NULL,
        rating REAL,
        ratings_count INTEGER,
        metadata_updated_at INTEGER NOT NULL
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS books_canonical_identity_idx
        ON books(canonical_identity)`,
      `CREATE TABLE IF NOT EXISTS book_sources (
        id TEXT PRIMARY KEY NOT NULL,
        book_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_item_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS local_files (
        id TEXT PRIMARY KEY NOT NULL,
        book_id TEXT NOT NULL,
        uri TEXT NOT NULL UNIQUE,
        format TEXT NOT NULL,
        size_bytes INTEGER,
        modification_time INTEGER NOT NULL,
        embedded_metadata_json TEXT,
        FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS reading_progress (
        book_id TEXT PRIMARY KEY NOT NULL,
        progress REAL NOT NULL,
        is_read INTEGER NOT NULL,
        reading_time_ms INTEGER,
        words_read INTEGER,
        last_read_at INTEGER,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS extension_records (
        id TEXT PRIMARY KEY NOT NULL,
        manifest_json TEXT NOT NULL,
        repository_url TEXT,
        enabled INTEGER NOT NULL,
        installed_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    ],
  },
];

export async function migrateDatabase(
  database: DatabaseDriver,
  migrations: readonly Migration[] = CORE_MIGRATIONS
): Promise<void> {
  await database.execute(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at INTEGER NOT NULL)'
  );
  const result = await database.execute<{ version: number }>(
    'SELECT version FROM schema_migrations ORDER BY version ASC'
  );
  const applied = new Set(result.rows.map((row) => row.version));
  const pending = [...migrations]
    .filter((migration) => !applied.has(migration.version))
    .sort((left, right) => left.version - right.version);

  for (const migration of pending) {
    await database.transaction(async (transaction) => {
      for (const sql of migration.up) await transaction.execute(sql);
      await transaction.execute(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        [migration.version, migration.name, Date.now()]
      );
    });
  }
}
