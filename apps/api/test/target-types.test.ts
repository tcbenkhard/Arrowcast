import { loginAdmin } from './helpers.js';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import SQLite from 'better-sqlite3';
import { buildApp } from '../src/app.js';
import { DatabaseConnection } from '../src/db/index.js';
import { targetTypes } from '../src/db/schema.js';

const jwtSecret = 'target-type-test-secret-with-at-least-thirty-two-bytes';

test('target types are seeded, authenticated, validated, unique and persisted across restarts', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'arrowcast-target-types-'));
  const databasePath = join(directory, 'test.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const app = buildApp({ jwtSecret, databasePath });
  let initial: string[] = [];
  try {
    for (const method of ['GET', 'POST'] as const) {
      assert.equal((await app.inject({ method, url: '/api/v1/admin/target-types' })).statusCode, 401);
    }
    const login = await loginAdmin(app);
    const headers = { authorization: `Bearer ${login.json().token}` };
    const list = await app.inject({ url: '/api/v1/admin/target-types', headers });
    assert.equal(list.statusCode, 200);
    assert.equal(list.headers['cache-control'], 'no-store');
    initial = list.json();
    for (const name of [
      '40 cm blazoen (10-rings)',
      '60 cm blazoen (10-rings)',
      '122 cm blazoen (10-rings)',
      'Dutch Target 40 cm (3-spot)',
      'Compound 40 cm (4-spot)',
      'Las Vegas 40 cm (3-spot)',
      '80 cm blazoen (6-rings)',
      'Veldblazoen 20 cm',
      'Veldblazoen 80 cm',
      '3D dierdoel',
    ])
      assert.ok(initial.includes(name), name);
    assert.ok(initial.every((value) => typeof value === 'string'));
    assert.equal(new Set(initial).size, initial.length);
    for (const payload of [
      {},
      { name: '' },
      { name: ' \t\n ' },
      { name: 12 },
      { name: 'x'.repeat(101) },
      { name: 'Custom', id: 'id' },
    ]) {
      assert.equal(
        (await app.inject({ method: 'POST', url: '/api/v1/admin/target-types', headers, payload })).statusCode,
        400,
      );
    }
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/target-types',
      headers,
      payload: { name: '  Club practice target  ' },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json(), 'Club practice target');
    for (const name of ['Club practice target', ' club PRACTICE target ', 'dutch target 40 cm (3-spot)']) {
      const duplicate = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/target-types',
        headers,
        payload: { name },
      });
      assert.equal(duplicate.statusCode, 409);
    }
    assert.equal((await app.inject({ url: '/api/v1/admin/target-types', headers })).json().length, initial.length + 1);
  } finally {
    await app.close();
  }
  const reopened = new DatabaseConnection(databasePath);
  try {
    const saved = reopened.db
      .select()
      .from(targetTypes)
      .all()
      .map((type) => type.name);
    assert.equal(saved.length, initial.length + 1);
    assert.ok(saved.includes('Club practice target'));
    assert.throws(() => reopened.db.insert(targetTypes).values({ name: '   ' }).run());
    assert.throws(() => reopened.db.insert(targetTypes).values({ name: 'club practice target' }).run());
  } finally {
    reopened.close();
  }
});

test('target type migration imports existing names without changing lane configuration', () => {
  const client = new SQLite(':memory:');
  try {
    client.pragma('foreign_keys = ON');
    for (const migration of ['0001_add_ranges', '0002_add_competitions', '0003_competition_lane_targets']) {
      client.exec(readFileSync(new URL(`../../../migrations/${migration}.sql`, import.meta.url), 'utf8'));
    }
    client.exec(`INSERT INTO ranges VALUES ('range', 'Indoor');
      INSERT INTO lanes VALUES ('lane', 'range', 1);
      INSERT INTO range_distances VALUES ('range', 18);
      INSERT INTO competitions VALUES ('competition', 'Existing', '2026-11-01', '09:00', '12:00', 'range', 0);
      INSERT INTO competition_lanes VALUES ('competition', 'range', 'lane', 18, 'Existing custom target', 4);`);
    client.exec(readFileSync(new URL('../../../migrations/0004_target_types.sql', import.meta.url), 'utf8'));
    assert.deepEqual(client.prepare('SELECT name FROM target_types WHERE name = ?').get('Existing custom target'), {
      name: 'Existing custom target',
    });
    assert.deepEqual(client.prepare('SELECT target_type, number_of_targets FROM competition_lanes').get(), {
      target_type: 'Existing custom target',
      number_of_targets: 4,
    });
    assert.deepEqual(client.pragma('foreign_key_check'), []);
  } finally {
    client.close();
  }
});

test('bulk deletion validates input, preserves types in use and persists deletion', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'arrowcast-delete-types-'));
  const databasePath = join(directory, 'test.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const app = buildApp({ jwtSecret, databasePath });
  try {
    const url = '/api/v1/admin/target-types';
    assert.equal((await app.inject({ method: 'DELETE', url, payload: { names: ['Unused'] } })).statusCode, 401);
    const login = await loginAdmin(app);
    const headers = { authorization: `Bearer ${login.json().token}` };
    for (const payload of [
      {},
      { names: [] },
      { names: [''] },
      { names: ['   '] },
      { names: ['x', 'x'] },
      { names: [42] },
    ]) {
      assert.equal((await app.inject({ method: 'DELETE', url, headers, payload })).statusCode, 400);
    }
    for (const name of ['In use', 'Unused', 'Also unused']) {
      assert.equal((await app.inject({ method: 'POST', url, headers, payload: { name } })).statusCode, 201);
    }
    const range = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/admin/ranges',
        headers,
        payload: { name: 'Range', supportedDistancesMeters: [18], lanes: [{ number: 1 }] },
      })
    ).json();
    const competition = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/competitions',
      headers,
      payload: {
        name: 'Competition',
        date: '2026-12-02',
        startingTime: '09:00',
        endingTime: '12:00',
        rangeId: range.id,
        lanes: [{ laneId: range.lanes[0].id, distanceMeters: 18 }],
      },
    });
    assert.equal(competition.statusCode, 201);
    const configured = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/competitions/${competition.json().id}/lanes/${range.lanes[0].id}`,
      headers,
      payload: { targetType: 'In use', numberOfTargets: 1 },
    });
    assert.equal(configured.statusCode, 200);
    assert.equal(
      (await app.inject({ method: 'DELETE', url, headers, payload: { names: ['In use', 'Unused'] } })).statusCode,
      409,
    );
    const remaining: string[] = (await app.inject({ url, headers })).json();
    assert.ok(remaining.includes('In use'));
    assert.ok(remaining.includes('Unused'));
    const deleted = await app.inject({ method: 'DELETE', url, headers, payload: { names: ['Unused', 'Also unused'] } });
    assert.equal(deleted.statusCode, 200);
    assert.deepEqual(new Set(deleted.json().removed), new Set(['Unused', 'Also unused']));
  } finally {
    await app.close();
  }
  const reopened = new DatabaseConnection(databasePath);
  try {
    const saved = reopened.db
      .select()
      .from(targetTypes)
      .all()
      .map((type) => type.name);
    assert.ok(saved.includes('In use'));
    assert.ok(!saved.includes('Unused'));
    assert.ok(!saved.includes('Also unused'));
  } finally {
    reopened.close();
  }
});
