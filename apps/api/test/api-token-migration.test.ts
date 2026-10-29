import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import SQLite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { buildApp } from '../src/app.js';
import { DatabaseConnection } from '../src/db/index.js';
import { loginAdmin } from './helpers.js';

interface MigratedToken {
  id: string;
  naam: string;
  token_hash: string;
  created_date: number;
}

test('API key ID migration preserves existing keys and makes each legacy key independently revocable', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'arrowcast-api-token-migration-'));
  const databasePath = join(directory, 'legacy.sqlite');
  const legacyMigrations = join(directory, 'migrations');
  let app: ReturnType<typeof buildApp> | undefined;
  t.after(async () => {
    await app?.close();
    rmSync(directory, { recursive: true, force: true });
  });

  cpSync(new URL('../../../migrations/', import.meta.url), legacyMigrations, { recursive: true });
  const journalPath = join(legacyMigrations, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number }[] };
  journal.entries = journal.entries.filter((entry) => entry.idx < 25);
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);

  const legacyKeys = [100, 200].map((createdDate) => {
    const token = randomBytes(32).toString('base64url');
    return {
      name: 'Existing integration',
      token,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      createdDate,
    };
  });
  const legacy = new SQLite(databasePath);
  try {
    migrate(drizzle(legacy), { migrationsFolder: legacyMigrations });
    const insert = legacy.prepare('INSERT INTO api_tokens (naam, token_hash, created_date) VALUES (?, ?, ?)');
    for (const key of legacyKeys) insert.run(key.name, key.tokenHash, key.createdDate);
  } finally {
    legacy.close();
  }

  let migrated: MigratedToken[];
  const upgraded = new DatabaseConnection(databasePath);
  try {
    migrated = upgraded.db.$client.prepare('SELECT * FROM api_tokens ORDER BY created_date').all() as MigratedToken[];
    assert.equal(migrated.length, legacyKeys.length);
    assert.equal(new Set(migrated.map((key) => key.id)).size, legacyKeys.length);
    for (const [index, key] of migrated.entries()) {
      assert.match(key.id, /^[0-9a-f]{32}$/);
      assert.deepEqual(key, {
        id: key.id,
        naam: legacyKeys[index]!.name,
        token_hash: legacyKeys[index]!.tokenHash,
        created_date: legacyKeys[index]!.createdDate,
      });
    }
  } finally {
    upgraded.close();
  }

  const reopened = new DatabaseConnection(databasePath);
  try {
    assert.deepEqual(reopened.db.$client.prepare('SELECT * FROM api_tokens ORDER BY created_date').all(), migrated);
  } finally {
    reopened.close();
  }

  app = buildApp({ jwtSecret: 'api-token-migration-test-secret-with-at-least-thirty-two-bytes', databasePath });
  const admin = await loginAdmin(app);
  const headers = { authorization: `Bearer ${admin.json().token}` };
  const payload = { verenigingsnummer: 1241, date: '2026-10-05', starttime: '10:00' };
  for (const key of legacyKeys) {
    const accepted = await app.inject({
      method: 'POST',
      url: '/api/scores',
      headers: { authorization: `Bearer ${key.token}` },
      payload,
    });
    assert.equal(accepted.statusCode, 400);
    assert.deepEqual(accepted.json(), { message: 'Verkeerde vereniging' });
  }
  const revoked = await app.inject({ method: 'DELETE', url: `/api/v1/admin/api-tokens/${migrated[0]!.id}`, headers });
  assert.equal(revoked.statusCode, 204);
  for (const [index, key] of legacyKeys.entries()) {
    const result = await app.inject({
      method: 'POST',
      url: '/api/scores',
      headers: { authorization: `Bearer ${key.token}` },
      payload,
    });
    assert.equal(result.statusCode, index === 0 ? 401 : 400);
  }
  const remaining = await app.inject({ url: '/api/v1/admin/api-tokens', headers });
  assert.deepEqual(remaining.json(), [
    { id: migrated[1]!.id, name: legacyKeys[1]!.name, createdDate: legacyKeys[1]!.createdDate },
  ]);
});
