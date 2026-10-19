import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import SQLite from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db/index.js';
import { seedAdmin } from '../src/db/seed.js';
import { clubs, participants, users } from '../src/db/schema.js';
import { hashPassword, verifyPassword } from '../src/modules/auth/password.js';

const jwtSecret = 'database-test-secret-with-at-least-32-bytes';

test('migrations run once and the admin seed never resets an existing account', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'arrowcast-db-'));
  const path = join(directory, 'nested', 'test.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const first = openDatabase(path);
  try {
    await seedAdmin(first.db);
    const admin = first.db.select().from(users).get()!;
    assert.equal(admin.username, 'admin');
    assert.equal(admin.role, 'admin');
    assert.notEqual(admin.passwordHash, 'admin');
    assert.ok(await verifyPassword('admin', admin.passwordHash));
    const changedHash = await hashPassword('changed-admin-password');
    first.db.update(users).set({ passwordHash: changedHash }).where(eq(users.username, 'admin')).run();
    await seedAdmin(first.db);
    assert.equal(first.db.select().from(users).get()!.passwordHash, changedHash);
    first.db.insert(users).values({ username: 'another-admin', passwordHash: changedHash }).run();
  } finally {
    first.close();
  }

  // Start the real app against the same file, exercising migration + seed on restart.
  const app = buildApp({ jwtSecret, databasePath: path });
  try {
    await app.ready();
    const oldPassword = await app.inject({ method: 'POST', url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'admin' },
    });
    assert.equal(oldPassword.statusCode, 401);
    const changedPassword = await app.inject({ method: 'POST', url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'changed-admin-password' },
    });
    assert.equal(changedPassword.statusCode, 200);
    const otherUser = await app.inject({ method: 'POST', url: '/api/v1/auth/login',
      payload: { username: 'another-admin', password: 'changed-admin-password' },
    });
    assert.equal(otherUser.statusCode, 200);
    const client = new SQLite(path);
    try {
      assert.equal((client.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get() as { count: number }).count, 15);
      assert.equal((client.prepare('SELECT count(*) AS count FROM users').get() as { count: number }).count, 2);
      client.prepare('DELETE FROM users WHERE username = ?').run('another-admin');
      const removedUser = await app.inject({ url: '/api/v1/admin/me',
        headers: { authorization: `Bearer ${otherUser.json().token}` },
      });
      assert.equal(removedUser.statusCode, 401);
    } finally {
      client.close();
    }
  } finally {
    await app.close();
  }
});

test('seed preserves an existing admin account with a different role', async () => {
  const database = openDatabase(':memory:');
  try {
    const passwordHash = await hashPassword('existing-password');
    database.db.$client.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run('admin', passwordHash, 'desk');
    await seedAdmin(database.db);
    const admin = database.db.select().from(users).get()!;
    assert.equal(admin.role, 'desk');
    assert.equal(admin.passwordHash, passwordHash);
  } finally {
    database.close();
  }
});

test('participants preserve membership numbers and reference an existing club', () => {
  const database = openDatabase(':memory:');
  try {
    database.db.insert(clubs).values({ clubNumber: '0012', name: 'Boogvereniging' }).run();
    const participant = { id: 'participant-1', federationNumber: '000123', name: 'Alex', clubNumber: '0012' };
    database.db.insert(participants).values(participant).run();
    assert.deepEqual(database.db.select().from(participants).get(), participant);
    assert.throws(() => database.db.insert(participants).values({ ...participant, id: 'participant-2' }).run(), /UNIQUE constraint failed/);
    assert.throws(() => database.db.insert(participants).values({
      ...participant, id: 'participant-3', federationNumber: '000124', clubNumber: 'unknown',
    }).run(), /FOREIGN KEY constraint failed/);
    assert.throws(() => database.db.delete(clubs).run(), /FOREIGN KEY constraint failed/);
  } finally {
    database.close();
  }
});

