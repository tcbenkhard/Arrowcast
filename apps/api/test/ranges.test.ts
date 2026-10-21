import { loginAdmin } from './helpers.js';
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
    const login = await loginAdmin(app);
    const headers = { authorization: `Bearer ${login.json().token}` };
    const emptyList = await app.inject({ url: '/api/v1/admin/ranges', headers });
    assert.equal(emptyList.statusCode, 200);
    assert.deepEqual(emptyList.json(), []);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ranges',
      headers,
      payload: { ...payload, name: ' Indoor ' },
    });
    assert.equal(response.statusCode, 201);
    created = response.json();
    assert.equal(created.name, 'Indoor');
    assert.deepEqual(created.supportedDistancesMeters, [18, 25]);
    assert.deepEqual(
      created.lanes.map((lane: { number: number }) => lane.number),
      [1, 2],
    );
    assert.ok(created.id);
    assert.ok(created.lanes.every((lane: { id: string }) => lane.id));
    assert.equal(new Set(created.lanes.map((lane: { id: string }) => lane.id)).size, 2);
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ranges',
      headers,
      payload: { ...payload, name: 'Outdoor' },
    });
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
    assert.deepEqual(
      database.db
        .select()
        .from(rangeDistances)
        .all()
        .filter((distance) => distance.rangeId === created.id)
        .map((distance) => distance.distanceMeters),
      [18, 25],
    );
    assert.deepEqual(
      database.db
        .select()
        .from(lanes)
        .all()
        .filter((lane) => lane.rangeId === created.id)
        .map(({ id, number }) => ({ id, number })),
      created.lanes,
    );
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
  const login = await loginAdmin(app);
  const headers = { authorization: `Bearer ${login.json().token}` };
  for (const invalid of [
    {},
    { ...payload, name: '   ' },
    { ...payload, name: 5 },
    { ...payload, supportedDistancesMeters: [] },
    { ...payload, supportedDistancesMeters: [18, 18] },
    { ...payload, supportedDistancesMeters: [0] },
    { ...payload, supportedDistancesMeters: [-18] },
    { ...payload, supportedDistancesMeters: ['18'] },
    { ...payload, lanes: [] },
    { ...payload, lanes: [{ number: 1 }, { number: 1 }] },
    ...[0, -1, 1.5, '1'].map((number) => ({ ...payload, lanes: [{ number }] })),
    { ...payload, lanes: [{}] },
    { ...payload, lanes: [{ number: 1, extra: true }] },
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

test('range edits retain lane identities, reject referenced removals atomically, and delete unused ranges', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'arrowcast-range-edit-'));
  const databasePath = join(directory, 'test.sqlite');
  const app = buildApp({ jwtSecret, databasePath });
  let client: SQLite.Database | undefined;
  t.after(async () => {
    client?.close();
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const login = await loginAdmin(app);
  const headers = { authorization: `Bearer ${login.json().token}` };
  const created = (await app.inject({ method: 'POST', url: '/api/v1/admin/ranges', headers, payload })).json();
  const url = `/api/v1/admin/ranges/${created.id}`;
  for (const method of ['PUT', 'DELETE'] as const) {
    assert.equal((await app.inject({ method, url, ...(method === 'PUT' ? { payload } : {}) })).statusCode, 401);
    assert.equal(
      (
        await app.inject({
          method,
          url: '/api/v1/admin/ranges/missing',
          headers,
          ...(method === 'PUT' ? { payload } : {}),
        })
      ).statusCode,
      404,
    );
  }
  assert.equal(
    (await app.inject({ method: 'PUT', url, headers, payload: { ...payload, lanes: [{ number: 1 }, { number: 1 }] } }))
      .statusCode,
    400,
  );
  client = new SQLite(databasePath);
  client.pragma('foreign_keys = ON');
  client
    .prepare(`INSERT INTO competitions (id, name, date, starting_time, ending_time, range_id)
    VALUES ('competition', 'Test', '2026-10-21', '09:00', '10:00', ?)`)
    .run(created.id);
  client
    .prepare(`INSERT INTO competition_lanes (competition_id, range_id, lane_id, distance_meters)
    VALUES ('competition', ?, ?, 18)`)
    .run(created.id, created.lanes[0].id);
  for (const edit of [
    { ...payload, name: 'Should roll back', lanes: [{ number: 2 }] },
    { ...payload, name: 'Should roll back', supportedDistancesMeters: [25] },
  ]) {
    assert.equal((await app.inject({ method: 'PUT', url, headers, payload: edit })).statusCode, 409);
    assert.deepEqual((await app.inject({ url: '/api/v1/admin/ranges', headers })).json(), [created]);
  }
  assert.equal((await app.inject({ method: 'DELETE', url, headers })).statusCode, 409);
  const updated = await app.inject({
    method: 'PUT',
    url,
    headers,
    payload: {
      name: ' Updated ',
      supportedDistancesMeters: [18, 30],
      lanes: [{ number: 1 }, { number: 3 }],
    },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().name, 'Updated');
  assert.equal(updated.json().lanes[0].id, created.lanes[0].id);
  assert.deepEqual(updated.json().supportedDistancesMeters, [18, 30]);
  assert.deepEqual(
    updated.json().lanes.map((lane: { number: number }) => lane.number),
    [1, 3],
  );
  client.prepare("DELETE FROM competitions WHERE id = 'competition'").run();
  assert.equal((await app.inject({ method: 'DELETE', url, headers })).statusCode, 204);
  for (const table of ['ranges', 'lanes', 'range_distances']) {
    assert.deepEqual(client.prepare(`SELECT count(*) AS count FROM ${table}`).get(), { count: 0 });
  }
});
