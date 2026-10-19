import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import SQLite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

const projectRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const migrationsFolder = fileURLToPath(new URL('../../../../migrations/', import.meta.url));

export function openDatabase(databasePath: string) {
  const path = databasePath === ':memory:' ? databasePath : resolve(projectRoot, databasePath);
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const client = new SQLite(path);
  try {
    client.pragma('journal_mode = WAL');
    client.pragma('foreign_keys = ON');
    client.pragma('busy_timeout = 5000');
    const db = drizzle(client, { schema });
    migrate(db, { migrationsFolder });
    return { db, close: () => client.close() };
  } catch (error) {
    client.close();
    throw error;
  }
}

export type AppDatabase = ReturnType<typeof openDatabase>['db'];
