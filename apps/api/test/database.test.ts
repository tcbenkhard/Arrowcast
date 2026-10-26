import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import SQLite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
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
    const oldPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'admin' },
    });
    assert.equal(oldPassword.statusCode, 401);
    const changedPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'changed-admin-password' },
    });
    assert.equal(changedPassword.statusCode, 200);
    const otherUser = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'another-admin', password: 'changed-admin-password' },
    });
    assert.equal(otherUser.statusCode, 200);
    const client = new SQLite(path);
    try {
      assert.equal(
        (client.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get() as { count: number }).count,
        24,
      );
      assert.equal((client.prepare('SELECT count(*) AS count FROM users').get() as { count: number }).count, 2);
      client.prepare('DELETE FROM users WHERE username = ?').run('another-admin');
      const removedUser = await app.inject({
        url: '/api/v1/admin/me',
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

test('data model simplification migrates existing scoring and logbook data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'arrowcast-simplification-'));
  const path = join(directory, 'existing.sqlite');
  const migrationsFolder = new URL('../../../migrations/', import.meta.url);
  const legacyMigrations = join(directory, 'migrations');
  try {
    cpSync(migrationsFolder, legacyMigrations, { recursive: true });
    rmSync(join(legacyMigrations, '0023_simplify_data_model.sql'));
    const journalPath = join(legacyMigrations, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
    journal.entries.pop();
    writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);

    const client = new SQLite(path);
    migrate(drizzle(client), { migrationsFolder: legacyMigrations });
    client.pragma('foreign_keys = ON');
    client.exec(`
      INSERT INTO clubs (club_number, name) VALUES ('club', 'Club');
      INSERT INTO participants (id, federation_number, name, club_number) VALUES ('person', '100', 'Person', 'club');
      INSERT INTO ranges (id, name) VALUES ('range', 'Range');
      INSERT INTO range_distances (range_id, distance_meters) VALUES ('range', 18);
      INSERT INTO lanes (id, range_id, number) VALUES ('lane', 'range', 1);
      INSERT INTO competitions (id, name, date, starting_time, ending_time, range_id, status)
        VALUES ('competition', 'Competition', '2026-10-26', '10:00', '12:00', 'range', 'Active');
      INSERT INTO competition_lanes (competition_id, range_id, lane_id, distance_meters)
        VALUES ('competition', 'range', 'lane', 18);
      INSERT INTO competition_participants (competition_id, participant_id, checked_in, lane_id, target_letter)
        VALUES ('competition', 'person', 1, 'lane', 'A');
      INSERT INTO lane_scoring_grants (id, competition_id, lane_id, token_hash, created_at, expires_at)
        VALUES ('grant', 'competition', 'lane', 'grant-hash', 100, 10000);
      INSERT INTO scoring_sessions (id, grant_id, token_hash, created_at, expires_at)
        VALUES ('scoring-session', 'grant', 'session-hash', 100, 10000);
      INSERT INTO scorecards (id, competition_id, participant_id, version, created_at, updated_at)
        VALUES ('card', 'competition', 'person', 7, 100, 200);
      INSERT INTO round_scores (id, scorecard_id, round_number, status, submitted_at)
        VALUES ('draft-round', 'card', 1, 'draft', NULL), ('submitted-round', 'card', 2, 'submitted', 222);
      INSERT INTO arrow_scores (round_score_id, arrow_index, symbol) VALUES ('submitted-round', 1, '10');
      INSERT INTO scoring_mutations (id, session_id, request_hash, result, created_at)
        VALUES ('mutation', 'scoring-session', 'request-hash', '{"version":7}', 200);
      INSERT INTO score_changes (id, scorecard_id, session_id, mutation_id, round_number, before, after, submitted, created_at)
        VALUES ('change', 'card', 'scoring-session', 'mutation', 2, '["9"]', '["10"]', 1, 200);
      INSERT INTO logbook_sessions (id, participant_id, token_hash, expires_at)
        VALUES ('logbook-session', 'person', 'logbook-hash', 5000);
      INSERT INTO logbook_entries (id, session_id, participant_id, rounds, version, total, created_at, completed_at)
        VALUES ('entry', 'logbook-session', 'person', '[["10"]]', 3, 10, 300, 400);
    `);
    client.close();

    const upgraded = openDatabase(path);
    try {
      const raw = upgraded.db.$client;
      assert.deepEqual(raw.prepare('SELECT * FROM logbook_entries').get(), {
        id: 'entry',
        participant_id: 'person',
        token_hash: 'logbook-hash',
        expires_at: 5000,
        rounds: '[["10"]]',
        version: 3,
        total: 10,
        created_at: 300,
        completed_at: 400,
      });
      assert.deepEqual(raw.prepare('SELECT * FROM scoring_mutations').get(), {
        id: 'mutation',
        session_id: 'scoring-session',
        scorecard_id: 'card',
        request_hash: 'request-hash',
        result_version: 7,
        round_number: 2,
        before: '["9"]',
        after: '["10"]',
        submitted: 1,
        created_at: 200,
      });
      assert.deepEqual(raw.prepare('SELECT id, submitted_at FROM round_scores ORDER BY id').all(), [
        { id: 'draft-round', submitted_at: null },
        { id: 'submitted-round', submitted_at: 222 },
      ]);
      assert.deepEqual(raw.prepare('SELECT * FROM arrow_scores').get(), {
        round_score_id: 'submitted-round',
        arrow_index: 1,
        symbol: '10',
      });
      assert.deepEqual(raw.pragma('foreign_key_check'), []);
      assert.equal(
        raw
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('score_changes', 'logbook_sessions')",
          )
          .get().count,
        0,
      );
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('seed preserves an existing admin account with a different role', async () => {
  const database = openDatabase(':memory:');
  try {
    const passwordHash = await hashPassword('existing-password');
    database.db.$client
      .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run('admin', passwordHash, 'desk');
    await seedAdmin(database.db);
    const admin = database.db.select().from(users).get()!;
    assert.equal(admin.role, 'desk');
    assert.equal(admin.passwordHash, passwordHash);
  } finally {
    database.close();
  }
});

test('renaming the initial administrator does not recreate default credentials on startup', async () => {
  const database = openDatabase(':memory:');
  try {
    await seedAdmin(database.db);
    database.db
      .update(users)
      .set({ username: 'renamed-admin', name: 'Renamed Administrator' })
      .where(eq(users.username, 'admin'))
      .run();
    await seedAdmin(database.db);
    const accounts = database.db.select().from(users).all();
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0]!.username, 'renamed-admin');
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
    assert.throws(
      () =>
        database.db
          .insert(participants)
          .values({ ...participant, id: 'participant-2' })
          .run(),
      /UNIQUE constraint failed/,
    );
    assert.throws(
      () =>
        database.db
          .insert(participants)
          .values({
            ...participant,
            id: 'participant-3',
            federationNumber: '000124',
            clubNumber: 'unknown',
          })
          .run(),
      /FOREIGN KEY constraint failed/,
    );
    assert.throws(() => database.db.delete(clubs).run(), /FOREIGN KEY constraint failed/);
  } finally {
    database.close();
  }
});

test('existing default passwords require changing while custom passwords remain usable', async () => {
  for (const password of ['admin', 'existing-private-password']) {
    const database = openDatabase(':memory:');
    try {
      const passwordHash = await hashPassword(password);
      database.db.insert(users).values({ username: 'admin', passwordHash }).run();
      await seedAdmin(database.db);
      const user = database.db.select().from(users).get()!;
      assert.equal(user.passwordHash, passwordHash);
      assert.equal(user.forceChangePassword, password === 'admin');
    } finally {
      database.close();
    }
  }
});
