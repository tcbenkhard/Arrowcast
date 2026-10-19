import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import SQLite from 'better-sqlite3';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db/index.js';
import { lanes, rangeDistances, ranges } from '../src/db/schema.js';

const jwtSecret = 'range-test-secret-with-at-least-thirty-two-bytes';
const payload = { name: 'Indoor', supportedDistancesMeters: [18, 25], lanes: [{ number: 1 }, { number: 2 }] };

test('create ranges requires authentication and persists distances and lanes across restarts', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'arrowcast-ranges-'));
  const databasePath = join(directory, 'test.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const app = buildApp({ jwtSecret, databasePath });
  let created;
  try {
    const unauthorized = await app.inject({ method: 'POST', url: '/api/v1/admin/ranges', payload });
    assert.equal(unauthorized.statusCode, 401);
    const unauthorizedList = await app.inject({ url: '/api/v1/admin/ranges' });
    assert.equal(unauthorizedList.statusCode, 401);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'admin' } });
    const headers = { authorization: `Bearer ${login.json().token}` };
    const emptyList = await app.inject({ url: '/api/v1/admin/ranges', headers });
    assert.equal(emptyList.statusCode, 200);
    assert.deepEqual(emptyList.json(), []);
    const response = await app.inject({ method: 'POST', url: '/api/v1/admin/ranges', headers,
      payload: { ...payload, name: ' Indoor ' } });
    assert.equal(response.statusCode, 201);
    created = response.json();
    assert.equal(created.name, 'Indoor');
    assert.deepEqual(created.supportedDistancesMeters, [18, 25]);
    assert.deepEqual(created.lanes.map((lane: { number: number }) => lane.number), [1, 2]);
    assert.ok(created.id);
    assert.ok(created.lanes.every((lane: { id: string }) => lane.id));
    assert.equal(new Set(created.lanes.map((lane: { id: string }) => lane.id)).size, 2);
    const second = await app.inject({ method: 'POST', url: '/api/v1/admin/ranges', headers,
      payload: { ...payload, name: 'Outdoor' } });
    assert.equal(second.statusCode, 201, 'different ranges can reuse lane numbers');
    assert.notEqual(second.json().id, created.id);
    const list = await app.inject({ url: '/api/v1/admin/ranges', headers });
    assert.equal(list.statusCode, 200);
    assert.equal(list.headers['cache-control'], 'no-store');
    assert.deepEqual(list.json(), [created, second.json()]);
  } finally {
    await app.close();
  }
  const database = openDatabase(databasePath);
  try {
    assert.equal(database.db.select().from(ranges).all().length, 2);
    assert.deepEqual(database.db.select().from(rangeDistances).all()
      .filter((distance) => distance.rangeId === created.id).map((distance) => distance.distanceMeters), [18, 25]);
    assert.deepEqual(database.db.select().from(lanes).all().filter((lane) => lane.rangeId === created.id)
      .map(({ id, number }) => ({ id, number })), created.lanes);
  } finally {
    database.close();
  }
});

test('invalid range requests write nothing and a failed child insert rolls back the whole range', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'arrowcast-ranges-'));
  const databasePath = join(directory, 'test.sqlite');
  const app = buildApp({ jwtSecret, databasePath });
  t.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'admin' } });
  const headers = { authorization: `Bearer ${login.json().token}` };
  for (const invalid of [
    {}, { ...payload, name: '   ' }, { ...payload, name: 5 },
    { ...payload, supportedDistancesMeters: [] }, { ...payload, supportedDistancesMeters: [18, 18] },
    { ...payload, supportedDistancesMeters: [0] }, { ...payload, supportedDistancesMeters: [-18] },
    { ...payload, supportedDistancesMeters: ['18'] }, { ...payload, lanes: [] },
    { ...payload, lanes: [{ number: 1 }, { number: 1 }] },
    ...[0, -1, 1.5, '1'].map((number) => ({ ...payload, lanes: [{ number }] })),
    { ...payload, lanes: [{}] }, { ...payload, lanes: [{ number: 1, extra: true }] },
    { ...payload, extra: true },
  ]) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/admin/ranges', headers, payload: invalid });
    assert.equal(response.statusCode, 400, JSON.stringify(invalid));
  }
  const client = new SQLite(databasePath);
  try {
    client.exec(`CREATE TRIGGER fail_second_lane BEFORE INSERT ON lanes
      WHEN NEW.number = 2 BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END`);
    const failed = await app.inject({ method: 'POST', url: '/api/v1/admin/ranges', headers, payload });
    assert.equal(failed.statusCode, 500);
    for (const table of ['ranges', 'range_distances', 'lanes']) {
      assert.deepEqual(client.prepare(`SELECT count(*) AS count FROM ${table}`).get(), { count: 0 });
    }
  } finally {
    client.close();
  }
});

test('database enforces lane numbers per range, distance uniqueness and foreign keys', () => {
  const database = openDatabase(':memory:');
  try {
    const db = database.db;
    db.insert(ranges).values({ id: 'indoor', name: 'Indoor' }).run();
    db.insert(lanes).values({ id: 'one', rangeId: 'indoor', number: 1 }).run();
    assert.throws(() => db.insert(lanes).values({ id: 'duplicate', rangeId: 'indoor', number: 1 }).run());
    assert.throws(() => db.insert(lanes).values({ id: 'orphan', rangeId: 'missing', number: 1 }).run());
    assert.throws(() => db.insert(lanes).values({ id: 'zero', rangeId: 'indoor', number: 0 }).run());
    db.insert(rangeDistances).values({ rangeId: 'indoor', distanceMeters: 18 }).run();
    assert.throws(() => db.insert(rangeDistances).values({ rangeId: 'indoor', distanceMeters: 18 }).run());
    assert.throws(() => db.insert(rangeDistances).values({ rangeId: 'missing', distanceMeters: 25 }).run());
    assert.throws(() => db.insert(rangeDistances).values({ rangeId: 'indoor', distanceMeters: 0 }).run());
  } finally {
    database.close();
  }
});
