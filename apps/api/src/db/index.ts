import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import SQLite from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';
import { DatabaseContext } from './context.js';

const projectRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const migrationsFolder = fileURLToPath(new URL('../../../../migrations/', import.meta.url));

export type AppDatabase = BetterSQLite3Database<typeof schema> & { $client: SQLite.Database };

/** Owns the SQLite connection, startup migrations and its shared application context. */
export class DatabaseConnection {
  private readonly client: SQLite.Database;
  readonly db: AppDatabase;
  readonly context: DatabaseContext;

  constructor(databasePath: string) {
    const path = databasePath === ':memory:' ? databasePath : resolve(projectRoot, databasePath);
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.client = new SQLite(path);
    try {
      this.client.pragma('journal_mode = WAL');
      this.client.pragma('foreign_keys = ON');
      this.client.pragma('busy_timeout = 5000');
      this.db = drizzle(this.client, { schema });
      migrate(this.db, { migrationsFolder });
      this.context = new DatabaseContext(this.db);
    } catch (error) {
      this.client.close();
      throw error;
    }
  }

  close() {
    this.client.close();
  }
}
