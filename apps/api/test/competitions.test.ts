import { loginAdmin } from './helpers.js';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import SQLite from 'better-sqlite3';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db/index.js';
import { competitionLanes, competitions, lanes, rangeDistances, ranges } from '../src/db/schema.js';

const jwtSecret = 'competition-test-secret-with-at-least-thirty-two-bytes';

test('competitions require authentication, validate assignments, sort chronologically and persist as Scheduled', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'arrowcast-competitions-'));
  const databasePath = join(directory, 'test.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const app = buildApp({ jwtSecret, databasePath });
  let createdId = '';
  try {
    for (const method of ['GET', 'POST'] as const) {
      assert.equal((await app.inject({ method, url: '/api/v1/admin/competitions' })).statusCode, 401);
    }
    const login = await loginAdmin(app);
    const headers = { authorization: `Bearer ${login.json().token}` };
    const createRange = async (name: string) => (await app.inject({ method: 'POST', url: '/api/v1/admin/ranges', headers,
      payload: { name, supportedDistancesMeters: [18, 25], lanes: [{ number: 1 }, { number: 2 }] } })).json();
    const range = await createRange('Indoor');
    const other = await createRange('Outdoor');
    const payload = { name: ' Morning ', date: '2026-11-01', startingTime: '09:00', endingTime: '12:00', rangeId: range.id,
      lanes: [{ laneId: range.lanes[1].id, distanceMeters: 25 }, { laneId: range.lanes[0].id, distanceMeters: 18 }] };
    assert.deepEqual((await app.inject({ url: '/api/v1/admin/competitions', headers })).json(), []);
    for (const invalid of [
      {}, { ...payload, name: ' ' }, { ...payload, name: 1 }, { ...payload, date: '2026-02-29' },
      { ...payload, date: '2026-04-31' }, { ...payload, date: '0000-01-01' }, { ...payload, date: '2026-13-01' },
      { ...payload, startingTime: '9:00' }, { ...payload, startingTime: '24:00' }, { ...payload, endingTime: '12:60' },
      { ...payload, endingTime: '09:00' }, { ...payload, endingTime: '08:00' }, { ...payload, rangeId: 'missing' },
      { ...payload, lanes: [] }, { ...payload, lanes: [payload.lanes[0], payload.lanes[0]] },
      { ...payload, lanes: [{ laneId: other.lanes[0].id, distanceMeters: 18 }] },
      ...[0, -18, 70, '18'].map((distanceMeters) => ({ ...payload, lanes: [{ laneId: range.lanes[0].id, distanceMeters }] })),
      { ...payload, lanes: [{ laneId: 'missing', distanceMeters: 18 }] },
      { ...payload, active: true }, { ...payload, active: false },
    ]) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/admin/competitions', headers, payload: invalid });
      assert.equal(response.statusCode, 400, JSON.stringify(invalid));
    }
    assert.deepEqual((await app.inject({ url: '/api/v1/admin/competitions', headers })).json(), []);
    const create = async (values: object) => {
      const response = await app.inject({ method: 'POST', url: '/api/v1/admin/competitions', headers, payload: values });
      assert.equal(response.statusCode, 201, response.body);
      return response.json();
    };
    const later = await create({ ...payload, name: 'Later', startingTime: '13:00', endingTime: '16:00' });
    const nextDay = await create({ ...payload, name: 'Next day', date: '2026-11-02', startingTime: '07:00' });
    const morning = await create(payload);
    createdId = morning.id;
    assert.equal(morning.name, 'Morning');
    assert.equal('active' in morning, false);
    assert.equal(morning.status, 'Scheduled');
    assert.deepEqual(morning.range, { id: range.id, name: range.name });
    assert.deepEqual(morning.lanes.map((lane: { number: number }) => lane.number), [1, 2]);
    const list = await app.inject({ url: '/api/v1/admin/competitions', headers });
    assert.equal(list.headers['cache-control'], 'no-store');
    assert.deepEqual(list.json(), [morning, later, nextDay].map(({ lanes: _lanes, ...competition }) => ({ ...competition })));

    const detailUrl = `/api/v1/admin/competitions/${morning.id}`;
    const laneUrl = `${detailUrl}/lanes/${range.lanes[0].id}`;
    for (const url of [detailUrl, `${detailUrl}/lanes`]) {
      assert.equal((await app.inject({ url })).statusCode, 401);
    }
    assert.equal((await app.inject({ method: 'PUT', url: laneUrl, payload: { targetType: '40 cm', numberOfTargets: 2 } })).statusCode, 401);
    const detail = await app.inject({ url: detailUrl, headers });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().status, 'Scheduled');
    assert.equal('lanes' in detail.json(), false);
    assert.equal('lanes' in list.json()[0], false);
    for (const url of ['/api/v1/admin/competitions/missing', '/api/v1/admin/competitions/missing/lanes']) {
      assert.equal((await app.inject({ url, headers })).statusCode, 404);
    }
    const initialLanes = (await app.inject({ url: `${detailUrl}/lanes`, headers })).json();
    assert.deepEqual(initialLanes.map((lane: { targetType: string | null; numberOfTargets: number | null }) =>
      [lane.targetType, lane.numberOfTargets]), [[null, 1], [null, 1]]);
    for (const invalid of [
      { targetType: ' ', numberOfTargets: 1 }, { targetType: 'x'.repeat(101), numberOfTargets: 1 },
      ...[0, -1, 1.5, 3, 4, '4'].map((numberOfTargets) => ({ targetType: '40 cm', numberOfTargets })),
      { targetType: '40 cm' }, { targetType: '40 cm', numberOfTargets: 2, distanceMeters: 25 },
    ]) {
      assert.equal((await app.inject({ method: 'PUT', url: laneUrl, headers, payload: invalid })).statusCode, 400);
    }
    const configured = await app.inject({ method: 'PUT', url: laneUrl, headers,
      payload: { targetType: ' 40 cm triple spot ', numberOfTargets: 2 } });
    assert.equal(configured.statusCode, 200);
    assert.deepEqual(configured.json(), { ...initialLanes[0], targetType: '40 cm triple spot', numberOfTargets: 2 });
    assert.deepEqual((await app.inject({ url: `/api/v1/admin/competitions/${later.id}/lanes`, headers })).json(), initialLanes);
    const reset = await app.inject({ method: 'PUT', url: `/api/v1/admin/competitions/${later.id}/lanes/${range.lanes[0].id}`, headers,
      payload: { targetType: null, numberOfTargets: null } });
    assert.equal(reset.statusCode, 200);
    assert.equal(reset.json().numberOfTargets, 1);
    assert.equal((await app.inject({ method: 'PUT', url: `${detailUrl}/lanes/${other.lanes[0].id}`, headers,
      payload: { targetType: '40 cm', numberOfTargets: 2 } })).statusCode, 404);

    const client = new SQLite(databasePath);
    try {
      client.exec(`CREATE TRIGGER fail_assignment BEFORE INSERT ON competition_lanes
        WHEN NEW.distance_meters = 18 BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END`);
      const failed = await app.inject({ method: 'POST', url: '/api/v1/admin/competitions', headers, payload });
      assert.equal(failed.statusCode, 500);
      assert.deepEqual(client.prepare('SELECT count(*) AS count FROM competitions').get(), { count: 3 });
      assert.deepEqual(client.prepare('SELECT count(*) AS count FROM competition_lanes').get(), { count: 6 });
    } finally { client.close(); }
  } finally { await app.close(); }
  const reopened = openDatabase(databasePath);
  try {
    const saved = reopened.db.select().from(competitions).all();
    assert.equal(saved.length, 3);
    assert.ok(saved.some((competition) => competition.id === createdId));
    assert.ok(saved.every((competition) => competition.status === 'Scheduled'));
    const savedLanes = reopened.db.select().from(competitionLanes).all();
    assert.equal(savedLanes.length, 6);
    assert.ok(savedLanes.some((lane) => lane.competitionId === createdId && lane.targetType === '40 cm triple spot' && lane.numberOfTargets === 2));
  } finally { reopened.close(); }
});

test('database enforces competition lane ownership, supported distances and unique assignments', () => {
  const database = openDatabase(':memory:');
  const db = database.db;
  try {
    for (const id of ['a', 'b']) {
      db.insert(ranges).values({ id, name: id }).run();
      db.insert(lanes).values({ id: `lane-${id}`, rangeId: id, number: 1 }).run();
      db.insert(rangeDistances).values({ rangeId: id, distanceMeters: 18 }).run();
    }
    db.insert(competitions).values({ id: 'competition', name: 'Test', date: '2026-11-01', startingTime: '09:00', endingTime: '12:00', rangeId: 'a' }).run();
    const assignment = { competitionId: 'competition', rangeId: 'a', laneId: 'lane-a', distanceMeters: 18 };
    for (const invalid of [{ ...assignment, laneId: 'lane-b' }, { ...assignment, rangeId: 'b', laneId: 'lane-b' },
      { ...assignment, distanceMeters: 25 }, { ...assignment, competitionId: 'missing' },
      { ...assignment, targetType: ' ' }, { ...assignment, numberOfTargets: 0 }, { ...assignment, numberOfTargets: 1.5 }]) {
      assert.throws(() => db.insert(competitionLanes).values(invalid).run());
    }
    db.insert(competitionLanes).values(assignment).run();
    assert.throws(() => db.insert(competitionLanes).values(assignment).run());
  } finally { database.close(); }
});


test('target configuration migration preserves existing competition lane assignments', () => {
  const client = new SQLite(':memory:');
  try {
    client.pragma('foreign_keys = ON');
    for (const migration of ['0001_add_ranges', '0002_add_competitions']) {
      client.exec(readFileSync(new URL(`../../../migrations/${migration}.sql`, import.meta.url), 'utf8'));
    }
    client.exec(`INSERT INTO ranges VALUES ('range', 'Indoor');
      INSERT INTO lanes VALUES ('lane', 'range', 1);
      INSERT INTO range_distances VALUES ('range', 18);
      INSERT INTO competitions VALUES ('competition', 'Existing', '2026-11-01', '09:00', '12:00', 'range', 0);
      INSERT INTO competition_lanes VALUES ('competition', 'range', 'lane', 18);`);
    client.exec(readFileSync(new URL('../../../migrations/0003_competition_lane_targets.sql', import.meta.url), 'utf8'));
    assert.deepEqual(client.prepare('SELECT * FROM competition_lanes').get(), {
      competition_id: 'competition', range_id: 'range', lane_id: 'lane', distance_meters: 18,
      target_type: null, number_of_targets: null,
    });
    assert.deepEqual(client.pragma('foreign_key_check'), []);
    assert.throws(() => client.prepare('UPDATE competition_lanes SET number_of_targets = 0').run());
  } finally { client.close(); }
});

test('default target migration fills unset counts, preserves configured counts and defaults new lanes to one', () => {
  const client = new SQLite(':memory:');
  try {
    client.pragma('foreign_keys = ON');
    for (const migration of ['0001_add_ranges', '0002_add_competitions', '0003_competition_lane_targets', '0004_target_types']) {
      client.exec(readFileSync(new URL(`../../../migrations/${migration}.sql`, import.meta.url), 'utf8'));
    }
    client.exec(`INSERT INTO ranges VALUES ('range', 'Indoor');
      INSERT INTO lanes VALUES ('lane-1', 'range', 1), ('lane-2', 'range', 2), ('lane-3', 'range', 3);
      INSERT INTO range_distances VALUES ('range', 18);
      INSERT INTO competitions VALUES ('competition', 'Existing', '2026-11-01', '09:00', '12:00', 'range', 0);
      INSERT INTO competition_lanes VALUES ('competition', 'range', 'lane-1', 18, NULL, NULL);
      INSERT INTO competition_lanes VALUES ('competition', 'range', 'lane-2', 18, 'Custom target', 3);`);
    client.exec(readFileSync(new URL('../../../migrations/0005_default_one_target.sql', import.meta.url), 'utf8'));
    client.prepare('INSERT INTO competition_lanes (competition_id, range_id, lane_id, distance_meters) VALUES (?, ?, ?, ?)')
      .run('competition', 'range', 'lane-3', 18);
    assert.deepEqual(client.prepare('SELECT lane_id, target_type, number_of_targets FROM competition_lanes ORDER BY lane_id').all(), [
      { lane_id: 'lane-1', target_type: null, number_of_targets: 1 },
      { lane_id: 'lane-2', target_type: 'Custom target', number_of_targets: 3 },
      { lane_id: 'lane-3', target_type: null, number_of_targets: 1 },
    ]);
    assert.throws(() => client.prepare('UPDATE competition_lanes SET number_of_targets = NULL').run());
    assert.deepEqual(client.pragma('foreign_key_check'), []);
  } finally { client.close(); }
});


test('competition statuses advance in order, allow moving back, reject invalid transitions and persist', async () => {
  const app = buildApp({ jwtSecret, databasePath: ':memory:' });
  try {
    const login = await loginAdmin(app);
    const headers = { authorization: `Bearer ${login.json().token}` };
    const range = (await app.inject({ method: 'POST', url: '/api/v1/admin/ranges', headers,
      payload: { name: 'Status range', supportedDistancesMeters: [18], lanes: [{ number: 1 }] } })).json();
    const created = await app.inject({ method: 'POST', url: '/api/v1/admin/competitions', headers,
      payload: { name: 'Flow', date: '2026-11-01', startingTime: '09:00', endingTime: '12:00', rangeId: range.id,
        lanes: [{ laneId: range.lanes[0].id, distanceMeters: 18 }] } });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().status, 'Scheduled');
    const url = `/api/v1/admin/competitions/${created.json().id}/status`;
    assert.equal((await app.inject({ method: 'PATCH', url, payload: { status: 'Check-in' } })).statusCode, 401);
    for (const payload of [{}, { status: true }, { status: 'Unknown' }, { status: 'Active', extra: true }]) {
      assert.equal((await app.inject({ method: 'PATCH', url, headers, payload })).statusCode, 400);
    }
    assert.equal((await app.inject({ method: 'PATCH', url, headers, payload: { status: 'Active' } })).statusCode, 409);
    assert.equal((await app.inject({ method: 'PATCH', url: '/api/v1/admin/competitions/missing/status', headers,
      payload: { status: 'Scheduled' } })).statusCode, 404);
    for (const status of ['Check-in', 'Active', 'Closed']) {
      const updated = await app.inject({ method: 'PATCH', url, headers, payload: { status } });
      assert.equal(updated.statusCode, 200, updated.body);
      assert.equal(updated.json().status, status);
      const laneUpdate = await app.inject({ method: 'PUT',
        url: `/api/v1/admin/competitions/${created.json().id}/lanes/${range.lanes[0].id}`, headers,
        payload: { targetType: null, numberOfTargets: 1 } });
      assert.equal(laneUpdate.statusCode, 409);
      assert.equal(laneUpdate.json().message, 'Lanes can only be configured before check-in.');
      assert.equal((await app.inject({ url: `/api/v1/admin/competitions/${created.json().id}`, headers })).json().status, status);
      assert.equal((await app.inject({ method: 'PATCH', url, headers, payload: { status } })).statusCode, 409);
    }
    assert.equal((await app.inject({ method: 'PATCH', url, headers, payload: { status: 'Draft' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'PATCH', url, headers, payload: { status: 'Closed' } })).statusCode, 409);
    for (const status of ['Active', 'Check-in', 'Scheduled']) {
      const updated = await app.inject({ method: 'PATCH', url, headers, payload: { status } });
      assert.equal(updated.statusCode, 200, updated.body);
      assert.equal((await app.inject({ url: `/api/v1/admin/competitions/${created.json().id}`, headers })).json().status, status);
    }
    for (const status of ['Check-in', 'Active', 'Closed', 'Scheduled']) {
      assert.equal((await app.inject({ method: 'PATCH', url, headers, payload: { status } })).statusCode, 200);
    }
    assert.equal((await app.inject({ method: 'PUT',
      url: `/api/v1/admin/competitions/${created.json().id}/lanes/${range.lanes[0].id}`, headers,
      payload: { targetType: null, numberOfTargets: 1 } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'PATCH', url, headers, payload: { status: 'Closed' } })).statusCode, 409);

  } finally { await app.close(); }
});

test('status migration preserves existing competitions and their lanes and participants inside a transaction', () => {
  const client = new SQLite(':memory:');
  try {
    client.pragma('foreign_keys = ON');
    const journal = JSON.parse(readFileSync(new URL('../../../migrations/meta/_journal.json', import.meta.url), 'utf8'));
    for (const entry of journal.entries.filter((entry: { idx: number }) => entry.idx < 12)) {
      client.exec(readFileSync(new URL(`../../../migrations/${entry.tag}.sql`, import.meta.url), 'utf8'));
    }
    client.exec(`INSERT INTO ranges VALUES ('range', 'Indoor');
      INSERT INTO lanes VALUES ('lane', 'range', 1);
      INSERT INTO range_distances VALUES ('range', 18);
      INSERT INTO competitions VALUES ('draft', 'Draft', '2026-11-01', '09:00', '12:00', 'range', 0),
        ('active', 'Active', '2026-11-02', '09:00', '12:00', 'range', 1);
      INSERT INTO competition_lanes VALUES ('active', 'range', 'lane', 18, NULL, 2);
      INSERT INTO clubs VALUES ('club', 'Club');
      INSERT INTO participants VALUES ('person', '123', 'Archer', 'club');
      INSERT INTO competition_participants VALUES ('active', 'person', 'Recurve', NULL);`);
    client.transaction(() => client.exec(readFileSync(new URL('../../../migrations/0012_competition_status.sql', import.meta.url), 'utf8')))();
    assert.deepEqual(client.prepare('SELECT id, status FROM competitions ORDER BY id').all(),
      [{ id: 'active', status: 'Active' }, { id: 'draft', status: 'Draft' }]);
    assert.equal((client.prepare('SELECT number_of_targets FROM competition_lanes').get() as { number_of_targets: number }).number_of_targets, 2);
    assert.deepEqual(client.prepare('SELECT competition_id, participant_id, bow_type FROM competition_participants').get(),
      { competition_id: 'active', participant_id: 'person', bow_type: 'Recurve' });
    client.transaction(() => client.exec(readFileSync(new URL('../../../migrations/0013_scheduled_initial_status.sql', import.meta.url), 'utf8')))();
    assert.deepEqual(client.prepare('SELECT id, status FROM competitions ORDER BY id').all(),
      [{ id: 'active', status: 'Active' }, { id: 'draft', status: 'Scheduled' }]);
    assert.equal((client.prepare('SELECT count(*) AS count FROM competition_lanes').get() as { count: number }).count, 1);
    assert.equal((client.prepare('SELECT count(*) AS count FROM competition_participants').get() as { count: number }).count, 1);
    assert.throws(() => client.exec("UPDATE competitions SET status = 'Draft'"));
    assert.deepEqual(client.pragma('foreign_key_check'), []);
    assert.throws(() => client.exec("UPDATE competitions SET status = 'Unknown'"));
    assert.equal((client.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('competitions') WHERE name = 'active'").get() as { count: number }).count, 0);
  } finally { client.close(); }
});
